import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sourceHomeUrl, sourceTaskUrl } from '~/lib/taskSources'

// #850: "In Notion öffnen" did nothing in the desktop app, because the opener plugin's allow list named one Notion URL
// only and refused every task page. Each URL shape the two builders return must match an allow pattern.

const root = resolve(__dirname, '../..')
const capabilities = JSON.parse(readFileSync(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8')) as {
  permissions: Array<string | { identifier: string, allow?: Array<{ url: string }> }>
}
const openerPatterns = capabilities.permissions
  .flatMap(p => (typeof p === 'object' && p.identifier === 'opener:allow-open-url' ? p.allow ?? [] : []))
  .map(entry => entry.url)

/** tauri-plugin-opener matches with `glob::Pattern` and its default options: `*` and `**` also cross `/`, `?` is one character. */
const globToRegExp = (pattern: string) => new RegExp(`^${pattern
  .replace(/[.+^${}()|\\]/g, '\\$&')
  .replace(/\*+/g, '.*')
  .replace(/\?/g, '.')}$`)
const allowed = (url: string) => openerPatterns.some(pattern => globToRegExp(pattern).test(url))

const PAGE_ID = '1a2b3c4d-1111-2222-3333-444455556666'
const urls = [
  sourceTaskUrl({ source: 'notion', externalId: PAGE_ID }),
  sourceTaskUrl({ source: 'todoist', externalId: '8123456789' }),
  sourceHomeUrl('notion', { notionDatabaseId: PAGE_ID }),
  sourceHomeUrl('todoist'),
]

describe('source pages and the desktop opener (#850)', () => {
  it('builds a URL for every case under test', () => {
    expect(urls.every(url => typeof url === 'string')).toBe(true)
  })

  it.each(urls)('the desktop opener may open %s', (url) => {
    expect(allowed(url!)).toBe(true)
  })

  it('keeps the allow list narrow: no pattern covers another host', () => {
    expect(allowed('https://example.com/')).toBe(false)
    expect(allowed('https://www.notion.so.example.com/page')).toBe(false)
    expect(openerPatterns.every(pattern => !/^https:\/\/\*/.test(pattern))).toBe(true)
  })
})
