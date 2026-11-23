// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUBLIC_ASSETS } from '../../worker/public-assets'
import { previewPage } from '../../worker/gate'
import { SHARE_DESCRIPTION, SHARE_IMAGE_ALT, SHARE_IMAGE_PATH, SHARE_NAME } from '../../worker/share'

// #736, #738: the Worker's public brand assets, the share tags of its 401 page and the root files, held against what the
// app ships (public/, the manifest, the head in nuxt.config.ts). The tests of the Worker's logic are in worker/*.test.ts.

const root = resolve(__dirname, '../..')
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8')
const nuxtConfig = read('nuxt.config.ts')
const manifest = JSON.parse(read('public/manifest.webmanifest')) as { description: string, icons: Array<{ src: string }> }

/** Every `href` of a head link and every `/…` path a manifest icon names: the files a browser fetches by itself. */
function referencedFiles(): string[] {
  const links = [...nuxtConfig.matchAll(/\{ rel: '(?:icon|apple-touch-icon|manifest)'[^}]*href: '([^']+)'/g)].map(m => m[1]!)
  return [...links, ...manifest.icons.map(icon => icon.src), SHARE_IMAGE_PATH]
}

describe('public brand assets', () => {
  it('every listed file exists in public/ (a typo would exempt nothing and serve nothing)', () => {
    for (const path of PUBLIC_ASSETS.keys()) expect(existsSync(resolve(root, 'public', path.slice(1))), path).toBe(true)
  })

  it('every icon, manifest and share image the head and the manifest name is on the list', () => {
    const files = referencedFiles()
    expect(files.length).toBeGreaterThanOrEqual(8)
    for (const file of new Set(files)) expect(PUBLIC_ASSETS.has(file), `${file} is fetched without the gate's cookie`).toBe(true)
  })

  it('lists nothing the app needs for itself: no script, shell or API path', () => {
    for (const path of PUBLIC_ASSETS.keys()) expect(path).toMatch(/^\/[\w.-]+\.(png|svg|ico|webmanifest)$/)
  })
})

describe('share tags of the 401 page', () => {
  const head = (key: string) => {
    const m = nuxtConfig.match(new RegExp(`^\\s*\\{ (?:property|name): '${key}', content: (.*?) \\},?$`, 'm'))
    return m?.[1]
  }

  it('use the manifest\'s description and the config\'s name, alt text and image path', () => {
    expect(SHARE_DESCRIPTION).toBe(manifest.description)
    expect(nuxtConfig).toContain(`const APP_NAME = '${SHARE_NAME}'`)
    expect(nuxtConfig).toContain(`const APP_DESCRIPTION = '${SHARE_DESCRIPTION}'`)
    expect(head('og:image:alt')).toBe(`'${SHARE_IMAGE_ALT}'`)
    expect(head('og:image')).toBe('`${SITE_URL}' + SHARE_IMAGE_PATH + '`')
  })

  it('cover every og: and twitter: tag of the app shell', () => {
    const page = previewPage('https://x.example')
    const keys = [...nuxtConfig.matchAll(/^\s*\{ (?:property|name): '((?:og|twitter):[a-z:_]+)'/gm)].map(m => m[1]!)
    expect(keys.length).toBe(13)
    for (const key of keys) expect(page, key).toMatch(new RegExp(`<meta (?:property|name)="${key}" content="`))
  })
})

describe('no static robots.txt (the Worker builds it from the request origin)', () => {
  it('public/ has neither robots.txt, sitemap.xml nor security.txt', () => {
    for (const file of ['robots.txt', 'sitemap.xml', '.well-known/security.txt']) expect(existsSync(resolve(root, 'public', file)), file).toBe(false)
  })
})

describe('Vercel headers (#738)', () => {
  it('nuxt.config.ts builds its routeRules from the Worker table (vercel.json `headers` do not reach the Build Output API config)', () => {
    expect(nuxtConfig).toContain("import { PUBLIC_ASSETS } from './worker/public-assets'")
    expect(nuxtConfig).toMatch(/routeRules: Object\.fromEntries\(\[\.\.\.PUBLIC_ASSETS\]/)
  })

  // Reads the output of `VERCEL=1 npx nuxt build`; skipped without it, as csp-build-output.test.ts is.
  const config = resolve(root, '.vercel/output/config.json')
  it.skipIf(!existsSync(config))('the Vercel build output carries the table\'s headers for every listed path', () => {
    const routes = (JSON.parse(readFileSync(config, 'utf8')) as { routes: Array<{ src?: string, headers?: Record<string, string> }> }).routes
    for (const [path, asset] of PUBLIC_ASSETS) {
      const route = routes.find(r => r.src === path)
      expect(route?.headers, path).toMatchObject({ 'Content-Type': asset.contentType, 'Cache-Control': asset.cacheControl })
    }
  })
})
