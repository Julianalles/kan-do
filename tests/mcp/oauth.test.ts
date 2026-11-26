// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BASE, connect, makeApp, pkcePair } from './helpers'

describe('oauth', () => {
  it('serves discovery metadata for the connector', async () => {
    const { call } = makeApp()
    const meta = await (await call('/.well-known/oauth-authorization-server')).json() as Record<string, unknown>
    expect(meta.code_challenge_methods_supported).toEqual(['S256'])
    expect(meta.token_endpoint).toBe(`${BASE}/token`)
    const resource = await (await call('/.well-known/oauth-protected-resource')).json() as Record<string, unknown>
    expect(resource.resource).toBe(`${BASE}/mcp`)
  })

  it('completes registration, consent with PKCE and the code exchange', async () => {
    const { call } = makeApp()
    const { tokens, tokenRes } = await connect(call)
    expect(tokenRes.status).toBe(200)
    expect(tokens.access_token).toBeTruthy()
    expect(tokens.refresh_token).toBeTruthy()
  })

  it('rejects a code exchange with the wrong verifier and burns the code', async () => {
    const { call } = makeApp()
    const redirect = 'https://claude.ai/cb'
    const reg = await (await call('/register', { method: 'POST', body: JSON.stringify({ redirect_uris: [redirect] }) })).json() as { client_id: string }
    const { challenge } = await pkcePair()
    const consent = await call('/authorize', { method: 'POST', body: new URLSearchParams({ client_id: reg.client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', password: 'correct horse' }) })
    const code = new URL(consent.headers.get('location')!).searchParams.get('code')!
    const body = (verifier: string) => new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: redirect })
    expect((await call('/token', { method: 'POST', body: body('x'.repeat(50)) })).status).toBe(400)
    expect((await call('/token', { method: 'POST', body: body('v'.repeat(50)) })).status).toBe(400)
  })

  it('shows the consent page without redirecting for an unregistered redirect uri', async () => {
    const { call } = makeApp()
    const reg = await (await call('/register', { method: 'POST', body: JSON.stringify({ redirect_uris: ['https://claude.ai/cb'] }) })).json() as { client_id: string }
    const res = await call(`/authorize?client_id=${reg.client_id}&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&response_type=code&code_challenge=x&code_challenge_method=S256`)
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
  })

  it('refuses plain PKCE and a wrong password, and locks after repeated failures', async () => {
    const { call } = makeApp()
    const redirect = 'https://claude.ai/cb'
    const reg = await (await call('/register', { method: 'POST', body: JSON.stringify({ redirect_uris: [redirect] }) })).json() as { client_id: string }
    const base = { client_id: reg.client_id, redirect_uri: redirect, response_type: 'code', code_challenge: 'abc' }
    expect((await call('/authorize', { method: 'POST', body: new URLSearchParams({ ...base, code_challenge_method: 'plain', password: 'correct horse' }) })).status).toBe(400)
    const attempt = () => call('/authorize', { method: 'POST', body: new URLSearchParams({ ...base, code_challenge_method: 'S256', password: 'nope' }) })
    for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(401)
    expect((await attempt()).status).toBe(429)
  })

  it('rotates the refresh token and rejects the old one', async () => {
    const { call } = makeApp()
    const { clientId, tokens } = await connect(call)
    const refresh = (token: string) => call('/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token, client_id: clientId }) })
    const next = await refresh(tokens.refresh_token)
    expect(next.status).toBe(200)
    expect((await refresh(tokens.refresh_token)).status).toBe(400)
  })

  it('does not accept a refresh token as an access token', async () => {
    const { call } = makeApp()
    const { tokens } = await connect(call)
    const res = await call('/mcp', { method: 'POST', headers: { authorization: `Bearer ${tokens.refresh_token}` }, body: '{}' })
    expect(res.status).toBe(401)
  })
})
