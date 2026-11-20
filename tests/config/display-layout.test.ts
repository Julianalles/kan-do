import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// kd#180 (redesign slice 5): one sheet shape, one heading implementation, one list row, one badge size, the closed radius
// scale. Counts at zero: the slice deleted what these look for, so a return fails here (the lock-in guards of kd#182 follow).

const root = resolve(__dirname, '../..')

function files(dir: string, ext: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return files(path, ext)
    return ext.some(e => entry.name.endsWith(e)) ? [path] : []
  })
}

const shipped = ['components', 'pages', 'layouts']
  .flatMap(f => files(join(root, f), ['.vue']))
  .filter(f => !/error-test\.vue$|\/ui\.vue$|\/prototype\//.test(f))
const css = files(join(root, 'assets/css'), ['.css'])

/** Template and style text without the doc-block comments. */
const body = (path: string) => readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '')

function hits(pattern: RegExp, paths: string[]): string[] {
  return paths.filter(p => pattern.test(body(p))).map(p => relative(root, p))
}

describe('display and layout (kd#180)', () => {
  it('the section-heading utility is gone', () => {
    expect(hits(/section-heading/, [...shipped, ...css])).toEqual([])
  })

  it('no heading writes the display face by hand: SectionHeader and PageHeader carry them (the column header and the wordmark keep their CSS)', () => {
    const allowed = /BoardColumnHeader\.vue$|PageHeader\.vue$|SectionHeader\.vue$|TaskDetailContent\.vue$/
    expect(hits(/\bfont-display\b/, shipped.filter(p => !allowed.test(p)))).toEqual([])
  })

  // A heading element with a text or font class writes its type by hand (DESIGN.md "Head a section", #590). A ratchet: a file above its
  // count fails (a new file has 0), a count above the real number fails too ("lower it"). A screen-reader-only heading has no such class.
  const HAND_WRITTEN_HEADING = /<(?:h[1-6]|legend)\b[^>]*\b(?:text|font)-[\w-]+[^>]*>/gs
  const KEPT_HEADINGS: Record<string, { count: number, reason: string }> = {
    'components/board/BoardColumnHeader.vue': { count: 1, reason: 'the column name keeps its own CSS (SectionHeader.vue "avoid")' },
    'components/ui/PageHeader.vue': { count: 1, reason: 'PageHeader is the page title itself' },
  }

  it('no new heading or legend writes its type by hand: SectionHeader carries it (the listed files only fall)', () => {
    const real: Record<string, number> = {}
    for (const p of shipped) {
      const n = [...body(p).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(HAND_WRITTEN_HEADING)].length
      if (n > 0) real[relative(root, p)] = n
    }
    const findings = [
      ...Object.entries(real).filter(([f, n]) => n > (KEPT_HEADINGS[f]?.count ?? 0)).map(([f, n]) => `${f} has ${n} hand-written heading(s), the list allows ${KEPT_HEADINGS[f]?.count ?? 0}: use SectionHeader (a field group's caption is size="label")`),
      ...Object.entries(KEPT_HEADINGS).filter(([f, e]) => e.count > (real[f] ?? 0)).map(([f, e]) => `${f} is listed with ${e.count} but has ${real[f] ?? 0}: lower the list`),
      ...Object.entries(KEPT_HEADINGS).filter(([, e]) => !e.reason.trim()).map(([f]) => `${f} needs a reason`),
    ]
    expect(findings).toEqual([])
  })

  it('no surface uses a radius outside 8, 12, 16 px, pill and circle', () => {
    expect(hits(/\brounded-(?:xs|xl|2xl|3xl|\[)/, shipped)).toEqual([])
    expect(hits(/--radius-(?:xs|xl|2xl|3xl)\b/, [...shipped, ...css])).toEqual([])
  })

  it('no ListRow sets a density or a hover', () => {
    expect(hits(/<ListRow\b[^>]*?\s(?:density|hover)=/s, shipped)).toEqual([])
  })

  it('no badge sets a size and no badge text is 8 px', () => {
    expect(hits(/<UBadge\b[^>]*?\ssize=/s, shipped)).toEqual([])
    expect(hits(/<TaskPriorityBadge\b[^>]*?\ssize=/s, shipped)).toEqual([])
    expect(readFileSync(join(root, 'app.config.ts'), 'utf8')).not.toContain('text-[0.5rem]')
  })

  it('the old tones of the statistics tile are gone', () => {
    expect(hits(/rounded-3xl|bg-primary\/10 p-6/, shipped)).toEqual([])
  })
})
