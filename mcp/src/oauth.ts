/**
 * Single-user OAuth 2.1 authorization server for the Claude custom connector (ADR 023): dynamic client registration,
 * authorization code with PKCE (S256 only), refresh tokens that rotate. "Login" is the owner's password (`OWNER_PASSWORD`),
 * entered once on the consent page when the connector is added. Tokens are opaque, stored only as SHA-256 hashes.
 */
import { pkceMatches, randomToken, safeEqual, sha256Hex } from './crypto'
import type { Store } from './store'

export const ACCESS_TTL = 60 * 60
export const REFRESH_TTL = 60 * 60 * 24 * 90
const CODE_TTL = 300
const CLIENT_TTL = 60 * 60 * 24 * 365
const FAIL_LIMIT = 5
const FAIL_WINDOW = 15 * 60

export interface OAuthEnv {
  OWNER_PASSWORD?: string
}

interface Client {
  redirectUris: string[]
  name: string
}

interface CodeRecord {
  clientId: string
  redirectUri: string
  challenge: string
}

interface TokenRecord {
  kind: 'access' | 'refresh'
  clientId: string
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })

const oauthError = (error: string, description: string, status = 400): Response => json({ error, error_description: description }, status)

const html = (body: string, status = 200): Response =>
  new Response(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>kan-do</title>
<style>body{font:16px system-ui;max-width:26rem;margin:15vh auto;padding:0 1rem}input,button{font:inherit;padding:.6rem;width:100%;box-sizing:border-box;margin-top:.6rem}</style>${body}</html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; frame-ancestors 'none'" },
  })

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

export const originOf = (request: Request): string => new URL(request.url).origin

export function protectedResourceMetadata(request: Request): Response {
  const origin = originOf(request)
  return json({ resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ['header'] })
}

export function authorizationServerMetadata(request: Request): Response {
  const origin = originOf(request)
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  })
}

const isAllowedRedirect = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
  } catch {
    return false
  }
}

export async function register(request: Request, store: Store): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null
  const uris = body?.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every(isAllowedRedirect)) {
    return oauthError('invalid_redirect_uri', 'redirect_uris must be 1 to 10 https URLs')
  }
  const clientId = randomToken(16)
  const name = typeof body?.client_name === 'string' ? body.client_name.slice(0, 80) : 'Claude'
  const client: Client = { redirectUris: uris, name }
  await store.kvPut(`client:${clientId}`, JSON.stringify(client), CLIENT_TTL)
  return json({
    client_id: clientId,
    client_name: name,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, 201)
}

async function loadClient(store: Store, clientId: string | null): Promise<Client | null> {
  if (!clientId) return null
  const raw = await store.kvGet(`client:${clientId}`)
  return raw ? (JSON.parse(raw) as Client) : null
}

interface AuthorizeParams {
  clientId: string
  redirectUri: string
  state: string | null
  challenge: string
}

/** Validates the authorization request; an invalid client or redirect never redirects (it would be an open redirect). */
async function readAuthorizeParams(params: URLSearchParams, store: Store): Promise<AuthorizeParams | Response> {
  const client = await loadClient(store, params.get('client_id'))
  const redirectUri = params.get('redirect_uri')
  if (!client || !redirectUri || !client.redirectUris.includes(redirectUri)) return html('<p>Unbekannter Client oder ungültige Rücksprung-Adresse.</p>', 400)
  if (params.get('response_type') !== 'code') return html('<p>response_type muss code sein.</p>', 400)
  const challenge = params.get('code_challenge')
  if (!challenge || params.get('code_challenge_method') !== 'S256') return html('<p>PKCE (S256) ist Pflicht.</p>', 400)
  return { clientId: params.get('client_id')!, redirectUri, state: params.get('state'), challenge }
}

const consentPage = (params: URLSearchParams, name: string, error = ''): Response => {
  const hidden = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state']
    .map(key => `<input type="hidden" name="${key}" value="${escapeHtml(params.get(key) ?? '')}">`).join('')
  return html(`<h1>kan-do verbinden</h1><p>${escapeHtml(name)} möchte auf dein Board zugreifen.</p>${error}
<form method="post">${hidden}<label>Passwort<input type="password" name="password" autocomplete="current-password" autofocus required></label><button>Freigeben</button></form>`, error ? 401 : 200)
}

export async function authorize(request: Request, store: Store, env: OAuthEnv): Promise<Response> {
  if (!env.OWNER_PASSWORD) return html('<p>OWNER_PASSWORD ist nicht gesetzt.</p>', 503)
  const url = new URL(request.url)
  const form = request.method === 'POST' ? await request.formData().catch(() => null) : null
  const params = form ? new URLSearchParams([...form.entries()].filter(([, v]) => typeof v === 'string') as [string, string][]) : url.searchParams
  const parsed = await readAuthorizeParams(params, store)
  if (parsed instanceof Response) return parsed
  const client = (await loadClient(store, parsed.clientId))!
  if (request.method !== 'POST') return consentPage(params, client.name)

  const failures = Number((await store.kvGet('authfail')) ?? '0')
  if (failures >= FAIL_LIMIT) return html('<p>Zu viele Fehlversuche. Bitte später erneut versuchen.</p>', 429)
  if (!(await safeEqual(params.get('password') ?? '', env.OWNER_PASSWORD))) {
    await store.kvPut('authfail', String(failures + 1), FAIL_WINDOW)
    return consentPage(params, client.name, '<p role="alert">Falsches Passwort.</p>')
  }
  await store.kvDelete('authfail')

  const code = randomToken()
  const record: CodeRecord = { clientId: parsed.clientId, redirectUri: parsed.redirectUri, challenge: parsed.challenge }
  await store.kvPut(`code:${await sha256Hex(code)}`, JSON.stringify(record), CODE_TTL)
  const target = new URL(parsed.redirectUri)
  target.searchParams.set('code', code)
  if (parsed.state) target.searchParams.set('state', parsed.state)
  return new Response(null, { status: 302, headers: { location: target.toString(), 'cache-control': 'no-store' } })
}

async function issueTokens(store: Store, clientId: string): Promise<Response> {
  const access = randomToken()
  const refresh = randomToken()
  await store.kvPut(`tok:${await sha256Hex(access)}`, JSON.stringify({ kind: 'access', clientId } satisfies TokenRecord), ACCESS_TTL)
  await store.kvPut(`tok:${await sha256Hex(refresh)}`, JSON.stringify({ kind: 'refresh', clientId } satisfies TokenRecord), REFRESH_TTL)
  return json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh })
}

export async function token(request: Request, store: Store): Promise<Response> {
  const form = await request.formData().catch(() => null)
  const get = (key: string): string | null => {
    const value = form?.get(key)
    return typeof value === 'string' ? value : null
  }
  const grant = get('grant_type')
  const clientId = get('client_id')

  if (grant === 'authorization_code') {
    const code = get('code')
    const verifier = get('code_verifier')
    if (!code || !verifier || !clientId) return oauthError('invalid_request', 'code, code_verifier and client_id are required')
    const key = `code:${await sha256Hex(code)}`
    const raw = await store.kvGet(key)
    // One use only, whatever happens next.
    await store.kvDelete(key)
    if (!raw) return oauthError('invalid_grant', 'unknown or expired code')
    const record = JSON.parse(raw) as CodeRecord
    if (record.clientId !== clientId || record.redirectUri !== get('redirect_uri')) return oauthError('invalid_grant', 'client or redirect_uri mismatch')
    if (!(await pkceMatches(verifier, record.challenge))) return oauthError('invalid_grant', 'PKCE verification failed')
    return issueTokens(store, clientId)
  }

  if (grant === 'refresh_token') {
    const refresh = get('refresh_token')
    if (!refresh) return oauthError('invalid_request', 'refresh_token is required')
    const key = `tok:${await sha256Hex(refresh)}`
    const raw = await store.kvGet(key)
    if (!raw) return oauthError('invalid_grant', 'unknown or expired refresh token')
    const record = JSON.parse(raw) as TokenRecord
    if (record.kind !== 'refresh' || (clientId && record.clientId !== clientId)) return oauthError('invalid_grant', 'refresh token mismatch')
    await store.kvDelete(key)
    return issueTokens(store, record.clientId)
  }

  return oauthError('unsupported_grant_type', 'authorization_code and refresh_token are supported')
}

/** True when the request carries a valid access token. */
export async function hasValidAccessToken(request: Request, store: Store): Promise<boolean> {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (!match) return false
  const raw = await store.kvGet(`tok:${await sha256Hex(match[1]!)}`)
  return raw !== null && (JSON.parse(raw) as TokenRecord).kind === 'access'
}
