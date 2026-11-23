import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LEGAL_PATHS, legalUrl, type LegalPage } from '~/lib/legalLinks'

// #745: one constant holds the legal URLs. The desktop app opens them through the opener plugin, whose allow list must
// cover them, and the README repeats them by hand: both drift silently when the constant changes.

const root = resolve(__dirname, '../..')
const capabilities = JSON.parse(readFileSync(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8')) as {
  permissions: Array<string | { identifier: string, allow?: Array<{ url: string }> }>
}
const openerPatterns = capabilities.permissions
  .flatMap(p => (typeof p === 'object' && p.identifier === 'opener:allow-open-url' ? p.allow ?? [] : []))
  .map(entry => entry.url)

const allowed = (url: string) => openerPatterns.some(pattern =>
  pattern.endsWith('/**') ? url.startsWith(pattern.slice(0, -2)) : url === pattern)

const pages = Object.keys(LEGAL_PATHS) as LegalPage[]
const urls = pages.flatMap(page => [legalUrl(page, 'de'), legalUrl(page, 'en')])

describe('lib/legalLinks.ts', () => {
  it('picks the English page for an English locale and the German one otherwise', () => {
    expect(legalUrl('impressum', 'en-US')).toMatch(/\/en\/legal-notice\/$/)
    expect(legalUrl('impressum', 'de')).toMatch(/\/impressum\/$/)
    expect(legalUrl('privacy', 'fr')).toBe(legalUrl('privacy', 'de'))
  })

  it.each(urls)('the desktop opener may open %s', (url) => {
    expect(allowed(url)).toBe(true)
  })

  it.each(urls)('the README links %s', (url) => {
    expect(readFileSync(resolve(root, 'README.md'), 'utf8')).toContain(url)
  })
})

describe('no Notion or Todoist logo (#745)', () => {
  it('no app source names a brand icon of Notion or Todoist', async () => {
    const { spawnSync } = await import('node:child_process')
    const hits = spawnSync('git', ['grep', '-n', '-E', 'simple-icons[-:](notion|todoist)|ph[-:]notion-logo', '--', 'components', 'composables', 'pages', 'layouts', 'lib', 'utils', 'app.vue', 'app.config.ts', 'nuxt.config.ts', 'catalog'], { cwd: root, encoding: 'utf8' }).stdout.trim()
    expect(hits).toBe('')
  })
})
