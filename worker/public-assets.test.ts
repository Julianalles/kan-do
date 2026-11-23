// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { IMAGE_CACHE, MANIFEST_CACHE, PUBLIC_ASSETS, isPublicAssetRequest, withAssetHeaders } from './public-assets'

const SITE = 'https://kando.example.workers.dev'
const req = (path: string, method = 'GET') => new Request(SITE + path, { method })

describe('public assets table', () => {
  it('gives the manifest its own type and an hour, every image a day', () => {
    expect(PUBLIC_ASSETS.get('/manifest.webmanifest')).toEqual({ contentType: 'application/manifest+json', cacheControl: MANIFEST_CACHE })
    expect(MANIFEST_CACHE).toBe('public, max-age=3600')
    expect(IMAGE_CACHE).toBe('public, max-age=86400')
    for (const [path, asset] of PUBLIC_ASSETS) {
      if (path !== '/manifest.webmanifest') expect(asset.cacheControl, path).toBe(IMAGE_CACHE)
    }
    expect(PUBLIC_ASSETS.get('/favicon.ico')?.contentType).toBe('image/x-icon')
    expect(PUBLIC_ASSETS.get('/favicon.svg')?.contentType).toBe('image/svg+xml')
  })

  it('the exempt check is exact and read-only', () => {
    expect(isPublicAssetRequest(req('/og-image.png'))).toBe(true)
    expect(isPublicAssetRequest(req('/og-image.png', 'HEAD'))).toBe(true)
    expect(isPublicAssetRequest(req('/og-image.png?x=1'))).toBe(true)
    expect(isPublicAssetRequest(req('/og-image.png', 'POST'))).toBe(false)
    expect(isPublicAssetRequest(req('/constructor'))).toBe(false)
    expect(isPublicAssetRequest(req('/__proto__'))).toBe(false)
    expect(isPublicAssetRequest(req('/OG-IMAGE.PNG'))).toBe(false)
  })
})

describe('withAssetHeaders', () => {
  const png = () => new Response('x', { headers: { 'Content-Type': 'application/octet-stream' } })

  it('sets type and cache lifetime on a successful non-HTML answer', () => {
    const res = withAssetHeaders(req('/icon-192.png'), png())
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toBe(IMAGE_CACHE)
    const manifest = withAssetHeaders(req('/manifest.webmanifest'), png())
    expect(manifest.headers.get('Content-Type')).toBe('application/manifest+json')
    expect(manifest.headers.get('Cache-Control')).toBe(MANIFEST_CACHE)
  })

  it('works on an immutable-header upstream response and keeps the body', async () => {
    const upstream = Response.redirect(SITE + '/x', 302)
    expect(() => upstream.headers.set('a', 'b')).toThrow()
    const ok = new Response('body', { status: 200 })
    expect(await withAssetHeaders(req('/og-image.png'), ok).text()).toBe('body')
  })

  it('leaves an HTML answer (a missing file falling to the shell), an error and an unlisted path untouched', () => {
    const html = new Response('<p>shell</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    expect(withAssetHeaders(req('/og-image.png'), html)).toBe(html)
    const missing = new Response('nope', { status: 404 })
    expect(withAssetHeaders(req('/og-image.png'), missing)).toBe(missing)
    const other = png()
    expect(withAssetHeaders(req('/_nuxt/a.js'), other)).toBe(other)
    expect(withAssetHeaders(req('/og-image.png', 'POST'), other)).toBe(other)
  })
})
