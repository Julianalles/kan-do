import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// kd#179 (redesign slice 4): every dialog title is the subhead role (18 px Fraunces) and every menu is a 16 px sheet,
// both from the theme in `app.config.ts`, never from a call site. The rendered values are measured in
// `tests/e2e/modal-style.spec.ts` and `tests/e2e/overlay-elevation.spec.ts`; this keeps the theme and the sources from drifting.

const root = resolve(__dirname, '../..')
const config = readFileSync(join(root, 'app.config.ts'), 'utf8')

/** The text of one top-level theme key of `ui: { … }` (from `    key: {` to the next four-space key). */
function themeBlock(key: string): string {
  const start = config.search(new RegExp(`^ {4}${key}: \\{`, 'm'))
  expect(start, `${key} theme block`).toBeGreaterThanOrEqual(0)
  const rest = config.slice(start + 1)
  const next = rest.search(/^ {4}[a-zA-Z]+: [{[]/m)
  return next < 0 ? rest : rest.slice(0, next)
}

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

describe('dialog titles are the subhead role (kd#179)', () => {
  it.each(['modal', 'slideover', 'drawer'])('%s title slot is 18 px display face, weight and tracking explicit', (key) => {
    const title = themeBlock(key).match(/^\s*title: '([^']+)'/m)?.[1] ?? ''
    expect(title.split(' ')).toEqual(expect.arrayContaining(['font-display', 'text-lg', 'font-medium', 'tracking-display']))
  })

  it('no call site sets a size or a face in a #title slot or a `title:` ui string', () => {
    const offenders: string[] = []
    for (const folder of ['components', 'pages', 'layouts']) {
      for (const path of vueFiles(join(root, folder))) {
        const text = readFileSync(path, 'utf8')
        for (const slot of text.matchAll(/<template #title[^>]*>([\s\S]*?)<\/template>/g)) {
          if (/\b(text-(xs|sm|base|lg|xl|[2-9]xl|display|headline|title)|font-display)\b/.test(slot[1]!)) offenders.push(`${path}: #title slot`)
        }
        if (!/<(AppDialog|UModal|ResponsiveOverlay|UDrawer|USlideover)\b/.test(text)) continue // a notice's `title` is not a dialog title
        for (const ui of text.matchAll(/\btitle: '([^']*)'/g)) {
          if (/\btext-/.test(ui[1]!)) offenders.push(`${path}: title ui string "${ui[1]}"`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('menus, popovers and toasts are 16 px sheets with the warm shadow (kd#179)', () => {
  it.each(['popover', 'dropdownMenu', 'contextMenu', 'inputMenu', 'select', 'selectMenu'])('%s content takes rounded-lg and the overlay shadow', (key) => {
    const content = themeBlock(key).match(/^\s*content: '([^']+)'/m)?.[1] ?? ''
    expect(content.split(' ')).toEqual(expect.arrayContaining(['rounded-lg', 'shadow-(--shadow-overlay)']))
  })

  it('a toast is a 16 px sheet from Nuxt UI (rounded-lg) with the overlay shadow from the theme', () => {
    expect(themeBlock('toast')).toContain('shadow-(--shadow-overlay)')
    expect(readFileSync(join(root, '.nuxt/ui/toast.ts'), 'utf8')).toMatch(/"root": "[^"]*\brounded-lg\b/)
  })
})

describe('dropdown menu rows keep the phone floor (#336)', () => {
  it('a row is 32 px from md up and at least 44 px below it', () => {
    const item = themeBlock('dropdownMenu').match(/^\s*item: '([^']+)'/m)?.[1] ?? ''
    expect(item.split(' ')).toEqual(expect.arrayContaining(['min-h-8', 'max-md:min-h-11', 'max-md:items-center']))
    expect(item.split(' ')).not.toContain('items-center')
  })

  it.each([['select', 'min-h-9'], ['selectMenu', 'min-h-8'], ['contextMenu', 'min-h-10']])('%s rows keep their desktop height and take the floor below md (#342)', (slot, desktop) => {
    const item = themeBlock(slot).match(/^\s*item: '([^']+)'/m)?.[1] ?? ''
    expect(item.split(' ')).toEqual(expect.arrayContaining([desktop, 'max-md:min-h-11']))
    expect(item.split(' ')).toContain(slot === 'contextMenu' ? 'items-center' : 'max-md:items-center')
  })
})

describe('command palette rows keep the phone floor (#345)', () => {
  it('a row is 36 px from md up and at least 44 px below it, content centred below md', () => {
    // The rows' look is the `commandPalette` theme (#599), not a call-site `:ui`
    const src = readFileSync(join(root, 'app.config.ts'), 'utf8')
    const item = src.slice(src.indexOf('commandPalette: {')).match(/^\s*item: '([^']+)'/m)?.[1] ?? ''
    expect(item.split(' ')).toEqual(expect.arrayContaining(['min-h-9', 'max-md:min-h-11', 'max-md:items-center']))
    expect(item.split(' ')).not.toContain('items-center')
  })
})

describe('the app bar problem dot takes the 700 step (#599, WCAG 1.4.11)', () => {
  it('the chip theme fills with the same role steps as the solid badge, not the 500 step', () => {
    const src = readFileSync(join(root, 'app.config.ts'), 'utf8')
    expect(src).toMatch(/chip: \{\s*variants: \{ color: ROLE_FILL \}/)
    expect(src).toMatch(/const ROLE_FILL = \{[^}]*warning: 'bg-warning-700'/)
  })
})
