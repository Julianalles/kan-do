// @vitest-environment node
/**
 * `.claude/hooks/edit-root.sh`: two PostToolUse hooks record the edited checkout on the same edit, and
 * check-then-append is not atomic. A duplicate must not make the Stop hook verify one checkout twice.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../../.claude/hooks/edit-root.sh')
const dirs: string[] = []

function bash(tmp: string, body: string): string {
  return execFileSync('bash', ['-c', `. "${SCRIPT}"; ${body}`], { env: { ...process.env, TMPDIR: tmp }, encoding: 'utf8' })
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('kando_recorded_roots', () => {
  it('lists a root once even when it was recorded twice (racing hooks)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'edit-root-'))
    dirs.push(tmp)
    // The racing case: both hooks passed the "already recorded?" check, then both appended.
    bash(tmp, 'f=$(kando_roots_file s1); printf "/a\\n/b\\n/a\\n" >"$f"')
    expect(bash(tmp, 'kando_recorded_roots s1').trim().split('\n')).toEqual(['/a', '/b'])
  })

  it('records sequentially without duplicates and lists nothing for an unknown session', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'edit-root-'))
    dirs.push(tmp)
    bash(tmp, 'kando_record_root s2 /a; kando_record_root s2 /a')
    expect(bash(tmp, 'kando_recorded_roots s2')).toBe('/a\n')
    expect(bash(tmp, 'kando_recorded_roots nobody')).toBe('')
  })
})

describe('turn snapshot (turn-start.sh, kando_turn_unchanged)', () => {
  const TURN_START = resolve(__dirname, '../../.claude/hooks/turn-start.sh')

  function repo(): { tmp: string, repo: string } {
    const tmp = mkdtempSync(join(tmpdir(), 'edit-root-'))
    dirs.push(tmp)
    const dir = join(tmp, 'repo')
    mkdirSync(dir)
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
    git('init', '-q')
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    // Resolve /var -> /private/var on macOS so the root matches `git rev-parse --show-toplevel`.
    return { tmp, repo: realpathSync(dir) }
  }

  function startTurn(tmp: string, dir: string, session: string): string {
    return execFileSync('bash', [TURN_START], {
      env: { ...process.env, TMPDIR: tmp, CLAUDE_PROJECT_DIR: dir },
      input: JSON.stringify({ session_id: session, hook_event_name: 'UserPromptSubmit' }),
      encoding: 'utf8',
    })
  }

  function unchanged(tmp: string, session: string, dir: string): boolean {
    try {
      bash(tmp, `kando_turn_unchanged ${session} "${dir}"`)
      return true
    }
    catch {
      return false
    }
  }

  it('prints nothing and finds a dirty checkout unchanged when the turn did not touch it', () => {
    const { tmp, repo: dir } = repo()
    writeFileSync(join(dir, 'a.txt'), 'dirty before the turn\n')
    expect(startTurn(tmp, dir, 's1')).toBe('')
    expect(unchanged(tmp, 's1', dir)).toBe(true)
  })

  it('sees an edit, a new untracked file and a commit made during the turn', () => {
    const { tmp, repo: dir } = repo()
    startTurn(tmp, dir, 's2')
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    expect(unchanged(tmp, 's2', dir)).toBe(false)

    startTurn(tmp, dir, 's2')
    writeFileSync(join(dir, 'new.json'), '{}\n')
    expect(unchanged(tmp, 's2', dir)).toBe(false)

    startTurn(tmp, dir, 's2')
    execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'x'])
    expect(unchanged(tmp, 's2', dir)).toBe(false)
  })

  it('treats a missing snapshot or an unknown checkout as changed', () => {
    const { tmp, repo: dir } = repo()
    expect(unchanged(tmp, 'nobody', dir)).toBe(false)
    startTurn(tmp, dir, 's3')
    expect(unchanged(tmp, 's3', join(tmp, 'elsewhere'))).toBe(false)
  })
})
