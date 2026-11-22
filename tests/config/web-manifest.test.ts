import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import de from '../../i18n/locales/de.json'

// Install and share metadata of the web app: the manifest, its icons, the iOS home screen icon and the link preview
// image. Regenerate the images with `node scripts/pwa-icons.mjs`; the source is docs/design/app-icon/.

const root = resolve(__dirname, '../..')
const publicFile = (href: string) => resolve(root, 'public', href.replace(/^\//, ''))
const manifest = JSON.parse(readFileSync(publicFile('manifest.webmanifest'), 'utf8'))
const nuxtConfig = readFileSync(resolve(root, 'nuxt.config.ts'), 'utf8')

// Width, height and colour type from a PNG's IHDR chunk (colour type 2 = RGB without alpha, 6 = RGBA)
function png(href: string) {
  const buf = readFileSync(publicFile(href))
  expect(buf.subarray(1, 4).toString('ascii'), `${href} is a PNG`).toBe('PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colourType: buf[25] }
}

describe('web manifest', () => {
  it('names the app and starts on the board', () => {
    expect(manifest).toMatchObject({
      id: '/',
      name: 'Kan-do',
      short_name: 'Kan-do',
      lang: 'de',
      start_url: '/tasks',
      scope: '/',
      display: 'standalone',
    })
  })

  it('describes the app with the welcome tagline', () => {
    expect(manifest.description).toBe(de.onboarding.page.tagline)
    expect(nuxtConfig).toContain(`const APP_DESCRIPTION = '${de.onboarding.page.tagline}'`)
  })

  it('takes theme and background from the paper canvas (paper-100), as the theme-color meta does', () => {
    expect(manifest.theme_color).toBe('#f3efe6')
    expect(manifest.background_color).toBe('#f3efe6')
    expect(nuxtConfig).toContain(`const THEME_COLOR = '${manifest.theme_color}'`)
  })

  it('lists 192 and 512 px icons for "any" and "maskable"', () => {
    const entries = manifest.icons.map((i: { sizes: string, purpose: string }) => `${i.purpose} ${i.sizes}`).sort()
    expect(entries).toEqual(['any 192x192', 'any 512x512', 'maskable 192x192', 'maskable 512x512'])
  })

  for (const icon of manifest.icons as Array<{ src: string, sizes: string, type: string, purpose: string }>) {
    it(`${icon.src} exists with its stated size`, () => {
      expect(icon.type).toBe('image/png')
      expect(existsSync(publicFile(icon.src))).toBe(true)
      const { width, height, colourType } = png(icon.src)
      expect(`${width}x${height}`).toBe(icon.sizes)
      // A maskable icon is full-bleed: no transparent corners for the launcher's mask to reveal
      if (icon.purpose === 'maskable') expect(colourType).toBe(2)
    })
  }
})

describe('head links', () => {
  it('links the manifest with credentials (the public instance gates cookie-less requests, ADR 021)', () => {
    expect(nuxtConfig).toContain(`{ rel: 'manifest', href: '/manifest.webmanifest', crossorigin: 'use-credentials' }`)
  })

  it('has an opaque 180 px apple-touch-icon', () => {
    expect(nuxtConfig).toContain(`{ rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' }`)
    expect(png('/apple-touch-icon.png')).toEqual({ width: 180, height: 180, colourType: 2 })
  })

  it('has a 1200 x 630 share image for link previews', () => {
    expect(nuxtConfig).toContain('`${SITE_URL}/og-image.png`')
    expect(nuxtConfig).toMatch(/twitter:card', content: 'summary_large_image'/)
    expect(png('/og-image.png')).toMatchObject({ width: 1200, height: 630 })
  })
})
