/**
 * Worker `kando` (#502): Nitro's Cloudflare build (the SPA's static files and the `/api/*` routes) behind the
 * secret-launch gate. The gate runs first for every request (`assets.run_worker_first`); logic lives in `gate.ts`. Behind it
 * the Notion proxy's origin check and rate limit run (#503, `guards.ts`), wired in `pipeline.ts`.
 * `#nitro-server` is the built Nitro handler, mapped by `alias` in `wrangler.jsonc` (run `npm run build:cloudflare` first).
 */
import nitro from '#nitro-server'
import { handleRequest, type WorkerEnv } from './pipeline'

interface Env extends WorkerEnv {
  ASSETS: Fetcher
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, req => nitro.fetch(req, env, ctx))
  },
} satisfies ExportedHandler<Env>
