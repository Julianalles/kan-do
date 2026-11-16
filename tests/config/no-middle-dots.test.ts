import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// #412: the middle dot is never used in UI copy (docs/copy/voice.md "No middle dots", owner rule 2026-11-16).
// Scans the locale values and the source of everything that can render copy; comments and doc blocks are removed first.
const root = resolve(__dirname, '../..')
const DOT = '·'

function files(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path, exts)
    return exts.some((e) => path.endsWith(e)) ? [path] : []
  })
}

function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

function localeValues(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (node && typeof node === 'object') return Object.values(node).flatMap(localeValues)
  return []
}

describe('no middle dots in UI copy (#412)', () => {
  it('has none in a locale value', () => {
    const locales = files(join(root, 'i18n/locales'), ['.json'])
    expect(locales.length).toBeGreaterThanOrEqual(2)
    const offenders = locales.flatMap((f) =>
      localeValues(JSON.parse(readFileSync(f, 'utf8'))).filter((v) => v.includes(DOT)).map((v) => `${relative(root, f)}: ${v}`))
    expect(offenders).toEqual([])
  })

  it('has none in a literal or template text of components, pages, layouts, composables, lib or app.vue', () => {
    const sources = [
      ...files(join(root, 'components'), ['.vue', '.ts']),
      ...files(join(root, 'pages'), ['.vue', '.ts']),
      ...files(join(root, 'layouts'), ['.vue', '.ts']),
      ...files(join(root, 'composables'), ['.ts']),
      ...files(join(root, 'lib'), ['.ts']),
      join(root, 'app.vue'),
    ]
    expect(sources.length).toBeGreaterThan(100)
    const offenders = sources.filter((f) => stripComments(readFileSync(f, 'utf8')).includes(DOT))
    expect(offenders.map((f) => relative(root, f))).toEqual([])
  })
})
