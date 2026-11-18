#!/usr/bin/env node
/**
 * Build step of the web CSP (#504, ADR 021, ADR 012 "Web build"): hash the inline scripts of the built SPA shell and write
 * them to `worker/csp-hashes.generated.json`, which the Worker bundles and puts into `script-src`.
 *
 * The shell has two executable inline scripts (the import map and the `window.__NUXT__` config) whose text changes with
 * every build (asset file names, build id), so no static header can name them. Nitro renders the shell at request time and
 * writes no HTML file for the Cloudflare preset; `nuxt.config.ts` therefore prerenders `/200.html` for it, the same
 * renderer and the same template. Data blocks (`type="application/json"`, Nuxt's `__NUXT_DATA__`) are never executed and
 * need no hash. A shell without an executable inline script, or an unreadable one, fails the build: the app would not start
 * under the policy, and an empty hash list must never ship silently.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

/** The built shells to hash (a union: each file that exists contributes its hashes). `200.html` is the SPA fallback shell. */
export const SHELL_FILES = ['.output/public/200.html', '.output/public/index.html']
export const HASHES_FILE = 'worker/csp-hashes.generated.json'

/** Inline `<script>` elements the browser would execute: no `src`, and not a JSON data block. Bodies are exact (hashed as is). */
export function executableInlineScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => !/\bsrc\s*=/i.test(attrs))
    .filter(([, attrs]) => !/\btype\s*=\s*["']?application\/(?:ld\+)?json["']?/i.test(attrs))
    .map(([, , body]) => body)
}

/** `sha256-<base64>` source expression of one script body, as CSP wants it. */
export function cspHash(body) {
  return `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`
}

export function scriptHashes(html) {
  return [...new Set(executableInlineScripts(html).map(cspHash))].sort()
}

function main() {
  const files = SHELL_FILES.filter(file => existsSync(resolve(root, file)))
  if (!files.length) {
    console.error(`csp-hashes: no built shell (${SHELL_FILES.join(', ')}); run the Cloudflare build first (nuxt.config.ts prerenders /200.html for it).`)
    process.exit(1)
  }
  const hashes = [...new Set(files.flatMap(file => scriptHashes(readFileSync(resolve(root, file), 'utf8'))))].sort()
  if (!hashes.length) {
    console.error(`csp-hashes: no executable inline script in ${files.join(', ')}; the shell is not what the policy expects.`)
    process.exit(1)
  }
  writeFileSync(resolve(root, HASHES_FILE), `${JSON.stringify({ scriptHashes: hashes }, null, 2)}\n`)
  console.log(`csp-hashes: ${hashes.length} inline script hash(es) from ${files.join(', ')} -> ${HASHES_FILE}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
