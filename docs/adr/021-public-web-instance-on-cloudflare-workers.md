# ADR 021: The public web instance runs on Cloudflare Workers, behind a token gate

## Status

Accepted (epic #279; this ADR comes with its first slice #502, the proxy guards #503 and the web CSP #504 extend it). The ADR number was taken as the next free one on `main` and may be renumbered at merge.

## Context

kan-do's web build ran on Vercel only. The homepage's secret launch (jaylouiz/jwue-homepage, milestone M2) needs the app reachable by invited people and by nobody else, on a free plan, next to the homepage's own Worker `www` on the same Cloudflare account. The app is a single-page app (`ssr: false`); only `/api/*` runs server code (the Notion proxy, the feedback relay, an unused Todoist token route). Nothing is stored server-side: user data lives in the browser's localStorage and in the user's own Notion or Todoist.

## Decision

- **Worker `kando` on `https://kando.julius-wuestefeld.workers.dev`** (Workers Free). The custom domain `kando.julius-wuestefeld.de` follows with the homepage's public launch (jwue-homepage M3) and is not part of this ADR. The gate cookie is `__Host-` bound, so the move needs no gate change.
- **Build: Nitro's `cloudflare_module` preset** (`npm run build:cloudflare`: `NITRO_PRESET=cloudflare_module`, and `NUXT_PUBLIC_FEEDBACK_RELAY_URL=/api/feedback` so the instance's feedback dialog posts to its own relay). `wrangler.jsonc` serves `.output/public` as Workers assets (static requests are free of charge) and runs the Nitro handler for `/api/*` and the SPA shell. `compatibility_flags: ["nodejs_compat"]` gives `Buffer` and `process.env` (vars and secrets). The desktop build (`npm run generate`, `src-tauri`) and the Vercel build are unchanged.
- **The gate is a Worker entry that wraps Nitro's built handler** (`worker/index.ts`, logic in `worker/gate.ts`, mirrors the homepage's gate), with `assets.run_worker_first: true` so static files pass it too. Rejected: a Nitro server middleware (Nitro's Cloudflare handler answers public asset URLs from the assets binding before any middleware, so `/_nuxt/*.js` would leak); Cloudflare Access (needs a zone and Zero Trust, and the user chose a shared token).
- **The token** is one shared secret, `GATE_SECRET` (the homepage's value, user decision 2026-11-18). A valid `?secret=` sets an HttpOnly, Secure, SameSite=Lax cookie `__Host-kd_gate` (the sha256 of the secret, 90 days) and redirects to the same URL without the parameter. Without it: 401 with a plain "Private preview" page (no app HTML, no script, no asset). `POST /api/feedback` and its `OPTIONS` preflight are exempt (desktop builds post without a cookie; the relay has its own hourly cap); `/api/notion/*` stays gated. While gated every response carries `X-Robots-Tag: noindex, nofollow` and `/robots.txt` disallows everything. `vars.GATE` is `"on"` in `wrangler.jsonc` (the single source: a fresh deploy is gated, and a dashboard toggle would be reset by the next deploy); `"off"` opens the app for the public launch (jwue-homepage #34), a deliberate change of that line through a PR; a missing `GATE_SECRET` with the gate on denies every request. A secret never appears in an issue, PR, commit or log.
- **No service worker.** The web build registers none, so a cached app shell cannot bypass the gate; a regression would show in `.output/public` (no `sw.js`) and in the code (`rg serviceWorker`).
- **No `NOTION_KEY`** on the instance, and the Notion stub stays off: `NODE_ENV` is inlined as production, `E2E_NOTION_STUB` and `NOTION_STUB_ENABLED` are never set as vars, `/api/dev/*` answers 404, `/api/notion/ping` is a 404 in production.
- **Pipeline: Workers Builds** (the homepage's setup): a push to `main` runs the build command `npm run build:cloudflare` and the deploy command `npx wrangler deploy` (`npm run deploy` is both in one for a manual deploy). The dashboard connection is a user step (Worker `kando` > Settings > Builds > Connect, a dashboard-created build token; the Worker, its secrets and the connection can equally be created through the Cloudflare API). Non-`main` branches get no Workers Builds build: `preview_urls` is off and a branch build would otherwise run the production deploy command. Vercel keeps `main`, `proto/*` and `dev` (previews, the dev instance), and its production deployment stays the feedback relay target of shipped desktop builds until #280 switches them.

- **The deployed Worker is `worker/index.ts`, never Nitro's own.** Under Workers Builds (`WORKERS_CI=1`) Nitro defaults `cloudflare.deployConfig` on, writes `.output/server/wrangler.json` and redirects `wrangler deploy` to it through `.wrangler/deploy/config.json`: the app and `/api/notion/*` would go live without the gate. `nuxt.config.ts` sets `cloudflare.deployConfig: false`, and `build:cloudflare` ends in `scripts/check-cloudflare-bundle.mjs` (a `wrangler deploy --dry-run` without `-c`, as the dashboard runs it; fails on a redirect or a bundle without the gate); `npm run deploy` also passes `-c wrangler.jsonc`. A local `wrangler dev` check misses this: `WORKERS_CI` is unset there (`WORKERS_CI=1 npm run build:cloudflare` reproduces the CI path).

## Limits checked (Workers Free)

Worker bundle 901 KiB, 210 KiB gzipped (limit 3 MB compressed); 217 static files (limit 20,000); static asset requests are not counted against the 100,000 requests per day; the routes mostly wait on Notion and GitHub (waiting is not CPU time, limit 10 ms). Over a limit requests fail; there is no overage bill.

## Consequences

- Two hosts serve the same app until #280: the desktop app still posts feedback to Vercel.
- Pitfalls of the build image: its npm must match the lockfile's npm (`packageManager` in `package.json` says `npm@11.19.0`, the version kan-do installs with), and `compatibility_date` must not be newer than the workerd of the pinned `wrangler` (`wrangler.jsonc` says which).
- Local checks: `.dev.vars` (git-ignored) holds a dummy `GATE_SECRET`, `npx wrangler dev --port <free port>` serves the built Worker.
