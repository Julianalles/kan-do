// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TermEntry } from '~/lib/copy-editor/terms'
import { run as realRun, type Runner } from '~/server/copy-editor/exec'
import { branchName, commitBody, publish, type PublishDeps, type PublishStage } from '~/server/copy-editor/publish'
import type { FollowUpContext, FollowUpOutcome, FollowUpReport } from '~/server/copy-editor/verify'

// The git flow runs for real against a throwaway bare remote and clone (never this repository); `gh` is faked.
const dirs: string[] = []
const tmp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const de = { a: { title: 'Aufgabe {name}' }, b: 'Zurück' }
const en = { a: { title: 'Task {name}' }, b: 'Back' }
const terms: TermEntry[] = [{ id: 'src', de: 'Verbindung', en: 'connection', avoidDe: ['Quelle'], avoidEn: [], status: 'decided' }]

let remote: string
let clone: string

beforeEach(() => {
  remote = tmp('copy-remote-')
  git(remote, 'init', '-q', '--bare', '-b', 'main')
  clone = tmp('copy-clone-')
  git(clone, 'init', '-q', '-b', 'main')
  // own identity, repo-local (worktrees share it): publish() commits without env, CI runners have no global one
  git(clone, 'config', 'user.name', 't')
  git(clone, 'config', 'user.email', 't@t')
  mkdirSync(join(clone, 'i18n/locales'), { recursive: true })
  mkdirSync(join(clone, 'tests/e2e'), { recursive: true })
  mkdirSync(join(clone, 'node_modules'), { recursive: true })
  mkdirSync(join(clone, '.nuxt'), { recursive: true })
  writeFileSync(join(clone, '.gitignore'), 'node_modules\n.nuxt\n')
  writeFileSync(join(clone, 'README.md'), 'readme\n')
  writeFileSync(join(clone, 'tests/e2e/a.spec.ts'), "expect(page.getByText('Zurück')).toBeVisible()\n")
  writeFileSync(join(clone, 'i18n/locales/de.json'), json(de))
  writeFileSync(join(clone, 'i18n/locales/en.json'), json(en))
  git(clone, 'add', '.')
  git(clone, 'commit', '-q', '-m', 'init')
  git(clone, 'remote', 'add', 'origin', remote)
  git(clone, 'push', '-q', 'origin', 'main')
  // a dirty checkout and an unrelated branch must stay untouched
  writeFileSync(join(clone, 'i18n/locales/de.json'), json({ ...de, b: 'LOCAL WIP' }))
})

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const withGh = (url: string | null): Runner => async (cmd, args, options) => {
  if (cmd === 'gh') return url ? { code: 0, stdout: `${url}\n`, stderr: '', timedOut: false } : { code: 1, stdout: '', stderr: 'gh: not logged in', timedOut: false }
  return realRun(cmd, args, options)
}
const passingCheck = async () => ({ ok: true, output: '' })
const report: FollowUpReport = { tier: 'targeted', specs: ['smoke', 'visual-regression'], baselines: [], repairs: [], repairedFiles: [] }
/** A follow-up that passes: it commits like the real one does. */
const greenFollowUp = async (ctx: FollowUpContext): Promise<FollowUpOutcome> => { await ctx.commit(); return { ok: true, report } }
const base = (extra: Partial<PublishDeps> = {}) => ({ prepare: passingCheck, check: passingCheck, followUp: greenFollowUp, ...extra })
const edits = [{ key: 'b', de: 'Zurück zur Liste', en: 'Back to the list' }]

describe('copy editor publish', () => {
  it('lands one commit on main with the locale files and the rewritten test, and leaves the checkout alone', async () => {
    const stages: PublishStage[] = []
    const result = await publish({ edits }, { root: clone, run: withGh('https://github.com/o/r/pull/7'), terms, ...base({ onStage: stage => stages.push(stage) }), now: () => new Date(2026, 10, 9, 12, 30, 5) })
    expect(result).toMatchObject({ ok: true, landed: 'main', branch: null, prUrl: null, note: null, edits: 1, files: 3, failure: null })
    expect(stages).toEqual(['prepare', 'check', 'rewrite', 'push'])

    expect(git(remote, 'branch', '--list').replace(/[\s*]+/g, ' ').trim()).toBe('main')
    expect(git(remote, 'log', '-1', '--name-only', '--format=%s', 'main').trim().split('\n').sort()).toEqual(['', 'chore(copy): update UI copy (1 key)', 'i18n/locales/de.json', 'i18n/locales/en.json', 'tests/e2e/a.spec.ts'].sort())
    expect(JSON.parse(git(remote, 'show', 'main:i18n/locales/de.json')).b).toBe('Zurück zur Liste')
    expect(git(remote, 'show', 'main:tests/e2e/a.spec.ts')).toContain("'Zurück zur Liste'")
    expect(git(remote, 'log', '-1', '--format=%B', 'main')).toContain('Tests and snapshots rewritten to the new copy (1)')
    expect((result as { commit: string }).commit).toBe(git(remote, 'rev-parse', 'main').trim())

    // the designer's checkout: still on main, WIP intact, no leftover worktree or branch
    expect(readFileSync(join(clone, 'i18n/locales/de.json'), 'utf8')).toContain('LOCAL WIP')
    expect(git(clone, 'branch', '--list').replace(/[\s*]+/g, ' ').trim()).toBe('main')
    expect(git(clone, 'worktree', 'list').trim().split('\n')).toHaveLength(1)
  })

  it('gives the throwaway tree the shared packages but its own .nuxt, never the dev server\'s', async () => {
    let seen: { nodeModules: boolean, nuxt: boolean } | null = null
    const followUp = async (ctx: FollowUpContext): Promise<FollowUpOutcome> => {
      seen = { nodeModules: lstatSync(join(ctx.worktree, 'node_modules')).isSymbolicLink(), nuxt: existsSync(join(ctx.worktree, '.nuxt')) }
      return greenFollowUp(ctx)
    }
    await publish({ edits }, { root: clone, run: withGh(null), terms, ...base({ followUp }) })
    expect(seen).toEqual({ nodeModules: true, nuxt: false })
  })

  it('changes only the edited language on origin/main when the local checkout is behind it', async () => {
    // main moves on (newer English copy for key b) after the designer's clone last fetched
    const other = tmp('copy-other-')
    git(other, 'clone', '-q', remote, '.')
    writeFileSync(join(other, 'i18n/locales/en.json'), json({ ...en, b: 'Go back' }))
    git(other, 'commit', '-qam', 'newer en copy')
    git(other, 'push', '-q', 'origin', 'main')
    const stale = [{ key: 'b', de: 'Zurück zur Liste', en: 'Back', changed: ['de'] }]
    const result = await publish({ edits: stale }, { root: clone, run: withGh(null), terms, ...base() })
    expect(result).toMatchObject({ ok: true, landed: 'main' })
    expect(JSON.parse(git(remote, 'show', 'main:i18n/locales/de.json')).b).toBe('Zurück zur Liste')
    expect(JSON.parse(git(remote, 'show', 'main:i18n/locales/en.json')).b).toBe('Go back')
  })

  it('pushes nothing to main when a follow-up step fails: a copy branch and a PR with the failure report instead', async () => {
    const followUp = async (ctx: FollowUpContext): Promise<FollowUpOutcome> => {
      await ctx.commit()
      return { ok: false, stage: 'specs', errors: ['tests/e2e/welcome-setup.spec.ts:12 shows the intro\nexpect(locator).toContainText failed'], report }
    }
    let prBody = ''
    const run: Runner = async (cmd, args, options) => {
      if (cmd === 'gh') { prBody = args[args.indexOf('--body') + 1]!; return { code: 0, stdout: 'https://github.com/o/r/pull/8\n', stderr: '', timedOut: false } }
      return realRun(cmd, args, options)
    }
    const mainBefore = git(remote, 'rev-parse', 'main')
    const result = await publish({ edits }, { root: clone, run, terms, ...base({ followUp }), now: () => new Date(2026, 10, 9, 12, 30, 5) })
    expect(result).toMatchObject({ ok: true, landed: 'branch', branch: 'copy/20261109-123005-b', prUrl: 'https://github.com/o/r/pull/8', failure: { stage: 'specs' } })
    expect(git(remote, 'rev-parse', 'main')).toBe(mainBefore)
    expect(git(remote, 'diff', '--name-only', 'main', 'copy/20261109-123005-b').trim().split('\n').sort()).toEqual(['i18n/locales/de.json', 'i18n/locales/en.json', 'tests/e2e/a.spec.ts'])
    expect(prBody).toContain('Not landed on main: the `specs` step failed')
    expect(prBody).toContain('welcome-setup.spec.ts:12')
    expect(git(clone, 'branch', '--list').replace(/[\s*]+/g, ' ').trim()).toBe('main')
  })

  it('falls back to the branch when main moved while the checks ran, and never forces', async () => {
    const other = tmp('copy-other-')
    git(other, 'clone', '-q', remote, '.')
    const followUp = async (ctx: FollowUpContext): Promise<FollowUpOutcome> => {
      writeFileSync(join(other, 'unrelated.txt'), 'x')
      git(other, 'add', '.')
      git(other, 'commit', '-qm', 'someone else pushed')
      git(other, 'push', '-q', 'origin', 'main')
      return greenFollowUp(ctx)
    }
    const result = await publish({ edits }, { root: clone, run: withGh('https://github.com/o/r/pull/9'), terms, ...base({ followUp }), now: () => new Date(2026, 10, 9, 12, 30, 5) })
    expect(result).toMatchObject({ ok: true, landed: 'branch', failure: { stage: 'push' } })
    expect(git(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('someone else pushed')
    expect(git(remote, 'branch', '--list').replace(/[\s*]+/g, ' ').trim()).toBe('copy/20261109-123005-b main')
  })

  it('refuses a commit that touches anything but tests/ and the locale files', async () => {
    const followUp = async (ctx: FollowUpContext): Promise<FollowUpOutcome> => {
      writeFileSync(join(ctx.worktree, 'README.md'), 'changed by the agent\n')
      return greenFollowUp(ctx)
    }
    const mainBefore = git(remote, 'rev-parse', 'main')
    const result = await publish({ edits }, { root: clone, run: withGh(null), terms, ...base({ followUp }) })
    expect(result).toMatchObject({ ok: false, step: 'internal', errors: [expect.stringContaining('README.md')] })
    expect(git(remote, 'rev-parse', 'main')).toBe(mainBefore)
    expect(git(remote, 'branch', '--list').replace(/[\s*]+/g, '')).toBe('main')
  })

  it('keeps the pushed branch and reports a note when the pull request cannot be created', async () => {
    const followUp = async (ctx: FollowUpContext): Promise<FollowUpOutcome> => {
      await ctx.commit()
      return { ok: false, stage: 'verify', errors: ['npm run verify\nlint failed'], report }
    }
    const result = await publish({ edits }, { root: clone, run: withGh(null), terms, ...base({ followUp }) })
    expect(result).toMatchObject({ ok: true, landed: 'branch', prUrl: null })
    expect((result as { note: string }).note).toContain('is pushed')
  })

  it('fails with the step name and pushes nothing for invalid edits, a failed prepare or check, or an unreachable remote', async () => {
    const invalid = await publish({ edits: [{ key: 'b', de: 'Quelle', en: 'Back' }] }, { root: clone, run: withGh(null), terms, ...base() })
    expect(invalid).toMatchObject({ ok: false, step: 'validate' })
    const failedPrepare = await publish({ edits }, { root: clone, run: withGh(null), terms, ...base({ prepare: async () => ({ ok: false, output: 'nuxt broke' }) }) })
    expect(failedPrepare).toMatchObject({ ok: false, step: 'prepare', errors: ['nuxt prepare failed in the temporary worktree', 'nuxt broke'] })
    const failedCheck = await publish({ edits }, { root: clone, run: withGh(null), terms, ...base({ check: async () => ({ ok: false, output: 'FAIL terminology' }) }) })
    expect(failedCheck).toMatchObject({ ok: false, step: 'check', errors: ['npm run i18n:check failed', 'FAIL terminology'] })
    expect(git(remote, 'branch', '--list').replace(/[\s*]+/g, '')).toBe('main')
    git(clone, 'remote', 'set-url', 'origin', join(remote, 'does-not-exist'))
    expect(await publish({ edits }, { root: clone, run: withGh(null), terms, ...base() })).toMatchObject({ ok: false, step: 'fetch' })
  })

  it('never builds a branch name outside copy/ and slugs the first key', () => {
    expect(branchName([{ key: 'A.b/../c', de: 'x', en: 'y' }], new Date(2026, 0, 2, 3, 4, 5))).toBe('copy/20260102-030405-a-b-c')
    expect(branchName([], new Date(2026, 0, 2, 3, 4, 5))).toBe('copy/20260102-030405-copy')
  })

  it('lists the follow-up in the commit body: rewritten tests, agent repairs to review, baselines, specs', () => {
    const body = commitBody({ rewritten: ['tests/e2e/a.spec.ts'], skipped: [], baselines: ['tests/e2e/snapshots/v/a.png'], repairs: [{ round: 1, notes: 'updated a regex' }], repairedFiles: ['tests/e2e/b.spec.ts'], specs: ['smoke'], tier: 'targeted' })
    expect(body).toContain('Tests and snapshots rewritten to the new copy (1):')
    expect(body).toContain('Repaired by the agent (1 round, review these):')
    expect(body).toContain('round 1: updated a regex')
    expect(body).toContain('Baselines re-recorded (1):')
    expect(body).toContain('Verified: npm run verify, E2E smoke.')
  })

  it('refuses a second publish while one runs', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slow = publish({ edits }, { root: clone, run: withGh(null), terms, ...base({ check: async () => { await gate; return { ok: true, output: '' } } }) })
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(await publish({ edits }, { root: clone, run: withGh(null), terms, ...base() })).toMatchObject({ ok: false, step: 'busy' })
    release()
    await slow
  })
})
