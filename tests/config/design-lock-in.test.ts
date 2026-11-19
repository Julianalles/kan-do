import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// kd#182 (redesign lock-in): the rules DESIGN.md stated and nothing checked. Static reads of the shipped UI; the two
// rules that need a rendered page are checked there: one solid green button per view in `tests/e2e/design-detect.spec.ts`,
// `aria-current` on one control per route in `tests/e2e/app-nav.spec.ts`.

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
const config = readFileSync(join(root, 'app.config.ts'), 'utf8')

/** File text without HTML doc blocks and CSS/JS comments, so a rule named in a comment is not a hit. */
const body = (path: string) => readFileSync(path, 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** `file: match` for every match of `pattern` in `paths`, except the listed exceptions (`file: match` too). */
function hits(pattern: RegExp, paths: string[], exceptions: Record<string, string> = {}): string[] {
  const found = paths.flatMap(p => [...body(p).matchAll(pattern)].map(m => `${relative(root, p)}: ${m[0].trim()}`))
  const unused = Object.keys(exceptions).filter(e => !found.includes(e))
  expect(unused, 'exceptions that no longer occur: remove them').toEqual([])
  return found.filter(f => !(f in exceptions))
}

/** The text of one top-level theme key of `ui: { … }` in `app.config.ts`. */
function themeBlock(key: string): string {
  const start = config.search(new RegExp(`^ {4}${key}: \\{`, 'm'))
  expect(start, `${key} theme block`).toBeGreaterThanOrEqual(0)
  const rest = config.slice(start + 1)
  const next = rest.search(/^ {4}[a-zA-Z]+: [{[]/m)
  return next < 0 ? rest : rest.slice(0, next)
}

describe('line heights come from the size tokens (DESIGN.md "Type")', () => {
  // `text-2xl/tight` sets a line height through the size class (#590): the size token carries its own (`--text-*--line-height`)
  const SIZE_WITH_LINE_HEIGHT = /\btext-(?:xs|sm|base|lg|xl|[2-9]xl|body|label|title|headline|display|brand)\/[\w.()[\]-]+/g

  it('no leading-* class or size class with a line height (text-<size>/<lh>) in shipped UI or the theme', () => {
    expect(hits(new RegExp(`\\bleading-[\\w.()[\\]-]+|${SIZE_WITH_LINE_HEIGHT.source}`, 'g'), shipped, {
      // The clock in the ring is one line in a fixed box at two sizes
      'components/statistics/StatsTimeSplit.vue: leading-(--lh-tight)': 'single-line figure in the donut',
    })).toEqual([])
    expect([...config.matchAll(/\bleading-[\w.()[\]-]+/g)].map(m => m[0])).toEqual([])
    // The one chip size sets its 12 px line in the theme (kd#180); a second one needs a reason here
    expect([...config.replace(/\/\/.*$/gm, '').matchAll(SIZE_WITH_LINE_HEIGHT)].map(m => m[0]).filter(m => m !== 'text-xs/3')).toEqual([])
  })

  it('a hand-written line-height is a token, 1 on a fixed single-line box, or a listed exception', () => {
    expect(hits(/(?<![-\w])line-height:\s*(?!\s|var\(--lh-|1;|0;|inherit;)[^;]+;/g, [...shipped, ...css], {
      'components/task/TaskTimeboxNudge.vue: line-height: 1.25rem;': 'rows at fixed offsets in the 132 px card (kd#190)',
    })).toEqual([])
  })
})

describe('weight 600 is for a key figure (DESIGN.md "The One Role Rule", #590)', () => {
  // The sans stays at 400 to 500; 600 and up only where this list names the file with its reason. A ratchet: a file above its
  // count fails (a new file has 0), a count above the real number fails too ("lower it"), so a cleanup says so in its PR.
  const WEIGHT = /\bfont-(?:semibold|bold|extrabold|black)\b|font-weight:\s*(?:[6-9]00|bold)\b/g
  const KEPT: Record<string, { count: number, reason: string }> = {
    'components/statistics/StatsEstimateRing.vue': { count: 1, reason: 'key figure: the estimate count in the ring' },
    'components/statistics/StatsTimeSplit.vue': { count: 1, reason: 'key figure: the clock in the donut' },
    'components/statistics/StatsVerdict.vue': { count: 1, reason: 'key figure: the verdict percentage' },
    'components/statistics/TasksTable.vue': { count: 1, reason: 'key figure: the accuracy in the table' },
    'components/board/DayCloseTimebox.vue': { count: 1, reason: 'key figure: the day-close count' },
    'components/ui/PropertyValueTrigger.vue': { count: 1, reason: 'the picked suggestion is told apart from the others by weight (#590, user-ticked item 7)' },
    'components/board/NewCardOptionList.vue': { count: 1, reason: 'the current option is told apart by weight as well as colour (not colour alone, WCAG 1.4.1), like the picked suggestion' },
    'components/updates/UpdateDialog.vue': { count: 1, reason: '<strong> in running text: the bullet title' },
    'components/updates/WhatsNewDialog.vue': { count: 1, reason: '<strong> in running text: the bullet title' },
    'components/overlay/NowWindow.vue': { count: 1, reason: 'key figure: the running clock of the always-on-top window (13 px, tabular figures)' },
    'assets/css/task-detail.css': { count: 2, reason: 'user-written markdown in the notes: headings and <strong> keep their emphasis' },
  }

  it('only the listed files write a weight of 600 or more, each at most its count, each with a reason', () => {
    const real: Record<string, number> = {}
    for (const p of [...shipped, ...css]) {
      const n = [...body(p).matchAll(WEIGHT)].length
      if (n > 0) real[relative(root, p)] = n
    }
    const findings = [
      ...Object.entries(real).filter(([f, n]) => n > (KEPT[f]?.count ?? 0)).map(([f, n]) => `${f} has ${n} weight 600 use(s), the list allows ${KEPT[f]?.count ?? 0}: step the text to 500 (font-medium), or list a key figure with its reason`),
      ...Object.entries(KEPT).filter(([f, e]) => e.count > (real[f] ?? 0)).map(([f, e]) => `${f} is listed with ${e.count} but has ${real[f] ?? 0}: lower the list`),
      ...Object.entries(KEPT).filter(([, e]) => !e.reason.trim()).map(([f]) => `${f} needs a reason`),
    ]
    expect(findings).toEqual([])
  })
})

describe('icon sizes are 12, 16, 20 or 24 px (DESIGN.md "Icons")', () => {
  it('every UIcon size class is size-3, size-4, size-5 or size-6', () => {
    const sizes = shipped.flatMap(p => [...body(p).matchAll(/<UIcon\b[^>]*>/gs)].flatMap(tag =>
      [...tag[0].matchAll(/\b(?:size|w|h)-[\w.()[\]-]+/g)].map(m => `${relative(root, p)}: ${m[0]}`)))
    const exceptions: Record<string, string> = {
      'components/ui/EmptyState.vue: size-10': 'the empty state\'s illustration, not an icon beside text',
      'components/setup/NotionSetupFlow.vue: size-8': 'the success mark of the finished setup, an illustration',
      'components/setup/RemindersSetupFlow.vue: size-8': 'the success mark of the finished setup, the same illustration as the Notion setup\'s',
    }
    expect(Object.keys(exceptions).filter(e => !sizes.includes(e)), 'exceptions that no longer occur: remove them').toEqual([])
    expect(sizes.filter(s => !/: size-[3456]$/.test(s) && !(s in exceptions))).toEqual([])
  })
})

describe('a control casts no shadow (The Sheets Cast Shadows Rule)', () => {
  const controls = 'UButton|UInput|UInputNumber|UTextarea|USelect|USelectMenu|USwitch|UCheckbox|URadioGroup|UTabs|ChoiceChip|ChoiceCard'

  it('no call site puts a shadow class on a control', () => {
    expect(hits(new RegExp(`<(?:${controls})\\b[^>]*?\\bshadow-(?!none)[^>]*>`, 'gs'), shipped)).toEqual([])
  })

  it.each(['button', 'input', 'inputNumber', 'textarea', 'switch', 'checkbox', 'radioGroup', 'tabs'])('the %s theme has no shadow', (key) => {
    if (!new RegExp(`^ {4}${key}: \\{`, 'm').test(config)) return // not themed: Nuxt UI's default has none on the control
    expect([...themeBlock(key).matchAll(/\bshadow-(?!none)[\w()[\]-]+/g)].map(m => m[0])).toEqual([])
  })

  it.each(['select', 'selectMenu'])('the %s theme has a shadow only on its menu (a sheet)', (key) => {
    const lines = themeBlock(key).split('\n').filter(line => /\bshadow-(?!none)/.test(line))
    expect(lines.filter(line => !/^\s*content:/.test(line))).toEqual([])
  })
})
