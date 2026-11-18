---
paths:
  - ".github/workflows/**"
  - "scripts/ci-e2e-plan.mjs"
  - ".githooks/**"
  - "worker/**"
  - "wrangler.jsonc"
---
# CI: the GitHub workflow

The short form (what a PR runs, the local gate) is in root `CLAUDE.md` "CI".

`.github/workflows/ci.yml`: a PR runs `quality` only (lint, typecheck, Vitest); a push to `main` and a manual run (`gh workflow run ci.yml`) also run every E2E spec over 8 shards in Playwright's image (`plan` + `e2e`; owner decision 2026-11-12 for the alpha phase: no E2E on PRs, and no merge waits for remote CI; to turn PR E2E back on, drop the `if` on the `plan` job, `scripts/ci-e2e-plan.mjs` still selects the gate's specs for a PR). Docs-only changes skip; read-only, no secrets; actions pinned by SHA; kd#187. A red `main` run is the signal that a merge broke something: fix forward. The local gate stays: `npm run verify` before opening a PR, `npm run build` when the PR touches `nuxt.config.ts`, `package.json`, `app.config.ts`, `server/` or `vercel.json`, the relevant E2E specs (`E2E-specs: a b c` in the PR body), and the pre-merge hook's tiered E2E run on `gh pr merge` (`scripts/e2e-gate.mjs`, `.claude/rules/e2e-gate.md`). Vercel deploys only `main`, `proto/*` and `dev`; `dev` is the dev instance (a Preview with `/ui` and the copy editor, `isDevInstance` in `lib/devPages.ts`, #246), updated with `npm run deploy:dev`. `git config core.hooksPath .githooks` (set in the maintainer's checkout) checks every push at the testing mode (`.githooks/pre-push`). `visual-regression.spec.ts` self-skips when `CI` is set (macOS baselines).

## Cloudflare (the public instance, #279, ADR 021)

Worker `kando` (`wrangler.jsonc`, `worker/`): `npm run deploy` = `build:cloudflare` + `wrangler deploy`. A push to `main` deploys it through Workers Builds (a dashboard connection of the Worker to this repository, the homepage's setup; no GitHub Action and no Cloudflare token in the repository's secrets). Vercel keeps `main`, `proto/*` and `dev`. The Worker's gate secret `GATE_SECRET` is set in Cloudflare only; an agent never writes it into an issue, PR, commit, log or ledger. The gate must be what is deployed: `nuxt.config.ts` keeps `cloudflare.deployConfig: false` (under `WORKERS_CI=1` Nitro would redirect wrangler to its own gate-less config) and `build:cloudflare` fails when `wrangler deploy --dry-run` would upload a bundle without the gate (`scripts/check-cloudflare-bundle.mjs`, `tests/config/cloudflare-deploy.test.ts`); reproduce the CI path with `WORKERS_CI=1 npm run build:cloudflare`. `vars.GATE` is `"on"` in `wrangler.jsonc` and nowhere else; the public launch flips that line in a PR. Pitfalls: the build image's npm must match the lockfile's npm (`packageManager` in `package.json`), non-`main` branches get no Workers Builds build, and `compatibility_date` must not be newer than the workerd of the pinned `wrangler`. `npm run typecheck` includes `tsc -p worker`; the gate logic is covered by `worker/gate.test.ts`, the Notion proxy's origin check and rate limit (`NOTION_LIMITER` in `wrangler.jsonc`; `wrangler dev` runs it locally, so a burst of 130 curls shows the 429) by `worker/guards.test.ts` and the order gate → origin → limit → app by `worker/pipeline.test.ts`.
