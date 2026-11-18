// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HASHES_FILE, SHELL_FILES, cspHash, executableInlineScripts, scriptHashes } from '../../scripts/csp-hashes.mjs'
import { buildCsp } from '../../worker/csp'

// Guard for the web CSP (#504, ADR 021, ADR 012 "Web build"), the counterpart of tauri-csp.test.ts and
// csp-build-output.test.ts for the Cloudflare Worker. The policy itself is pinned in worker/csp.test.ts; here the
// build output is held against it. The second block reads `.output` and the generated hashes, so it needs
//   npm run build:cloudflare && npx vitest run tests/config/web-csp.test.ts
// and is skipped without a build (as csp-build-output.test.ts is).

const root = resolve(__dirname, '../..')
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8')
const hashesPath = resolve(root, HASHES_FILE)
// Only a Cloudflare build counts (it has the Nitro server next to the public files); the static build of `npm run build`
// or `generate` leaves another build id in its shell and the generated hashes would not belong to it.
const cloudflareBuild = existsSync(resolve(root, '.output/server/index.mjs'))
const shells = cloudflareBuild ? SHELL_FILES.filter(file => existsSync(resolve(root, file))) : []

describe('scripts/csp-hashes.mjs', () => {
  const shell = [
    '<!DOCTYPE html><html><head>',
    '<script type="importmap">{"imports":{"#entry":"/_nuxt/a.js"}}</script>',
    '<script type="module" src="/_nuxt/a.js" crossorigin></script>',
    '<script>window.__NUXT__={};window.__NUXT__.config={app:{buildId:"x"}}</script>',
    '<script type="application/json" data-nuxt-data="nuxt-app" id="__NUXT_DATA__">[{"serverRendered":1},false]</script>',
    '</head><body></body></html>',
  ].join('')

  it('picks the executable inline scripts only: not a script with src, not a JSON data block', () => {
    expect(executableInlineScripts(shell)).toEqual([
      '{"imports":{"#entry":"/_nuxt/a.js"}}',
      'window.__NUXT__={};window.__NUXT__.config={app:{buildId:"x"}}',
    ])
  })

  it('hashes the exact script text as CSP wants it (sha256, base64)', () => {
    // sha256("") in base64
    expect(cspHash('')).toBe('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=')
    expect(scriptHashes(shell)).toHaveLength(2)
    expect(scriptHashes(shell)).toContain(cspHash('{"imports":{"#entry":"/_nuxt/a.js"}}'))
    expect(cspHash(' x')).not.toBe(cspHash('x')) // whitespace counts
  })

  it('every hash it produces is accepted by the policy builder', () => {
    expect(() => buildCsp(scriptHashes(shell))).not.toThrow()
  })
})

describe('build:cloudflare wiring', () => {
  it('prerenders the shell for the Cloudflare preset, so a built HTML file exists to hash', () => {
    expect(read('nuxt.config.ts')).toMatch(/NITRO_PRESET === 'cloudflare_module'[^\n]*prerender:\s*\{\s*routes:\s*\['\/200\.html'\]/)
  })

  it('the hashes file is generated, never committed', () => {
    expect(read('.gitignore')).toContain(HASHES_FILE)
  })

  it('the Worker entry hands the generated hashes to the pipeline', () => {
    expect(read('worker/index.ts')).toMatch(/from '\.\/csp-hashes\.generated\.json'/)
    expect(read('worker/index.ts')).toContain('hashes.scriptHashes')
  })
})

describe.skipIf(!shells.length || !existsSync(hashesPath))('built shell under the web CSP', () => {
  const generated = (existsSync(hashesPath) ? JSON.parse(readFileSync(hashesPath, 'utf8')) : { scriptHashes: [] }) as { scriptHashes: string[] }
  const csp = existsSync(hashesPath) ? buildCsp(generated.scriptHashes) : ''
  const scriptSrc = (csp.split('; ').find(part => part.startsWith('script-src ')) ?? '').split(' ')

  it.each(shells)('every executable inline script of %s has its hash in script-src', (file) => {
    const html = read(file)
    const needed = executableInlineScripts(html).map(cspHash)
    expect(needed.length).toBeGreaterThan(0)
    for (const hash of needed) expect(scriptSrc, `${file}: ${hash}`).toContain(`'${hash}'`)
  })

  it('script-src names no hash the shell does not have (a stale generated file)', () => {
    const live = new Set(shells.flatMap(file => executableInlineScripts(read(file)).map(cspHash)))
    expect(generated.scriptHashes.filter(hash => !live.has(hash))).toEqual([])
  })

  it.each(shells)('%s has no inline <style>, event handler or javascript: URL (style-src and script-src would block them)', (file) => {
    const html = read(file)
    expect(html).not.toMatch(/<style\b/i)
    expect(html).not.toMatch(/\son\w+\s*=/i)
    expect(html).not.toMatch(/javascript:/i)
  })

  it.each(shells)('%s references only same-origin resources', (file) => {
    const urls = [...read(file).matchAll(/(?<![\w-])(?:src|href|action|poster|data)\s*=\s*"([^"]*)"/g)].map(m => m[1] ?? '')
    expect(urls.filter(u => !/^\/(?!\/)/.test(u))).toEqual([])
  })
})
