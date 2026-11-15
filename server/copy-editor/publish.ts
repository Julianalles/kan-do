/**
 * @module copy-editor/publish
 * @description Publish of the copy editor (#59, decision D6; #340): turns the collected edits into a commit on `main`
 * without touching the designer's checkout and without a pull request in between. A temporary detached worktree on
 * `origin/main` gets the two locale files, then the tests follow the new copy (exact rewrite, `follow.ts`), the change
 * is verified like a merge would be and the baselines that really moved are re-recorded (`verify.ts`, with a repair
 * round for the rest, `repair.ts`), and the one commit is pushed to `main` (never forced). When any of that fails, or
 * `main` moved meanwhile, the same commit goes to a `copy/...` branch with a PR that carries the failure report, which
 * is the flow before #340. The worktree and the local branch are removed afterwards, success or not.
 * @responsibility The git/gh sequence, its stages and error steps. Git, gh, the checks and the agent run through the injected `Runner`.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getLeaf, type MessageTree } from '../../lib/copy-editor/messages'
import type { TermEntry } from '../../lib/copy-editor/terms'
import type { Runner } from './exec'
import { rewriteTests, type Skipped } from './follow'
import { applyEdits, LOCALE_FILES } from './locales'
import { runFollowUp, type FollowUpContext, type FollowUpOutcome, type FollowUpReport } from './verify'
import { validateEdits, type Edit } from './validate'

export const BASE_BRANCH = 'main'
export const BRANCH_PREFIX = 'copy/'
export const SCRATCH_PREFIX = 'kando-copy-publish-'
const GIT_TIMEOUT_MS = 120_000
const CHECK_TIMEOUT_MS = 240_000
const PREPARE_TIMEOUT_MS = 300_000
/** A scratch directory older than this belongs to a job that died with its dev server. */
const STALE_SCRATCH_MS = 3 * 3_600_000

export type PublishStep = 'busy' | 'validate' | 'fetch' | 'worktree' | 'prepare' | 'check' | 'commit' | 'push' | 'internal'
/** What the Publish view shows while the job runs. */
export type PublishStage = 'prepare' | 'check' | 'rewrite' | 'verify' | 'specs' | 'baselines' | 'repair' | 'push'

export interface FollowUpSummary {
  /** Tests and snapshots the exact rewrite changed. */
  rewritten: string[]
  /** Changed values the exact rewrite left to the verify run (short or shared with another key). */
  skipped: Skipped[]
  baselines: string[]
  repairs: { round: number, notes: string }[]
  repairedFiles: string[]
  specs: string[]
  tier: string
}
export interface Failure { stage: string, errors: string[] }
export type PublishResult =
  | { ok: true, landed: 'main' | 'branch', commit: string | null, branch: string | null, prUrl: string | null, note: string | null, edits: number, files: number, warnings: string[], followUp: FollowUpSummary, failure: Failure | null }
  | { ok: false, step: PublishStep, errors: string[] }

export interface PublishDeps {
  /** The dev server's checkout (any git work tree of the repository). */
  root: string
  run: Runner
  terms: readonly TermEntry[]
  now?: () => Date
  /** The agent command of the repair round (`KANDO_COPY_AGENT_CMD`, default `claude`). */
  agentCmd?: string
  /** Generates Nuxt's types in the throwaway worktree (its own `.nuxt`, never the dev server's); replaced in tests. */
  prepare?: (worktree: string) => Promise<{ ok: boolean, output: string }>
  /** Runs `i18n:check` in the throwaway worktree; replaced in tests. */
  check?: (worktree: string) => Promise<{ ok: boolean, output: string }>
  /** The follow-up after the locale commit: verify, baselines, repair; replaced in tests. */
  followUp?: (ctx: FollowUpContext) => Promise<FollowUpOutcome>
  onStage?: (stage: PublishStage) => void
  onNote?: (text: string) => void
}

let running = false

const tail = (text: string, lines = 30) => text.trim().split('\n').slice(-lines).join('\n')
const pad = (n: number) => String(n).padStart(2, '0')
const isAllowedPath = (file: string) => file.startsWith('tests/') || file === LOCALE_FILES.de || file === LOCALE_FILES.en

export function branchName(edits: readonly Edit[], now: Date): string {
  const slug = (edits[0]?.key ?? 'copy').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'copy'
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${BRANCH_PREFIX}${stamp}-${slug}`
}

export function prTitle(edits: readonly Edit[]): string {
  return `chore(copy): update UI copy (${edits.length} ${edits.length === 1 ? 'key' : 'keys'})`
}

const list = (files: readonly string[], limit = 12) => (files.length <= limit ? files : [...files.slice(0, limit), `… and ${files.length - limit} more`]).map(file => `  - ${file}`)

/** The commit body: what the follow-up changed beyond the locale files, so a reviewer of `git show` sees it. */
export function commitBody(summary: FollowUpSummary): string {
  const lines = ['Created with the live copy editor (dev tool).']
  if (summary.rewritten.length) lines.push('', `Tests and snapshots rewritten to the new copy (${summary.rewritten.length}):`, ...list(summary.rewritten))
  if (summary.repairs.length) lines.push('', `Repaired by the agent (${summary.repairs.length} ${summary.repairs.length === 1 ? 'round' : 'rounds'}, review these):`, ...summary.repairs.map(repair => `  - round ${repair.round}: ${repair.notes}`), ...list(summary.repairedFiles))
  if (summary.baselines.length) lines.push('', `Baselines re-recorded (${summary.baselines.length}):`, ...list(summary.baselines))
  if (summary.specs.length) lines.push('', `Verified: npm run verify, E2E ${summary.specs.join(' ')}.`)
  return lines.join('\n')
}

export function prBody(edits: readonly Edit[], before: { de: MessageTree, en: MessageTree }, failure: Failure | null = null, summary: FollowUpSummary | null = null): string {
  const rows = edits.map(edit => [
    `- \`${edit.key}\``,
    `  - de: ${getLeaf(before.de, edit.key) === edit.de ? 'unchanged' : `${JSON.stringify(getLeaf(before.de, edit.key))} → ${JSON.stringify(edit.de)}`}`,
    `  - en: ${getLeaf(before.en, edit.key) === edit.en ? 'unchanged' : `${JSON.stringify(getLeaf(before.en, edit.key))} → ${JSON.stringify(edit.en)}`}`,
  ].join('\n'))
  return [
    `Copy changes from the live copy editor (dev tool): ${edits.length} ${edits.length === 1 ? 'key' : 'keys'} in \`i18n/locales/de.json\` and \`en.json\`.`,
    '',
    ...rows,
    '',
    ...(failure
      ? [
          `## Not landed on main: the \`${failure.stage}\` step failed`,
          '',
          'Publish did not push to `main`; the follow-up of the tests is on this branch as far as it got and needs the owner.',
          '',
          '```',
          ...failure.errors.map(error => tail(error, 25)),
          '```',
          '',
          ...(summary ? [commitBody(summary), ''] : []),
        ]
      : []),
    'A language the designer did not write may be an agent translation that was reviewed before publishing. `i18n:check` passed on this branch before the push.',
  ].join('\n')
}

async function defaultPrepare(run: Runner, worktree: string) {
  const result = await run('npx', ['nuxt', 'prepare'], { cwd: worktree, timeoutMs: PREPARE_TIMEOUT_MS, env: { NODE_ENV: undefined } })
  return { ok: result.code === 0 && !result.timedOut, output: tail(`${result.stdout}\n${result.stderr}`, 40) }
}

async function defaultCheck(run: Runner, worktree: string) {
  const result = await run('npx', ['vitest', 'run', 'tests/i18n'], { cwd: worktree, timeoutMs: CHECK_TIMEOUT_MS, env: { NODE_ENV: undefined } })
  return { ok: result.code === 0 && !result.timedOut, output: tail(`${result.stdout}\n${result.stderr}`, 40) }
}

/** Scratch directories of jobs that died with their dev server (the finally block never ran). */
function sweepStale(now = Date.now()) {
  try {
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith(SCRATCH_PREFIX)) continue
      const dir = join(tmpdir(), name)
      if (now - statSync(dir).mtimeMs > STALE_SCRATCH_MS) rmSync(dir, { recursive: true, force: true })
    }
  } catch { /* nothing to sweep */ }
}

const emptySummary = (): FollowUpSummary => ({ rewritten: [], skipped: [], baselines: [], repairs: [], repairedFiles: [], specs: [], tier: '' })

export async function publish(input: unknown, deps: PublishDeps): Promise<PublishResult> {
  if (running) return { ok: false, step: 'busy', errors: ['another publish is still running'] }
  running = true
  const { root, run, terms } = deps
  const stage = (name: PublishStage) => deps.onStage?.(name)
  const note = (text: string) => deps.onNote?.(text)
  const git = (args: string[], cwd = root, timeoutMs = GIT_TIMEOUT_MS) => run('git', args, { cwd, timeoutMs })
  let scratch: string | null = null
  let worktree: string | null = null
  let branch: string | null = null
  try {
    sweepStale()
    stage('prepare')
    const fetched = await git(['fetch', 'origin', BASE_BRANCH])
    if (fetched.code !== 0) return { ok: false, step: 'fetch', errors: [`git fetch origin ${BASE_BRANCH} failed: ${tail(fetched.stderr, 5)}`] }

    const base: { de: MessageTree, en: MessageTree } = { de: {}, en: {} }
    for (const lang of ['de', 'en'] as const) {
      const shown = await git(['show', `origin/${BASE_BRANCH}:${LOCALE_FILES[lang]}`])
      if (shown.code !== 0) return { ok: false, step: 'fetch', errors: [`cannot read ${LOCALE_FILES[lang]} on origin/${BASE_BRANCH}`] }
      base[lang] = JSON.parse(shown.stdout) as MessageTree
    }

    const validated = validateEdits(input, base, terms)
    if (!validated.ok) return { ok: false, step: 'validate', errors: validated.errors }
    const edits = validated.value

    await git(['worktree', 'prune'])
    scratch = mkdtempSync(join(tmpdir(), SCRATCH_PREFIX))
    worktree = join(scratch, 'wt')
    const wt = worktree
    const added = await git(['worktree', 'add', '--detach', wt, `origin/${BASE_BRANCH}`])
    if (added.code !== 0) return { ok: false, step: 'worktree', errors: [`git worktree add failed: ${tail(added.stderr, 5)}`] }
    // Installed packages are shared. `.nuxt` is NOT: the build and `nuxt prepare` write into it, and the dev server is using the real one.
    if (existsSync(join(root, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(wt, 'node_modules'))
    const prepared = await (deps.prepare ?? (tree => defaultPrepare(run, tree)))(wt)
    if (!prepared.ok) return { ok: false, step: 'prepare', errors: ['nuxt prepare failed in the temporary worktree', prepared.output] }

    const files = applyEdits(base, edits)
    mkdirSync(join(wt, 'i18n/locales'), { recursive: true })
    writeFileSync(join(wt, LOCALE_FILES.de), files.de)
    writeFileSync(join(wt, LOCALE_FILES.en), files.en)

    stage('check')
    const checked = await (deps.check ?? (tree => defaultCheck(run, tree)))(wt)
    if (!checked.ok) return { ok: false, step: 'check', errors: ['npm run i18n:check failed', checked.output] }

    stage('rewrite')
    const rewrite = rewriteTests(wt, base, edits)
    note(`rewrite: ${rewrite.files.length} files${rewrite.skipped.length ? `, ${rewrite.skipped.length} values left to the checks` : ''}`)

    let committed = false
    const commit = async () => {
      const add = await git(['add', '-A', '--', 'tests', 'i18n/locales'], wt)
      if (add.code !== 0) throw new Error(`git add failed: ${tail(add.stderr, 5)}`)
      const stray = (await git(['status', '--porcelain', '-z', '--untracked-files=no'], wt)).stdout.split('\0').filter(Boolean).map(line => line.slice(3)).filter(file => !isAllowedPath(file))
      if (stray.length) throw new Error(`unexpected changes outside tests/ and the locale files: ${stray.join(', ')}`)
      const result = committed
        ? await git(['commit', '--amend', '--no-edit', '--allow-empty'], wt)
        : await git(['commit', '-m', prTitle(edits), '-m', 'Created with the live copy editor (dev tool).'], wt)
      if (result.code !== 0) throw new Error(`git commit failed: ${tail(result.stderr || result.stdout, 5)}`)
      committed = true
      return (await git(['rev-parse', 'HEAD'], wt)).stdout.trim()
    }
    const changedFiles = async () => (await git(['status', '--porcelain', '-z', '--untracked-files=all'], wt)).stdout.split('\0').filter(Boolean).map(line => line.slice(3))
    const diffFiles = async () => (await git(['diff', '--name-only', `origin/${BASE_BRANCH}`, 'HEAD'], wt)).stdout.split('\n').filter(Boolean)
    const revert = async () => {
      await git(['reset', '--hard', 'HEAD'], wt)
      await git(['clean', '-fd', '--', 'tests', 'i18n/locales'], wt)
    }

    const ctx: FollowUpContext = {
      worktree: wt,
      scratch,
      run,
      agentCmd: deps.agentCmd ?? process.env.KANDO_COPY_AGENT_CMD ?? 'claude',
      changes: rewrite.changes,
      stage: name => stage(name),
      note,
      commit,
      changedFiles,
      diffFiles,
      revert,
    }
    const outcome = await (deps.followUp ?? runFollowUp)(ctx)
    await commit() // whatever the follow-up left uncommitted (it normally commits itself)
    const report: FollowUpReport = outcome.report
    const summary: FollowUpSummary = { ...emptySummary(), ...report, rewritten: rewrite.files, skipped: rewrite.skipped }
    // The commit message carries what the follow-up did, not only the title.
    const amended = await git(['commit', '--amend', '-m', prTitle(edits), '-m', commitBody(summary)], wt)
    if (amended.code !== 0) throw new Error(`git commit failed: ${tail(amended.stderr || amended.stdout, 5)}`)
    const fileCount = (await diffFiles()).length
    const head = (await git(['rev-parse', 'HEAD'], wt)).stdout.trim()

    let failure: Failure | null = outcome.ok ? null : { stage: outcome.stage, errors: outcome.errors }
    if (!failure) {
      stage('push')
      // Straight to main, never forced: the verified tree is the one that lands, and a moved main is a rejection, not a rebase.
      const pushed = await git(['push', '--no-verify', 'origin', `HEAD:refs/heads/${BASE_BRANCH}`], wt)
      if (pushed.code === 0) return { ok: true, landed: 'main', commit: head, branch: null, prUrl: null, note: null, edits: edits.length, files: fileCount, warnings: validated.warnings, followUp: summary, failure: null }
      failure = { stage: 'push', errors: [`git push to ${BASE_BRANCH} was rejected (${BASE_BRANCH} moved while publishing?): ${tail(pushed.stderr, 8)}`] }
    }

    // The follow-up did not finish or main moved: the pre-#340 flow, with the report in the PR.
    branch = branchName(edits, (deps.now ?? (() => new Date()))())
    const checkout = await git(['checkout', '-b', branch], wt)
    if (checkout.code !== 0) return { ok: false, step: 'commit', errors: [`git checkout failed: ${tail(checkout.stderr, 5)}`, ...failure.errors] }
    const pushedBranch = await git(['push', '--no-verify', 'origin', `HEAD:refs/heads/${branch}`], wt)
    if (pushedBranch.code !== 0) return { ok: false, step: 'push', errors: [`git push failed: ${tail(pushedBranch.stderr, 8)}`, ...failure.errors] }
    const pr = await run('gh', ['pr', 'create', '--base', BASE_BRANCH, '--head', branch, '--title', prTitle(edits), '--body', prBody(edits, base, failure, summary)], { cwd: wt, timeoutMs: GIT_TIMEOUT_MS })
    const url = /https?:\/\/\S+/.exec(pr.stdout)?.[0] ?? null
    const prNote = pr.code === 0 && url ? null : `Branch ${branch} is pushed, but the pull request was not created (${tail(pr.stderr || pr.stdout, 3) || 'gh unavailable'}). Open it from GitHub.`
    return { ok: true, landed: 'branch', commit: head, branch, prUrl: url, note: prNote, edits: edits.length, files: fileCount, warnings: validated.warnings, followUp: summary, failure }
  } catch (error) {
    return { ok: false, step: 'internal', errors: [error instanceof Error ? error.message : String(error)] }
  } finally {
    if (worktree) await git(['worktree', 'remove', '--force', worktree])
    if (branch) await git(['branch', '-D', branch])
    if (scratch) rmSync(scratch, { recursive: true, force: true })
    running = false
  }
}
