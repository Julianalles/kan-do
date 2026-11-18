// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GATE_MARKER, bundleHasGate } from '../../scripts/check-cloudflare-bundle.mjs'

// #502, ADR 021: under Workers Builds (`WORKERS_CI=1`) Nitro redirects `wrangler deploy` to its own config and the Worker
// goes live without the gate. The deploy path is pinned here; `scripts/check-cloudflare-bundle.mjs` is the build-time check.

const root = resolve(__dirname, '../..')
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8')

describe('Cloudflare deploy path', () => {
  const dirs: string[] = []
  const tmp = () => { const dir = mkdtempSync(join(tmpdir(), 'kd-cf-')); dirs.push(dir); return dir }
  afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

  it('Nitro never writes its own wrangler config: deployConfig is off in the build config', () => {
    expect(read('nuxt.config.ts')).toMatch(/cloudflare:\s*\{\s*deployConfig:\s*false\s*\}/)
  })

  it('the build script clears a stale redirect, writes the CSP hashes and ends in the bundle check; deploy names the config', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>
    expect(scripts['build:cloudflare']).toMatch(/^rm -rf \.wrangler\/deploy && .*nuxt build && node scripts\/csp-hashes\.mjs && node scripts\/check-cloudflare-bundle\.mjs$/)
    expect(scripts.deploy).toBe('npm run build:cloudflare && wrangler deploy -c wrangler.jsonc')
  })

  it('the Notion limiter is a SQLite-backed Durable Object the entry exports, never the Workers Rate Limiting binding (#508)', () => {
    const config = read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, '')
    expect(config).toMatch(/"durable_objects":\s*\{\s*"bindings":\s*\[\s*\{\s*"name":\s*"NOTION_LIMITER",\s*"class_name":\s*"NotionLimiter"\s*\}\s*\]\s*\}/)
    expect(config).toMatch(/"migrations":\s*\[\s*\{\s*"tag":\s*"v1",\s*"new_sqlite_classes":\s*\["NotionLimiter"\]\s*\}\s*\]/)
    expect(config).not.toContain('"ratelimits"') // it answered success:true for 1200 requests on the live instance
    expect(read('worker/index.ts')).toMatch(/export \{ NotionLimiter \} from '\.\/limiter'/)
  })

  it('the marker is the gate cookie of worker/gate.ts', () => {
    expect(read('worker/gate.ts')).toContain(`COOKIE_NAME = '${GATE_MARKER}'`)
  })

  it('bundleHasGate finds the gate in a bundle and rejects one without it', () => {
    const withGate = tmp()
    mkdirSync(join(withGate, 'chunks'))
    writeFileSync(join(withGate, 'index.js'), 'export default {}')
    writeFileSync(join(withGate, 'chunks', 'gate.mjs'), `const c = "${GATE_MARKER}"`)
    expect(bundleHasGate(withGate)).toBe(true)

    const bare = tmp()
    writeFileSync(join(bare, 'index.js'), 'export default { fetch() {} }')
    expect(bundleHasGate(bare)).toBe(false)
    expect(bundleHasGate(join(bare, 'missing'))).toBe(false)
  })
})
