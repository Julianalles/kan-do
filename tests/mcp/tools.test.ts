// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { connect, makeApp, rpc } from './helpers'

describe('mcp endpoint', () => {
  it('answers 401 with the resource metadata pointer without a token', async () => {
    const { call } = makeApp()
    const res = await call('/mcp', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource')
  })

  it('lists the tools', async () => {
    const { call } = makeApp()
    const { tokens } = await connect(call)
    const { body } = await rpc(call, tokens.access_token, 'tools/list')
    expect(body.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(['add_task', 'get_board', 'log_time', 'set_status', 'set_timebox', 'start_work'])
  })

  it('queues a start_work command and reports it in get_board', async () => {
    const { call, store } = makeApp()
    const { tokens } = await connect(call)
    const started = await rpc(call, tokens.access_token, 'tools/call', { name: 'start_work', arguments: { title: 'Angebot Müller – Größe ÄÖ' } })
    expect(started.body.result.content[0].text).toContain('Queued')
    expect(await store.pending(10)).toMatchObject([{ id: 'cmd-1', type: 'start_work', payload: { title: 'Angebot Müller – Größe ÄÖ' } }])
    const board = await rpc(call, tokens.access_token, 'tools/call', { name: 'get_board', arguments: {} })
    expect(board.body.result.content[0].text).toContain('Queued, not applied yet')
  })

  it('validates tool input', async () => {
    const { call, store } = makeApp()
    const { tokens } = await connect(call)
    for (const args of [{ title: '', minutes: 5 }, { title: 'x', minutes: 0 }, { title: 'x', minutes: 5, day: 'gestern' }]) {
      const { body } = await rpc(call, tokens.access_token, 'tools/call', { name: 'log_time', arguments: args })
      expect(body.result?.isError ?? true).toBe(true)
    }
    expect(await store.pending(10)).toEqual([])
  })

  it('shows the uploaded board and finished commands', async () => {
    const { call, store } = makeApp()
    const { tokens } = await connect(call)
    await call('/sync/snapshot', {
      method: 'PUT',
      headers: { authorization: 'Bearer sync-secret' },
      body: JSON.stringify({ day: '2026-11-26', tasks: [
        { id: 'a', title: 'Schnitt', status: 'progress', timeBoxMinutes: 60, timeSpentMinutes: 12, topic: null, source: 'local' },
        { id: 'b', title: 'Rechnung', status: 'open', timeBoxMinutes: null, timeSpentMinutes: 0, topic: 'Büro', source: 'local' },
      ] }),
    })
    await store.enqueue({ id: 'x1', type: 'log_time', payload: {}, createdAt: 1 })
    await store.settle('x1', { ok: true, message: 'added 45 min to Schnitt' }, 2)
    const text = (await rpc(call, tokens.access_token, 'tools/call', { name: 'get_board', arguments: {} })).body.result.content[0].text as string
    expect(text).toContain('Jetzt (1)')
    expect(text).toContain('- Schnitt (box 60 min, spent 12 min)')
    expect(text).toContain('- Rechnung (Büro)')
    expect(text).toContain('log_time: ok added 45 min to Schnitt')
  })
})
