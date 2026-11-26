// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { makeApp } from './helpers'

const auth = { authorization: 'Bearer sync-secret' }

describe('sync endpoints', () => {
  it('require the sync token', async () => {
    const { call } = makeApp()
    expect((await call('/sync/commands')).status).toBe(401)
    expect((await call('/sync/commands', { headers: { authorization: 'Bearer nope' } })).status).toBe(401)
  })

  it('hands out pending commands oldest first and settles them once', async () => {
    const { call, store } = makeApp()
    await store.enqueue({ id: 'c1', type: 'add_task', payload: { title: 'A' }, createdAt: 1 })
    await store.enqueue({ id: 'c2', type: 'set_status', payload: { title: 'A', status: 'done' }, createdAt: 2 })
    const list = await (await call('/sync/commands', { headers: auth })).json() as { commands: { id: string }[] }
    expect(list.commands.map(c => c.id)).toEqual(['c1', 'c2'])
    const done = () => call('/sync/commands/c1/result', { method: 'POST', headers: auth, body: JSON.stringify({ ok: true, message: 'created' }) })
    expect((await done()).status).toBe(200)
    expect((await done()).status).toBe(404)
    const after = await (await call('/sync/commands', { headers: auth })).json() as { commands: { id: string }[] }
    expect(after.commands.map(c => c.id)).toEqual(['c2'])
  })

  it('rejects a malformed snapshot and an oversized one', async () => {
    const { call } = makeApp()
    const put = (body: string) => call('/sync/snapshot', { method: 'PUT', headers: auth, body })
    expect((await put('{"day":"heute","tasks":[]}')).status).toBe(400)
    expect((await put('not json')).status).toBe(400)
    expect((await put('x'.repeat(300 * 1024))).status).toBe(413)
    expect((await put('{"day":"2026-11-26","tasks":[]}')).status).toBe(200)
  })
})
