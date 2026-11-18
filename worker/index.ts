/**
 * Worker `kando` (#502): Nitro's Cloudflare build (the SPA's static files and the `/api/*` routes) behind the
 * secret-launch gate. The gate runs first for every request (`assets.run_worker_first`); logic lives in `gate.ts`. Behind it
 * the Notion proxy's origin check and rate limit run (#503, #508, `guards.ts`, `limiter.ts`), wired in `pipeline.ts`; the app's HTML answers carry the
 * Content Security Policy (#504, `csp.ts`) with the script hashes `npm run build:cloudflare` wrote to `csp-hashes.generated.json`.
 * `#nitro-server` is the built Nitro handler, mapped by `alias` in `wrangler.jsonc` (run `npm run build:cloudflare` first).
 */
import nitro from '#nitro-server'
import hashes from './csp-hashes.generated.json'
import { handleRequest, type WorkerEnv } from './pipeline'

// The Durable Object class behind `NOTION_LIMITER` (#508): a Worker entry exports its classes.
export { NotionLimiter } from './limiter'

interface Env extends WorkerEnv {
  ASSETS: Fetcher
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, req => nitro.fetch(req, env, ctx), hashes.scriptHashes)
  },
} satisfies ExportedHandler<Env>
