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
 *
 * A third source (#512): scripts the client injects at runtime through `useHead({ script: [{ innerHTML }] })`. The shell
 * cannot show them; the one that ships today is Nuxt's built-in 404 page ("Go back" wiring, a constant of the installed Nuxt
 * version). They are read from the built client chunks, so a Nuxt upgrade follows by itself. A literal with an interpolation
 * is no constant and fails the build, and so does a built-in 404 page chunk that yields no script (a changed chunk shape
 * would put the violation back unseen); with no built-in 404 page (an app-owned error page) none is expected.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

/** The built shells to hash (a union: each file that exists contributes its hashes). `200.html` is the SPA fallback shell. */
export const SHELL_FILES = ['.output/public/200.html', '.output/public/index.html']
export const CHUNK_DIR = '.output/public/_nuxt'
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

/**
 * Inline scripts a built client chunk hands to `useHead` as `script: [{ innerHTML: <literal> }]` (the bundler keeps the
 * literal's quote style: a template literal, `"` or `'`; `children` is the older spelling). Returns the evaluated text.
 */
export function runtimeInlineScripts(js) {
  const scripts = []
  for (const [, quote, body] of js.matchAll(/\bscript\s*:\s*\[\s*\{\s*(?:innerHTML|children)\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    if (quote === '`' && body.includes('${')) throw new Error(`a runtime inline script has an interpolation, so it has no constant hash: ${body.slice(0, 80)}`)
    scripts.push(evalLiteral(quote, body))
  }
  return scripts
}

/** The string a quoted JS literal stands for, read by the JS engine itself, so the hash is of what the browser will execute. */
function evalLiteral(quote, body) {
  try {
    return new Function(`return ${quote}${body}${quote}`)()
  }
  catch (error) {
    throw new Error(`a runtime inline script literal does not parse (${error.message}): ${body.slice(0, 80)}`, { cause: error })
  }
}

/** Chunk files of `dir` that hold Nuxt's built-in 404 page (its component chunk carries `__name:\`error-404\``). */
export function builtIn404Chunks(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.js') && /__name\s*:\s*["'`]error-404["'`]/.test(readFileSync(resolve(dir, name), 'utf8')))
}

export function scriptHashes(html) {
  return [...new Set(executableInlineScripts(html).map(cspHash))].sort()
}

/** `sha256-` sources of the runtime-injected inline scripts in the built client chunks. */
export function chunkScriptHashes(dir) {
  if (!existsSync(dir)) return []
  const chunks = readdirSync(dir).filter(name => name.endsWith('.js'))
  return [...new Set(chunks.flatMap(name => runtimeInlineScripts(readFileSync(resolve(dir, name), 'utf8')).map(cspHash)))].sort()
}

function main() {
  const files = SHELL_FILES.filter(file => existsSync(resolve(root, file)))
  if (!files.length) {
    console.error(`csp-hashes: no built shell (${SHELL_FILES.join(', ')}); run the Cloudflare build first (nuxt.config.ts prerenders /200.html for it).`)
    process.exit(1)
  }
  const shellHashes = [...new Set(files.flatMap(file => scriptHashes(readFileSync(resolve(root, file), 'utf8'))))].sort()
  if (!shellHashes.length) {
    console.error(`csp-hashes: no executable inline script in ${files.join(', ')}; the shell is not what the policy expects.`)
    process.exit(1)
  }
  let runtimeHashes
  try {
    runtimeHashes = chunkScriptHashes(resolve(root, CHUNK_DIR))
  }
  catch (error) {
    console.error(`csp-hashes: ${error.message}`)
    process.exit(1)
  }
  // The chunk of the built-in 404 page must itself yield a script: another chunk's match must not hide a miss.
  const missed = builtIn404Chunks(resolve(root, CHUNK_DIR)).filter(name => !runtimeInlineScripts(readFileSync(resolve(root, CHUNK_DIR, name), 'utf8')).length)
  if (missed.length) {
    console.error(`csp-hashes: ${missed.join(', ')} in ${CHUNK_DIR} ships Nuxt's built-in 404 page but no inline script of it was found; its "Go back" script would be blocked by the policy (#512). Update runtimeInlineScripts to the new chunk shape.`)
    process.exit(1)
  }
  const hashes = [...new Set([...shellHashes, ...runtimeHashes])].sort()
  writeFileSync(resolve(root, HASHES_FILE), `${JSON.stringify({ scriptHashes: hashes }, null, 2)}\n`)
  console.log(`csp-hashes: ${hashes.length} inline script hash(es) (${shellHashes.length} from ${files.join(', ')}, ${runtimeHashes.length} runtime-injected from ${CHUNK_DIR}) -> ${HASHES_FILE}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
