/**
 * The Worker's request path (#502, #503, #504): gate, then origin check, then rate limit, then the app, whose HTML
 * responses get the Content Security Policy. The entry (`index.ts`) only supplies Nitro's handler and the build's script
 * hashes, so the order is unit-testable without the built bundle. The gate's own answers (401 page, redirects), the
 * guards' 403 and 429 and robots.txt never pass the app, so they carry no CSP.
 */
import { buildCsp, withSecurityHeaders } from './csp'
import { handle, type AppHandler, type GateEnv } from './gate'
import { guard, type GuardEnv } from './guards'

export type WorkerEnv = GateEnv & GuardEnv

export async function handleRequest(request: Request, env: WorkerEnv, app: AppHandler, scriptHashes: readonly string[]): Promise<Response> {
  const csp = buildCsp(scriptHashes) // throws on a malformed hash: a broken build fails every request loudly, never open
  const secured: AppHandler = async req => withSecurityHeaders(await app(req), csp)
  return handle(request, env, req => guard(req, env, secured))
}
