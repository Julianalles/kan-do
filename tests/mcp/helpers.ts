import { handle } from '~/mcp/src/app'
import { MemoryStore } from '~/mcp/src/store'

export const BASE = 'https://kando-mcp.example'
export const ENV = { OWNER_PASSWORD: 'correct horse', SYNC_TOKEN: 'sync-secret' }

export function makeApp() {
  const store = new MemoryStore()
  let n = 0
  const call = (path: string, init?: RequestInit) =>
    handle(new Request(`${BASE}${path}`, init), { store, env: ENV, now: () => store.now(), newId: () => `cmd-${++n}` })
  return { store, call }
}

const b64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function pkcePair() {
  const verifier = 'v'.repeat(50)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: b64url(digest) }
}

/** Runs registration, consent and token exchange; returns the tokens. */
export async function connect(call: ReturnType<typeof makeApp>['call']) {
  const redirect = 'https://claude.ai/api/mcp/auth_callback'
  const reg = await (await call('/register', { method: 'POST', body: JSON.stringify({ redirect_uris: [redirect], client_name: 'Claude' }) })).json() as { client_id: string }
  const { verifier, challenge } = await pkcePair()
  const form = new URLSearchParams({
    client_id: reg.client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's1', password: ENV.OWNER_PASSWORD,
  })
  const consent = await call('/authorize', { method: 'POST', body: form })
  const code = new URL(consent.headers.get('location')!).searchParams.get('code')!
  const tokenRes = await call('/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: redirect }),
  })
  return { clientId: reg.client_id, redirect, challenge, verifier, tokens: await tokenRes.json() as { access_token: string; refresh_token: string }, tokenRes }
}

export async function rpc(call: ReturnType<typeof makeApp>['call'], accessToken: string, method: string, params: unknown = {}) {
  const res = await call('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return { res, body: await res.json() as any }
}
