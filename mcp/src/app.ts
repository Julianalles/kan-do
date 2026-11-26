/** Request routing of the kando-mcp Worker (ADR 023); `index.ts` only binds the environment. */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { authorize, authorizationServerMetadata, hasValidAccessToken, originOf, protectedResourceMetadata, register, token, type OAuthEnv } from './oauth'
import type { Store } from './store'
import { handleSync, type SyncEnv } from './sync'
import { createMcpServer } from './tools'

export type AppEnv = OAuthEnv & SyncEnv

export interface AppDeps {
  store: Store
  env: AppEnv
  now?: () => number
  newId?: () => string
}

const notFound = () => new Response('Not found', { status: 404 })

export async function handle(request: Request, deps: AppDeps): Promise<Response> {
  const { store, env } = deps
  const now = deps.now ?? (() => Date.now())
  const url = new URL(request.url)
  const path = url.pathname

  if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') return protectedResourceMetadata(request)
  if (path === '/.well-known/oauth-authorization-server') return authorizationServerMetadata(request)
  if (path === '/register' && request.method === 'POST') return register(request, store)
  if (path === '/authorize' && (request.method === 'GET' || request.method === 'POST')) return authorize(request, store, env)
  if (path === '/token' && request.method === 'POST') return token(request, store)
  if (path.startsWith('/sync/')) return handleSync(request, store, env, now())

  if (path === '/mcp') {
    if (!(await hasValidAccessToken(request, store))) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'www-authenticate': `Bearer resource_metadata="${originOf(request)}/.well-known/oauth-protected-resource"`,
        },
      })
    }
    // Stateless: one server and transport per request, no session to keep between Worker invocations.
    const server = createMcpServer({ store, now, newId: deps.newId ?? (() => crypto.randomUUID()) })
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    return transport.handleRequest(request)
  }

  if (path === '/' || path === '/healthz') return new Response('kando-mcp', { headers: { 'content-type': 'text/plain' } })
  return notFound()
}
