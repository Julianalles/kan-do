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

  it('the Notion limiter is gone: no Durable Object binding, a migration deletes its class, the entry exports none (#742)', () => {
    const config = read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, '')
    expect(config).not.toContain('"durable_objects"')
    expect(config).not.toContain('"ratelimits"')
    expect(config).toMatch(/\{\s*"tag":\s*"v1",\s*"new_sqlite_classes":\s*\["NotionLimiter"\]\s*\}/)
    expect(config).toMatch(/\{\s*"tag":\s*"v2",\s*"deleted_classes":\s*\["NotionLimiter"\]\s*\}/)
    expect(read('worker/index.ts')).not.toMatch(/NotionLimiter|limiter/)
  })

  it('Workers Logs keep no request detail: query strings redacted, invocation logs off (#530)', () => {
    const config = read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, '')
    const observability = JSON.parse(config.replace(/,(\s*[}\]])/g, '$1')).observability
    expect(observability).toMatchObject({ enabled: true, redact_query_string: true, logs: { invocation_logs: false } })
  })

  it('the production build registers the error handler that keeps the query out of the log and wraps Nuxt\'s own (#525)', () => {
    const config = read('nuxt.config.ts')
    expect(config).toContain("'nitro:config'(nitroConfig)")
    expect(config).toContain("new URL('./server/error-handler.ts', import.meta.url)")
    expect(config).toContain("nitroConfig.errorHandler = 'kan-do:error-handler'")
    // a plain `errorHandler:` key in the nitro block would make Nuxt skip its own handler (the `/__nuxt_error` page)
    expect(config).not.toMatch(/^\s*errorHandler:/m)
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
