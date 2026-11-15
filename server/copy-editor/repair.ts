/**
 * @module copy-editor/repair
 * @description The repair round of Publish (#340, decision D4b): what stays red after the exact rewrite (a regex or
 * fragment of the old copy, an assertion whose meaning conflicts with the new text) goes to the local agent CLI. It
 * runs with file tools only (no Bash), in the throwaway tree, without project hooks, and may touch `tests/` alone:
 * the caller reverts and aborts when anything else changed. The agent answers `fixed` or `needs-owner` (an assertion's
 * meaning, not only its quoted text, conflicts with the new copy: the owner decides).
 * @responsibility Prompt, call, reply parsing and the path check. The runner is injected; nothing is pushed.
 */
import type { ChangedValue } from './follow'
import type { Runner } from './exec'

export const REPAIR_TIMEOUT_MS = 600_000
export const MAX_REPAIR_ROUNDS = 2

export interface Failure { stage: 'verify' | 'specs', name: string, detail: string }
export interface RepairReply { status: 'fixed' | 'needs-owner', notes: string }

const MAX_DETAIL = 1500
const MAX_FAILURES = 25

export function buildRepairPrompt(changes: readonly ChangedValue[], failures: readonly Failure[]): string {
  const changed = changes.map(change => ({ key: change.key, lang: change.lang, old: change.before, new: change.after }))
  const failing = failures.slice(0, MAX_FAILURES).map(failure => ({ stage: failure.stage, name: failure.name, error: failure.detail.slice(-MAX_DETAIL) }))
  return [
    'The UI copy of the kan-do app was changed (the product designer edited it). The tests quote the old copy and now fail.',
    'Fix the tests so they follow the new copy. Edit files below `tests/` only (specs, helpers, unit tests, `.aria.yml` snapshots). Never edit the app, the locale files or anything outside `tests/`.',
    'Change only what the new copy requires: update quoted text, regexes and fragments that name the old copy. Keep every assertion\'s intent.',
    'If an assertion\'s meaning (not only its quoted text) conflicts with the new copy (for example a test asserts that some word is absent and the new text uses it), do not edit that test: answer `needs-owner` and name it.',
    'Do not touch visual baselines (PNG files); they are re-recorded separately.',
    'Reply with JSON only, no prose and no code fence: {"status":"fixed"|"needs-owner","notes":"<one or two sentences: what you changed, or which test needs the owner and why>"}',
    '',
    'Changed copy:',
    JSON.stringify(changed),
    '',
    'Failing checks (stage, name, error tail):',
    JSON.stringify(failing),
  ].join('\n')
}

/** The agent's reply out of `claude -p --output-format json` stdout; a code fence around the JSON is tolerated. */
export function parseRepairReply(stdout: string): RepairReply | null {
  let text = stdout.trim()
  try {
    const envelope = JSON.parse(text) as { result?: unknown, is_error?: unknown, status?: unknown }
    if (envelope.is_error === true) return null
    if (typeof envelope.result === 'string') text = envelope.result.trim()
    else if (envelope.status !== undefined) text = JSON.stringify(envelope)
  } catch { /* not an envelope: treat stdout as the answer */ }
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(text) as { status?: unknown, notes?: unknown }
    if (parsed.status !== 'fixed' && parsed.status !== 'needs-owner') return null
    return { status: parsed.status, notes: typeof parsed.notes === 'string' ? parsed.notes.trim().slice(0, 600) : '' }
  } catch {
    return null
  }
}

/** Files that changed (tracked or new) and are not below `tests/`: the agent may not touch them. */
export function outsideTests(changed: readonly string[]): string[] {
  return changed.filter(file => !file.startsWith('tests/') || file.includes('..'))
}

/** Arguments of the agent call: file tools only, edits accepted, no project settings (hooks), no MCP, no session. */
export const repairArgs = (): string[] => [
  '-p', '--output-format', 'json', '--tools', 'Read,Edit,Grep,Glob', '--permission-mode', 'acceptEdits',
  '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config', '--setting-sources', 'user',
]

export type RepairOutcome =
  | { ok: true, status: 'fixed', notes: string }
  | { ok: false, status: 'needs-owner' | 'failed', notes: string }

export async function runRepair(
  deps: { run: Runner, agentCmd: string, worktree: string, changes: readonly ChangedValue[], failures: readonly Failure[] },
): Promise<RepairOutcome> {
  const result = await deps.run(deps.agentCmd, repairArgs(), {
    cwd: deps.worktree,
    input: buildRepairPrompt(deps.changes, deps.failures),
    timeoutMs: REPAIR_TIMEOUT_MS,
  })
  if (result.timedOut) return { ok: false, status: 'failed', notes: `the repair agent did not answer within ${REPAIR_TIMEOUT_MS / 1000} s` }
  if (result.code !== 0) return { ok: false, status: 'failed', notes: `the repair agent failed (${result.code ?? 'not started'}): ${(result.stderr || result.stdout).trim().slice(0, 300)}` }
  const reply = parseRepairReply(result.stdout)
  if (!reply) return { ok: false, status: 'failed', notes: 'the repair agent answered in an unexpected format' }
  return reply.status === 'fixed' ? { ok: true, status: 'fixed', notes: reply.notes } : { ok: false, status: 'needs-owner', notes: reply.notes }
}
