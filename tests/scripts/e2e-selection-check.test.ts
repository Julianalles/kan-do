import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// #699: wf_pr_body_check refuses an `E2E-specs:` line that misses specs the pre-merge gate selects for the diff.
const root = resolve(__dirname, '../..')
const tmp = mkdtempSync(join(tmpdir(), 'e2e-selection-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** Runs the check in the real checkout with a given list of changed files; `null` = passed. */
function check(files: string[], body: string): string | null {
  const bodyFile = join(tmp, 'body.md')
  writeFileSync(bodyFile, body)
  try {
    execFileSync('bash', ['-c', `source .claude/issue-workflow.sh; wf_e2e_selection_check "${bodyFile}" "$FILES"`], { cwd: root, stdio: 'pipe', env: { ...process.env, FILES: files.join('\n') } })
    return null
  } catch (err) {
    return String((err as { stdout: Buffer }).stdout)
  }
}

const gateSpecs = (files: string[]): string[] =>
  JSON.parse(execFileSync('node', ['--disable-warning=ExperimentalWarning', 'scripts/e2e-gate.mjs'], { cwd: root, input: JSON.stringify({ files: files.map(path => ({ path })), body: '', baseRefName: 'main', headRefOid: '' }) }).toString()).specs as string[]

describe('wf_e2e_selection_check (#699)', () => {
  const files = ['components/task/TaskMorphShell.vue', 'utils/sheetPlacement.ts']

  it('names the specs the line misses', () => {
    const out = check(files, 'E2E-specs: smoke\n')
    expect(out).toContain('misses spec(s)')
    expect(out).toContain('scrollbar-shift')
  })

  it('passes when the line names every selected spec (space or comma separated)', () => {
    const specs = gateSpecs(files)
    expect(check(files, `E2E-specs: ${specs.join(' ')}\n`)).toBeNull()
    expect(check(files, `E2E-specs: ${specs.join(', ')}\n`)).toBeNull()
  })

  it('passes a docs-only diff, which selects nothing', () => {
    expect(check(['docs/a.md'], 'E2E-specs: smoke\n')).toBeNull()
  })
})
