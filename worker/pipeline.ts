/**
 * The Worker's request path (#502, #504, #742): gate, then the root files of the public launch (#738: robots.txt, sitemap,
 * security.txt), then the Notion 404 (the instance is local-only), then the app, whose HTML responses get the Content
 * Security Policy and whose brand assets get their explicit content type and cache lifetime (#738). The entry (`index.ts`) only supplies Nitro's handler and the
 * build's script hashes, so the order is unit-testable without the built bundle. The gate's own answers (401 page,
 * redirects), the Notion 404 and robots.txt never pass the app, so they carry no CSP.
 */
import { buildCsp, withSecurityHeaders } from './csp'
import { handle, type AppHandler, type GateEnv } from './gate'
import { guard } from './guards'
import { withAssetHeaders } from './public-assets'
import { publicFile } from './public-files'

export type WorkerEnv = GateEnv

export async function handleRequest(request: Request, env: WorkerEnv, app: AppHandler, scriptHashes: readonly string[]): Promise<Response> {
  const csp = buildCsp(scriptHashes) // throws on a malformed hash: a broken build fails every request loudly, never open
  const secured: AppHandler = async req => withSecurityHeaders(await app(req), csp)
  const routed: AppHandler = async req => publicFile(req, new Date()) ?? withAssetHeaders(req, await guard(req, secured))
  return handle(request, env, routed)
}
