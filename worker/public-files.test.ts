// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SECURITY_CONTACT, SECURITY_VALIDITY_DAYS, publicFile, robotsTxt, securityTxt, sitemapXml } from './public-files'

const NOW = new Date('2026-12-01T10:00:00.000Z')
const run = (url: string, method = 'GET') => publicFile(new Request(url, { method }), NOW)

describe('robots.txt', () => {
  it('allows the site, keeps crawlers off the API and names the sitemap on the request origin', async () => {
    const res = run('https://kando.example.workers.dev/robots.txt')!
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
    expect(res.headers.get('X-Robots-Tag')).toBeNull()
    const body = await res.text()
    expect(body).toContain('User-agent: *\nAllow: /\nDisallow: /api/\n')
    expect(body).toContain('Sitemap: https://kando.example.workers.dev/sitemap.xml')
    expect(body).not.toMatch(/^Disallow: \/$/m)
  })

  it('follows the host (a custom domain needs no change)', async () => {
    expect(await run('https://app.example/robots.txt')!.text()).toContain('Sitemap: https://app.example/sitemap.xml')
    expect(robotsTxt('http://localhost:3104')).toContain('Sitemap: http://localhost:3104/sitemap.xml')
  })
})

describe('sitemap.xml', () => {
  it('lists the canonical page on the request origin, as XML', async () => {
    const res = run('https://app.example/sitemap.xml')!
    expect(res.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    const body = await res.text()
    expect(body).toContain('<loc>https://app.example/</loc>')
    expect(body.match(/<loc>/g)).toHaveLength(1)
    expect(sitemapXml('https://x.example')).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
  })
})

describe('security.txt (RFC 9116)', () => {
  it('has Contact and an Expires 180 days after the request, Canonical on the origin', async () => {
    const res = run('https://app.example/.well-known/security.txt')!
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    const body = await res.text()
    expect(body).toContain(`Contact: ${SECURITY_CONTACT}`)
    expect(SECURITY_CONTACT).toMatch(/^https:\/\/github\.com\/jaylouiz\/kan-do\/security\/advisories\/new$/)
    expect(body).toContain('Expires: 2027-05-30T10:00:00.000Z')
    expect(SECURITY_VALIDITY_DAYS).toBe(180)
    expect(body).toContain('Canonical: https://app.example/.well-known/security.txt')
    expect(body).toContain('Preferred-Languages: de, en')
    expect(body).not.toMatch(/mailto:|@/)
  })

  it('the lines follow the field order of the RFC examples', () => {
    expect(securityTxt('https://x.example', NOW).split('\n').map(line => line.split(':')[0]).slice(0, 4))
      .toEqual(['Contact', 'Expires', 'Preferred-Languages', 'Canonical'])
  })
})

describe('method and path', () => {
  it('HEAD has the headers and no body', async () => {
    const res = run('https://app.example/robots.txt', 'HEAD')!
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(await res.text()).toBe('')
  })

  it('other methods and other paths fall through to the app', () => {
    expect(run('https://app.example/robots.txt', 'POST')).toBeUndefined()
    expect(run('https://app.example/sitemap.xml', 'PUT')).toBeUndefined()
    for (const path of ['/robots.txt/', '/ROBOTS.TXT', '/security.txt', '/.well-known/security.txt/', '/.well-known/', '/sitemap.xml.gz', '/tasks'])
      expect(run('https://app.example' + path), path).toBeUndefined()
  })
})
