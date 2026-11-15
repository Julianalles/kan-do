// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Runner, RunOptions } from '~/server/copy-editor/exec'
import { buildSpecArgs, freePort, isBaselineMessage, MAX_BASELINES, parseGateDecision, parsePlaywrightJson, runFollowUp, splitChangedFiles, type FollowUpContext } from '~/server/copy-editor/verify'

const SNAP = 'tests/e2e/snapshots/visual-regression.spec.ts'
const jsonReport = (tests: { status: string, message?: string, file?: string, line?: number }[]) => JSON.stringify({
  suites: [{ title: 'a', specs: [], suites: tests.map((test, index) => ({ title: 'b', specs: [{ title: `t${index}`, file: test.file ?? 'visual-regression.spec.ts', line: test.line ?? 10 + index, tests: [{ status: test.status, results: [{ error: test.message ? { message: test.message } : undefined }] }] }] })) }],
})

describe('copy publish: reading results', () => {
  it('recognises baseline failures and ignores tests that passed on retry', () => {
    const report = jsonReport([
      { status: 'unexpected', message: 'Error: expect(page).toHaveScreenshot(expected) failed\n  Screenshot comparison failed' },
      { status: 'unexpected', message: 'Error: expect(locator).toMatchAriaSnapshot(expected) failed' },
      { status: 'unexpected', message: 'Error: expect(locator).toContainText(expected) failed', file: 'smoke.spec.ts' },
      { status: 'flaky', message: 'timeout' },
      { status: 'expected' },
    ])
    expect(parsePlaywrightJson(report).map(failure => [failure.file, failure.kind])).toEqual([['visual-regression.spec.ts', 'baseline'], ['visual-regression.spec.ts', 'baseline'], ['smoke.spec.ts', 'other']])
    expect(parsePlaywrightJson('not json')).toEqual([])
    expect(isBaselineMessage('expect(locator).toBeVisible() failed')).toBe(false)
  })

  it('reads the gate decision and builds the Playwright arguments: JSON report added, always-specs appended, a full tier left alone', () => {
    expect(parseGateDecision('nope')).toBeNull()
    const decision = parseGateDecision(JSON.stringify({ tier: 'targeted', specs: ['smoke', 'welcome-setup'], args: ['--reporter=line', '--retries=1', 'tests/e2e/smoke.spec.ts'] }))!
    expect(buildSpecArgs(decision, ['visual-regression', 'smoke'])).toEqual({
      args: ['--reporter=line,json', '--retries=1', 'tests/e2e/smoke.spec.ts', 'tests/e2e/visual-regression.spec.ts', 'tests/e2e/welcome-setup.spec.ts'],
      specs: ['smoke', 'visual-regression', 'welcome-setup'],
    })
    expect(buildSpecArgs({ tier: 'full', specs: [], args: ['--reporter=line'] }, ['visual-regression'])).toEqual({ args: ['--reporter=line,json'], specs: ['(all)'] })
    expect(buildSpecArgs({ tier: 'style', specs: ['x'], args: [] }, ['state-structure']).specs).toEqual(['state-structure'])
  })

  it('separates re-recorded baselines from other changed files', () => {
    expect(splitChangedFiles([`${SNAP}/a.png`, 'tests/e2e/snapshots/state-structure.spec.ts/b.aria.yml', 'tests/e2e/x.spec.ts', 'components/A.vue'])).toEqual({
      baselines: [`${SNAP}/a.png`, 'tests/e2e/snapshots/state-structure.spec.ts/b.aria.yml'],
      other: ['tests/e2e/x.spec.ts', 'components/A.vue'],
    })
  })

  it('picks a port that is free right now', async () => {
    expect(await freePort()).toBeGreaterThan(1023)
  })
})

describe('copy publish: follow-up loop', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verify-'))
    mkdirSync(join(dir, 'wt/tests/e2e'), { recursive: true })
    for (const name of ['visual-regression', 'state-structure', 'smoke']) writeFileSync(join(dir, `wt/tests/e2e/${name}.spec.ts`), '')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  interface Script {
    verify?: number[]
    /** One entry per E2E run (not counting the baseline update): the tests that end unexpectedly. */
    runs?: { status: string, message?: string, file?: string, line?: number }[][]
    update?: { status: string, message?: string }[]
    agent?: string[]
    changed?: string[][]
  }

  function setup(script: Script) {
    const calls: { cmd: string, args: readonly string[], env?: RunOptions['env'] }[] = []
    const stages: string[] = []
    const verify = [...(script.verify ?? [0])]
    const runs = [...(script.runs ?? [[]])]
    const agent = [...(script.agent ?? [])]
    const changed = [...(script.changed ?? [])]
    let reverted = 0
    let commits = 0
    const run: Runner = async (cmd, args, options) => {
      calls.push({ cmd, args, env: options.env })
      if (cmd === 'npm' && args[1] === 'verify') return { code: verify.shift() ?? 0, stdout: 'verify output', stderr: '', timedOut: false }
      if (cmd === 'git') return { code: 0, stdout: 'abc123\n', stderr: '', timedOut: false }
      if (cmd === 'node') return { code: 0, stdout: JSON.stringify({ tier: 'targeted', specs: ['smoke', 'welcome-setup'], args: ['--reporter=line', '--retries=1', 'tests/e2e/smoke.spec.ts', 'tests/e2e/welcome-setup.spec.ts'] }), stderr: '', timedOut: false }
      if (cmd === 'npm') {
        const update = args.includes('--update-snapshots=changed')
        const tests = update ? (script.update ?? []) : (runs.shift() ?? [])
        writeFileSync(options.env!.PLAYWRIGHT_JSON_OUTPUT_NAME!, jsonReport(tests))
        const failed = tests.filter(test => test.status === 'unexpected').length
        return { code: failed ? 1 : 0, stdout: '', stderr: '', timedOut: false }
      }
      return { code: 0, stdout: agent.shift() ?? '{"status":"fixed","notes":"updated a regex"}', stderr: '', timedOut: false }
    }
    const ctx: FollowUpContext = {
      worktree: join(dir, 'wt'),
      scratch: dir,
      run,
      agentCmd: 'claude',
      changes: [{ key: 'k', lang: 'de', before: 'Alt', after: 'Neu' }],
      stage: name => stages.push(name),
      note: () => {},
      commit: async () => { commits++; return 'abc123' },
      changedFiles: async () => changed.shift() ?? [],
      diffFiles: async () => ['i18n/locales/de.json'],
      revert: async () => { reverted++ },
    }
    return { ctx, calls, stages, reverted: () => reverted, commits: () => commits }
  }
  const e2eCalls = (calls: ReturnType<typeof setup>['calls']) => calls.filter(call => call.cmd === 'npm' && call.args[1] === 'test:e2e')
  const visual = { status: 'unexpected', message: 'toHaveScreenshot failed\nScreenshot comparison failed', line: 77 }
  const assertion = { status: 'unexpected', message: 'expect(locator).toContainText(/Alt/) failed', file: 'welcome-setup.spec.ts', line: 12 }

  it('verifies, then runs the gate\'s specs plus the baseline specs on a free port that is not the default, never the dev server', async () => {
    const { ctx, calls, stages } = setup({})
    const outcome = await runFollowUp(ctx)
    expect(outcome).toMatchObject({ ok: true, report: { tier: 'targeted', baselines: [], repairs: [] } })
    expect(stages).toEqual(['verify', 'specs'])
    const [first] = e2eCalls(calls)
    expect(first!.args).toEqual(['run', 'test:e2e', '--', '--reporter=line,json', '--retries=1', 'tests/e2e/smoke.spec.ts', 'tests/e2e/state-structure.spec.ts', 'tests/e2e/visual-regression.spec.ts', 'tests/e2e/welcome-setup.spec.ts'])
    expect(Number(first!.env!.PORT)).toBeGreaterThan(1023)
    expect(first!.env!.PORT).not.toBe('3000')
    expect(first!.env).toHaveProperty('BASE_URL', undefined)
    const gate = calls.find(call => call.cmd === 'node')!
    expect(gate.env).toMatchObject({ KANDO_TESTING_MODE: 'quality' })
  })

  it('does not run any spec when verify fails, and repairs once', async () => {
    const { ctx, calls, stages } = setup({ verify: [1, 0], changed: [['tests/store/a.test.ts']] })
    const outcome = await runFollowUp(ctx)
    expect(outcome).toMatchObject({ ok: true, report: { repairs: [{ round: 1, notes: 'updated a regex' }], repairedFiles: ['tests/store/a.test.ts'] } })
    expect(stages).toEqual(['verify', 'repair', 'verify', 'specs'])
    expect(e2eCalls(calls)).toHaveLength(1)
  })

  it('re-records only the failing baseline tests and commits them', async () => {
    const { ctx, calls, stages, commits } = setup({ runs: [[visual]], update: [], changed: [[`${SNAP}/a.png`, `${SNAP}/b.png`]] })
    const outcome = await runFollowUp(ctx)
    expect(outcome).toMatchObject({ ok: true, report: { baselines: [`${SNAP}/a.png`, `${SNAP}/b.png`] } })
    expect(stages).toEqual(['verify', 'specs', 'baselines'])
    const update = e2eCalls(calls)[1]!
    expect(update.args).toEqual(['run', 'test:e2e', '--', '--reporter=line,json', '--retries=0', '--update-snapshots=changed', 'tests/e2e/visual-regression.spec.ts:77'])
    expect(commits()).toBe(2)
  })

  it('refuses a baseline update that changes anything but baselines, or more than the cap', async () => {
    const stray = setup({ runs: [[visual]], changed: [[`${SNAP}/a.png`, 'tests/e2e/helpers/x.ts']] })
    expect(await runFollowUp(stray.ctx)).toMatchObject({ ok: false, stage: 'baselines', errors: [expect.stringContaining('tests/e2e/helpers/x.ts')] })
    const many = setup({ runs: [[visual]], changed: [Array.from({ length: MAX_BASELINES + 1 }, (_, i) => `${SNAP}/${i}.png`)] })
    expect(await runFollowUp(many.ctx)).toMatchObject({ ok: false, stage: 'baselines', errors: [expect.stringContaining('drift')] })
  })

  it('sends a red spec to the agent and checks again; a spec that stays red after two rounds ends as a failure', async () => {
    const fixed = setup({ runs: [[assertion], []], changed: [['tests/e2e/welcome-setup.spec.ts']] })
    expect(await runFollowUp(fixed.ctx)).toMatchObject({ ok: true, report: { repairs: [{ round: 1 }] } })
    expect(fixed.stages).toEqual(['verify', 'specs', 'repair', 'verify', 'specs'])

    const red = setup({ runs: [[assertion], [assertion], [assertion]], changed: [['tests/e2e/a.spec.ts'], ['tests/e2e/a.spec.ts']] })
    const outcome = await runFollowUp(red.ctx)
    expect(outcome).toMatchObject({ ok: false, stage: 'specs' })
    expect(red.stages.filter(stage => stage === 'repair')).toHaveLength(2)
  })

  it('aborts and reverts when the agent touches a file outside tests/, answers needs-owner or changes nothing', async () => {
    const outside = setup({ runs: [[assertion]], changed: [['tests/e2e/a.spec.ts', 'components/A.vue']] })
    expect(await runFollowUp(outside.ctx)).toMatchObject({ ok: false, stage: 'repair', errors: [expect.stringContaining('components/A.vue')] })
    expect(outside.reverted()).toBe(1)

    const owner = setup({ runs: [[assertion]], agent: ['{"status":"needs-owner","notes":"asserts no Todoist"}'], changed: [[]] })
    expect(await runFollowUp(owner.ctx)).toMatchObject({ ok: false, stage: 'repair', errors: ['needs the owner: asserts no Todoist'] })
    expect(owner.reverted()).toBe(1)

    const nothing = setup({ runs: [[assertion]], changed: [[]] })
    expect(await runFollowUp(nothing.ctx)).toMatchObject({ ok: false, stage: 'repair', errors: [expect.stringContaining('no change'), expect.anything()] })
  })
})
