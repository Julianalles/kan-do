#!/usr/bin/env node
/**
 * Build-time check of the Cloudflare Worker (#502, ADR 021): the bundle `wrangler deploy` would upload must contain the
 * secret-launch gate. Last step of `npm run build:cloudflare`, so a build that would ship Nitro's bare handler (every
 * route public) fails before any deploy. It also checks the CSP script hashes (#504) are in the bundle.
 *
 * It runs `wrangler deploy --dry-run` the way the Workers Builds dashboard does (`npx wrangler deploy`, no `-c`), at the
 * repository root: a `.wrangler/deploy/config.json` redirect to Nitro's own config (Nitro writes it under
 * `WORKERS_CI=1` unless `nitro.cloudflare.deployConfig` is off, nuxt.config.ts) is what this catches.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The gate cookie's name (`COOKIE_NAME` in worker/gate.ts): present in a bundle only when the gate is. */
export const GATE_MARKER = '__Host-kd_gate'

/** Does any .js/.mjs file below `dir` contain `marker`? A missing directory counts as no. */
export function bundleIncludes(dir, marker) {
  if (!existsSync(dir)) return false
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (bundleIncludes(path, marker)) return true
    } else if (/\.m?js$/.test(entry.name) && readFileSync(path, 'utf8').includes(marker)) {
      return true
    }
  }
  return false
}

/** Does the bundle contain the gate? */
export const bundleHasGate = dir => bundleIncludes(dir, GATE_MARKER)

function main() {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
  const fail = (message) => {
    console.error(`check-cloudflare-bundle: ${message}`)
    process.exit(1)
  }

  if (existsSync(join(root, '.wrangler/deploy/config.json'))) {
    fail('.wrangler/deploy/config.json redirects wrangler away from wrangler.jsonc, so the gate would not be deployed (nitro.cloudflare.deployConfig must stay false).')
  }

  const outdir = mkdtempSync(join(tmpdir(), 'kd-cf-bundle-'))
  try {
    const output = execFileSync(join(root, 'node_modules/.bin/wrangler'), ['deploy', '--dry-run', '--outdir', outdir], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (/redirected/i.test(output)) fail(`wrangler used a redirected configuration:\n${output}`)
    if (!bundleHasGate(outdir)) fail(`the bundle wrangler would deploy lacks the gate (no "${GATE_MARKER}"); expected worker/index.ts as main.`)
    // The CSP (#504): the bundle must carry the script hashes of this build's shell, or the app would not start under it.
    const hashesFile = join(root, 'worker/csp-hashes.generated.json')
    const hashes = existsSync(hashesFile) ? JSON.parse(readFileSync(hashesFile, 'utf8')).scriptHashes : []
    if (!Array.isArray(hashes) || !hashes.length) fail('worker/csp-hashes.generated.json has no script hashes (scripts/csp-hashes.mjs runs before this check in build:cloudflare).')
    const missing = hashes.filter(hash => !bundleIncludes(outdir, hash))
    if (missing.length) fail(`the bundle wrangler would deploy lacks the CSP script hash(es) ${missing.join(', ')}.`)
  } catch (error) {
    if (error.status === undefined) throw error
    fail(`wrangler deploy --dry-run failed:\n${error.stdout ?? ''}${error.stderr ?? ''}`)
  } finally {
    rmSync(outdir, { recursive: true, force: true })
  }
  console.log('check-cloudflare-bundle: the deployable bundle contains the gate and the CSP script hashes.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
