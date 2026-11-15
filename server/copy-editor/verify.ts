/**
 * @module copy-editor/verify
 * @description The verification of a copy publish (#340, decisions D2, D4b, D5) in the throwaway tree, before anything
 * is pushed to `main`: `npm run verify` (what the pre-push hook runs), then exactly the specs the pre-merge E2E gate
 * selects for this diff (`scripts/e2e-gate.mjs`, quality mode so the label match is on, plus the visual and ARIA
 * baselines) against a production build on a free port. Visual and ARIA baselines that fail only because the copy moved
 * are re-recorded for those tests alone; any other failure goes to the repair agent (at most two rounds).
 * @responsibility Run checks, read their results, re-record baselines, loop with repairs. Git state and the commit are the caller's (`FollowUpContext`).
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { Runner } from './exec'
import type { ChangedValue } from './follow'
import { MAX_REPAIR_ROUNDS, outsideTests, runRepair, type Failure } from './repair'

export const VERIFY_TIMEOUT_MS = 900_000
export const SPECS_TIMEOUT_MS = 1_800_000
export const SELECT_TIMEOUT_MS = 60_000
/** More changed PNGs than this is drift of the baselines, not the copy. */
export const MAX_BASELINES = 30
/** Specs that always run for a copy change: the screens and the screen reader's view hold the copy without quoting it. */
export const ALWAYS_SPECS = ['visual-regression', 'state-structure'] as const
const SNAPSHOT_DIR = 'tests/e2e/snapshots/'

export interface TestFailure { file: string, line: number, title: string, message: string, kind: 'baseline' | 'other' }
export interface GateDecision { tier: string, specs: string[], args: string[] }
export interface FollowUpReport {
  tier: string
  specs: string[]
  baselines: string[]
  repairs: { round: number, notes: string }[]
  /** The tests the follow-up edited beyond the exact rewrite (repair rounds), for the commit body. */
  repairedFiles: string[]
}
export type FollowUpOutcome =
  | { ok: true, report: FollowUpReport }
  | { ok: false, stage: 'verify' | 'specs' | 'baselines' | 'repair', errors: string[], report: FollowUpReport }

export interface FollowUpContext {
  worktree: string
  scratch: string
  run: Runner
  agentCmd: string
  changes: readonly ChangedValue[]
  stage: (name: 'verify' | 'specs' | 'baselines' | 'repair') => void
  note: (text: string) => void
  /** Stages the allowed paths and commits (first call) or amends (later calls); returns the new head. */
  commit: () => Promise<string>
  /** Files that differ from HEAD (tracked changes and new files). */
  changedFiles: () => Promise<string[]>
  /** Names of the files the pending commit changes against `origin/main`. */
  diffFiles: () => Promise<string[]>
  /** Drops every uncommitted change. */
  revert: () => Promise<void>
  /**
   * Runs `fn` with the shared, git-ignored packages (the designer's real `node_modules`, linked into the tree) out of
   * reach. The tests/-only check reads `git status`, which never lists ignored or symlinked paths, so the repair agent
   * must not be able to write there at all.
   */
  withoutSharedPackages?: <T>(fn: () => Promise<T>) => Promise<T>
}

const stripAnsi = (text: string) => text.replace(/\u001B\[[0-9;]*m/g, '') // eslint-disable-line no-control-regex
const tail = (text: string, lines = 40) => stripAnsi(text).trim().split('\n').slice(-lines).join('\n')

/** A free TCP port from the OS: never the dev server's, so Playwright cannot reuse it and record from `nuxt dev`. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

const BASELINE_MESSAGE = /Screenshot comparison failed|A snapshot doesn't exist|toHaveScreenshot\(|toMatchAriaSnapshot\(/

export const isBaselineMessage = (message: string) => BASELINE_MESSAGE.test(stripAnsi(message))

/** The tests that ended unexpectedly in a Playwright JSON report (a test that passed on retry is not one). */
export function parsePlaywrightJson(text: string): TestFailure[] {
  const out: TestFailure[] = []
  const visit = (suite: unknown) => {
    const node = suite as { specs?: unknown[], suites?: unknown[] }
    for (const raw of node.specs ?? []) {
      const spec = raw as { title: string, file: string, line: number, tests?: { status?: string, results?: { error?: { message?: string }, errors?: { message?: string }[] }[] }[] }
      for (const test of spec.tests ?? []) {
        if (test.status !== 'unexpected') continue
        const last = test.results?.[test.results.length - 1]
        const message = stripAnsi(last?.error?.message ?? last?.errors?.[0]?.message ?? '')
        out.push({ file: spec.file, line: spec.line, title: spec.title, message, kind: isBaselineMessage(message) ? 'baseline' : 'other' })
      }
    }
    for (const child of node.suites ?? []) visit(child)
  }
  try {
    visit(JSON.parse(text))
  } catch { /* unreadable report: the caller treats a failed run without parsed failures as one generic failure */ }
  return out
}

/** The gate CLI's decision (`node scripts/e2e-gate.mjs`), or null when its output is not the expected JSON. */
export function parseGateDecision(stdout: string): GateDecision | null {
  try {
    const parsed = JSON.parse(stdout) as { tier?: unknown, specs?: unknown, args?: unknown }
    if (typeof parsed.tier !== 'string' || !Array.isArray(parsed.specs) || !Array.isArray(parsed.args)) return null
    return { tier: parsed.tier, specs: parsed.specs.map(String), args: parsed.args.map(String) }
  } catch {
    return null
  }
}

/** Playwright arguments: the gate's flags with the JSON report added, then the spec files. */
export function buildSpecArgs(decision: GateDecision, extra: readonly string[]): { args: string[], specs: string[] } {
  const flags = decision.args.filter(arg => !arg.endsWith('.spec.ts')).map(arg => (arg === '--reporter=line' ? '--reporter=line,json' : arg))
  if (decision.tier === 'full') return { args: flags, specs: ['(all)'] }
  const specs = [...new Set([...(decision.tier === 'skip' || decision.tier === 'style' ? [] : decision.specs), ...extra])].sort()
  return { args: [...flags, ...specs.map(name => `tests/e2e/${name}.spec.ts`)], specs }
}

/** Splits the files a baseline update changed into recorded baselines and anything else. */
export function splitChangedFiles(files: readonly string[]): { baselines: string[], other: string[] } {
  return {
    baselines: files.filter(file => file.startsWith(SNAPSHOT_DIR) && (file.endsWith('.png') || file.endsWith('.aria.yml'))),
    other: files.filter(file => !(file.startsWith(SNAPSHOT_DIR) && (file.endsWith('.png') || file.endsWith('.aria.yml')))),
  }
}

async function selectSpecs(ctx: FollowUpContext): Promise<GateDecision> {
  const files = await ctx.diffFiles()
  const head = (await ctx.run('git', ['rev-parse', 'HEAD'], { cwd: ctx.worktree, timeoutMs: 20_000 })).stdout.trim()
  const result = await ctx.run('node', ['--disable-warning=ExperimentalWarning', 'scripts/e2e-gate.mjs'], {
    cwd: ctx.worktree,
    input: JSON.stringify({ files, baseRefName: 'main', headRefOid: head }),
    // Quality mode on purpose: the label match (`byText`) is what finds the specs that quote the old copy.
    env: { KANDO_TESTING_MODE: 'quality', E2E_GATE: undefined },
    timeoutMs: SELECT_TIMEOUT_MS,
  })
  const decision = parseGateDecision(result.stdout)
  if (!decision) throw new Error(`the E2E gate selection failed: ${tail(result.stderr || result.stdout, 5)}`)
  return decision
}

interface SpecRun { ok: boolean, failures: TestFailure[], output: string }

async function playwright(ctx: FollowUpContext, args: readonly string[]): Promise<SpecRun> {
  const port = await freePort()
  const report = join(ctx.scratch, 'results.json')
  rmSync(report, { force: true })
  const result = await ctx.run('npm', ['run', 'test:e2e', '--', ...args], {
    cwd: ctx.worktree,
    timeoutMs: SPECS_TIMEOUT_MS,
    // An explicit free port and no BASE_URL: the suite builds and serves its own production build (never the dev server).
    env: { PORT: String(port), BASE_URL: undefined, CI: undefined, PLAYWRIGHT_JSON_OUTPUT_NAME: report },
  })
  const output = tail(`${result.stdout}\n${result.stderr}`)
  const failures = existsSync(report) ? parsePlaywrightJson(readFileSync(report, 'utf8')) : []
  if (result.timedOut) return { ok: false, failures: [{ file: '', line: 0, title: 'E2E run', message: 'the E2E run timed out', kind: 'other' }], output }
  if (result.code !== 0 && failures.length === 0) return { ok: false, failures: [{ file: '', line: 0, title: 'E2E run', message: output, kind: 'other' }], output }
  return { ok: result.code === 0, failures, output }
}

const toFailure = (failure: TestFailure): Failure => ({ stage: 'specs', name: failure.file ? `tests/e2e/${failure.file}:${failure.line} ${failure.title}` : failure.title, detail: failure.message })

/** Re-records the baselines of the failing visual/ARIA tests only, then checks that nothing else changed. */
async function recordBaselines(ctx: FollowUpContext, failures: readonly TestFailure[]): Promise<{ ok: true, baselines: string[] } | { ok: false, errors: string[] }> {
  const targets = [...new Set(failures.map(failure => `tests/e2e/${failure.file}:${failure.line}`))]
  const run = await playwright(ctx, ['--reporter=line,json', '--retries=0', '--update-snapshots=changed', ...targets])
  const { baselines, other } = splitChangedFiles(await ctx.changedFiles())
  if (!run.ok || run.failures.length > 0) return { ok: false, errors: ['re-recording the baselines failed', run.output] }
  if (other.length > 0) return { ok: false, errors: [`re-recording changed files that are not baselines: ${other.join(', ')}`] }
  const pngs = baselines.filter(file => file.endsWith('.png')).length
  if (pngs > MAX_BASELINES) return { ok: false, errors: [`${pngs} baselines changed (more than ${MAX_BASELINES}): that is drift, not this copy`] }
  return { ok: true, baselines }
}

export async function runFollowUp(ctx: FollowUpContext): Promise<FollowUpOutcome> {
  const report: FollowUpReport = { tier: '', specs: [], baselines: [], repairs: [], repairedFiles: [] }
  const fail = (stage: Extract<FollowUpOutcome, { ok: false }>['stage'], errors: string[]): FollowUpOutcome => ({ ok: false, stage, errors, report })
  for (let round = 0; ; round++) {
    await ctx.commit()
    const failures: Failure[] = []
    let baselineFailures: TestFailure[] = []

    ctx.stage('verify')
    const verified = await ctx.run('npm', ['run', 'verify'], { cwd: ctx.worktree, timeoutMs: VERIFY_TIMEOUT_MS })
    if (verified.code !== 0 || verified.timedOut) {
      failures.push({ stage: 'verify', name: 'npm run verify', detail: verified.timedOut ? 'timed out' : tail(`${verified.stdout}\n${verified.stderr}`) })
    } else {
      ctx.stage('specs')
      let selection: ReturnType<typeof buildSpecArgs>
      try {
        const decision = await selectSpecs(ctx)
        report.tier = decision.tier
        const extra = ALWAYS_SPECS.filter(name => existsSync(join(ctx.worktree, 'tests/e2e', `${name}.spec.ts`)))
        selection = buildSpecArgs(decision, extra)
        report.specs = selection.specs
      } catch (error) {
        return fail('specs', [error instanceof Error ? error.message : String(error)])
      }
      ctx.note(`specs: ${selection.specs.join(' ')}`)
      const ran = await playwright(ctx, selection.args)
      if (!ran.ok) {
        baselineFailures = ran.failures.filter(failure => failure.kind === 'baseline')
        for (const failure of ran.failures.filter(item => item.kind === 'other')) failures.push(toFailure(failure))
      }
    }

    if (failures.length === 0) {
      if (baselineFailures.length === 0) return { ok: true, report }
      ctx.stage('baselines')
      const recorded = await recordBaselines(ctx, baselineFailures)
      if (!recorded.ok) return fail('baselines', recorded.errors)
      report.baselines = recorded.baselines
      ctx.note(`baselines re-recorded: ${recorded.baselines.length}`)
      await ctx.commit()
      return { ok: true, report }
    }

    if (round >= MAX_REPAIR_ROUNDS) return fail(failures[0]!.stage, failures.map(failure => `${failure.name}\n${failure.detail}`))
    ctx.stage('repair')
    const agent = () => runRepair({ run: ctx.run, agentCmd: ctx.agentCmd, worktree: ctx.worktree, changes: ctx.changes, failures })
    const repair = await (ctx.withoutSharedPackages ? ctx.withoutSharedPackages(agent) : agent())
    const changed = await ctx.changedFiles()
    const outside = outsideTests(changed)
    if (outside.length > 0) {
      await ctx.revert()
      return fail('repair', [`the repair agent changed files outside tests/: ${outside.join(', ')}`])
    }
    if (!repair.ok) {
      await ctx.revert()
      return fail('repair', [repair.status === 'needs-owner' ? `needs the owner: ${repair.notes}` : repair.notes])
    }
    if (changed.length === 0) return fail('repair', ['the repair agent made no change', repair.notes])
    report.repairs.push({ round: round + 1, notes: repair.notes })
    report.repairedFiles = [...new Set([...report.repairedFiles, ...changed])].sort()
    ctx.note(`repair round ${round + 1}: ${repair.notes}`)
  }
}
