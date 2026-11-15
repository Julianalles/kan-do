// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Runner } from '~/server/copy-editor/exec'
import { buildRepairPrompt, outsideTests, parseRepairReply, repairArgs, runRepair } from '~/server/copy-editor/repair'

const changes = [{ key: 'welcome.intro', lang: 'de' as const, before: 'Standardmäßig liegen sie lokal', after: 'Alles bleibt lokal' }]
const failures = [{ stage: 'specs' as const, name: 'tests/e2e/welcome-setup.spec.ts:12 shows the intro', detail: 'expect(locator).toContainText(/Standardmäßig liegen sie lokal/)' }]
const reply = (stdout: string, code = 0): Runner => async () => ({ code, stdout, stderr: '', timedOut: false })

describe('copy publish: repair agent', () => {
  it('prompts with the changed copy and the failures, and tells the agent to stay in tests/ and ask the owner on a changed meaning', () => {
    const prompt = buildRepairPrompt(changes, failures)
    expect(prompt).toContain('Standardmäßig liegen sie lokal')
    expect(prompt).toContain('Alles bleibt lokal')
    expect(prompt).toContain('welcome-setup.spec.ts:12')
    expect(prompt).toContain('needs-owner')
    expect(prompt).toContain('below `tests/` only')
  })

  it('runs with file tools only: no Bash, no project settings, no MCP', () => {
    const args = repairArgs()
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Edit,Grep,Glob')
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('user')
    expect(args).toContain('--strict-mcp-config')
    expect(args.join(' ')).not.toMatch(/Bash/)
  })

  it('parses the envelope, a fenced answer and refuses anything else', () => {
    expect(parseRepairReply(JSON.stringify({ result: '{"status":"fixed","notes":"updated regex"}' }))).toEqual({ status: 'fixed', notes: 'updated regex' })
    expect(parseRepairReply('```json\n{"status":"needs-owner","notes":"asserts no Todoist"}\n```')).toEqual({ status: 'needs-owner', notes: 'asserts no Todoist' })
    expect(parseRepairReply('{"status":"done"}')).toBeNull()
    expect(parseRepairReply(JSON.stringify({ is_error: true, result: 'x' }))).toBeNull()
    expect(parseRepairReply('not json')).toBeNull()
  })

  it('finds changes outside tests/', () => {
    expect(outsideTests(['tests/e2e/a.spec.ts', 'components/A.vue', 'i18n/locales/de.json', 'tests/../x.ts'])).toEqual(['components/A.vue', 'i18n/locales/de.json', 'tests/../x.ts'])
    expect(outsideTests(['tests/e2e/a.spec.ts'])).toEqual([])
  })

  it('maps the agent outcomes: fixed, needs-owner, failed exit, unexpected format, timeout', async () => {
    const run = (stdout: string, code = 0) => runRepair({ run: reply(stdout, code), agentCmd: 'claude', worktree: '/tmp/x', changes, failures })
    expect(await run('{"status":"fixed","notes":"ok"}')).toEqual({ ok: true, status: 'fixed', notes: 'ok' })
    expect(await run('{"status":"needs-owner","notes":"conflict"}')).toEqual({ ok: false, status: 'needs-owner', notes: 'conflict' })
    expect(await run('boom', 1)).toMatchObject({ ok: false, status: 'failed' })
    expect(await run('???')).toMatchObject({ ok: false, status: 'failed', notes: expect.stringContaining('unexpected format') })
    const timedOut: Runner = async () => ({ code: null, stdout: '', stderr: '', timedOut: true })
    expect(await runRepair({ run: timedOut, agentCmd: 'claude', worktree: '/tmp/x', changes, failures })).toMatchObject({ ok: false, status: 'failed' })
  })
})
