/**
 * Endpoints the desktop app calls (ADR 023): upload the board snapshot, fetch queued commands, report their results.
 * Authenticated by the bearer `SYNC_TOKEN`, a different secret from the OAuth tokens: the app never holds an OAuth grant,
 * Claude never holds the sync token.
 */
import { safeEqual } from './crypto'
import type { Store } from './store'
import { snapshotSchema } from './tools'

export interface SyncEnv {
  SYNC_TOKEN?: string
}

const MAX_SNAPSHOT_BYTES = 256 * 1024
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export async function handleSync(request: Request, store: Store, env: SyncEnv, now: number): Promise<Response> {
  if (!env.SYNC_TOKEN) return json({ error: 'sync_disabled' }, 503)
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!bearer || !(await safeEqual(bearer, env.SYNC_TOKEN))) return json({ error: 'unauthorized' }, 401)

  const path = new URL(request.url).pathname
  if (path === '/sync/snapshot' && request.method === 'PUT') {
    const raw = await request.text()
    if (raw.length > MAX_SNAPSHOT_BYTES) return json({ error: 'too_large' }, 413)
    const parsed = snapshotSchema.safeParse(safeJson(raw))
    if (!parsed.success) return json({ error: 'invalid_snapshot' }, 400)
    await store.putSnapshot(JSON.stringify(parsed.data), now)
    return json({ ok: true })
  }
  if (path === '/sync/commands' && request.method === 'GET') {
    const commands = await store.pending(50)
    return json({ commands: commands.map(({ id, type, payload, createdAt }) => ({ id, type, payload, createdAt })) })
  }
  const result = /^\/sync\/commands\/([\w-]{1,80})\/result$/.exec(path)
  if (result && request.method === 'POST') {
    const body = safeJson(await request.text()) as { ok?: unknown; message?: unknown } | null
    if (typeof body?.ok !== 'boolean') return json({ error: 'invalid_result' }, 400)
    const message = typeof body.message === 'string' ? body.message.slice(0, 300) : ''
    const settled = await store.settle(result[1]!, { ok: body.ok, message }, now)
    return json({ ok: settled }, settled ? 200 : 404)
  }
  return json({ error: 'not_found' }, 404)
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
