import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// #552 (audit U4), kd#177, #424: one button size and variant ladder (DESIGN.md "Components", "The One Height Rule").
// One height for every button, the primary's: `md` (the default, 36 px, 48 px on a phone); `lg` is the same line and
// no call site names it; four looks: solid, soft, ghost, link. The theme in `app.config.ts` carries the explicit
// height and the phone floor; a button that stays smaller is a listed exception with a reason. This test keeps the
// theme and the call sites from drifting.

const root = resolve(__dirname, '../..')
const FOLDERS = ['components', 'pages', 'layouts']

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

/** Source of the app files that ship UI (prototypes and the error test page are not part of the ladder; `/ui` is, it has no buttons). */
function appFiles(): string[] {
  const files = FOLDERS.flatMap((folder) => vueFiles(join(root, folder)))
  files.push(join(root, 'app.vue'))
  return files.filter((f) => !/error-test\.vue$|\/prototype\//.test(f))
}

interface ButtonTag { file: string; line: number; attrs: string }

/** Every `<UButton ...>` open tag; quote-aware, because attribute values hold `=>` and `>` (e.g. `@click="() => x"`). */
function buttonTags(): ButtonTag[] {
  const tags: ButtonTag[] = []
  for (const path of appFiles()) {
    const text = readFileSync(path, 'utf8')
    const open = /<u-?button(?=[\s/>])/gi
    let match: RegExpExecArray | null
    while ((match = open.exec(text))) {
      let i = match.index + match[0].length
      let quote = ''
      for (; i < text.length; i++) {
        const c = text[i]!
        if (quote) { if (c === quote) quote = '' } else if (c === '"' || c === "'") quote = c
        else if (c === '>') break
      }
      tags.push({
        file: relative(root, path),
        line: text.slice(0, match.index).split('\n').length,
        attrs: text.slice(match.index + match[0].length, i)
      })
    }
  }
  return tags
}

const attr = (attrs: string, name: string): string | null => {
  const m = attrs.match(new RegExp(`(?:^|\\s)(?::|v-bind:)?${name}=("[^"]*"|'[^']*')`))
  return m ? m[1]!.slice(1, -1) : null
}

const where = (t: ButtonTag) => `${t.file}:${t.line}`

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'prototype' ? [] : sourceFiles(path)
    return /\.(vue|ts)$/.test(entry.name) && !/error-test\.vue$/.test(entry.name) ? [path] : []
  })
}

/** Files whose `size: 'sm'` or `variant: 'outline'` belongs to another component than `UButton`; each entry says which. */
const PROP_OBJECT_EXEMPT: Record<string, string> = {
  'components/task/TaskPriorityBadge.vue': 'UBadge size (badges are slice 3 to 5)',
  'components/ui/inline/InlineEditable.vue': 'UInput variant of the inline field, not a button',
}

/** Files that still write `size="lg"` on a button; `lg` is an alias of the default size, so it is harmless, each entry says why it stays. */
const LG_ALIAS_ALLOWED: Record<string, string> = {
  'components/recap/NewDayRecap.vue': 'the recap screen is redesigned in #428; the alias keeps this PR out of its way, #428 drops it',
}

/** The one link that sits inside running text, so it is text and not a 32 px button (kd#177): it sets `md:h-auto`. */
const INLINE_TEXT_LINKS = ['components/feedback/FeedbackDialog.vue']

/** The two-line sync button of the Mehr panel (label plus last sync time, about 48 px of content): it grows with its text from `md` up (`md:h-auto md:min-h-9`) instead of spilling out of a fixed 36 px box. */
const TWO_LINE_BUTTONS = ['components/nav/MorePanel.vue']

/**
 * Buttons that stay 32 px on desktop by design (#424), all drawn by their own unlayered CSS and all 44 px on a phone: the
 * round icon-only buttons of the board's chrome (the Offen header's add button on the title line, the plan arrows beside a
 * card, the stack header's close button) and the stack/notice actions, whose geometry is tied to the 32 px title line, the
 * card corner and the 48 px note strip (`--task-note-height`). A new entry needs a reason a reviewer can weigh.
 */
const SMALLER_BY_DESIGN: Record<string, string> = {
  'components/board/BoardColumnHeader.vue': 'round add button on the 32 px title line, out of the flow',
  'assets/css/board.css': '`.plan-arrow`: round arrow beside a card, 32 px like the header add button',
  'components/task/TaskStackHeader.vue': 'round close button in the stack header, same look as the header add button',
  'components/task/TaskCard.vue': 'the card-corner menu button (#296): a 28 px circle with a 44 px hit area, tied to the card corner',
  'components/board/NewCardFlow.vue': '`.ncf__nav` on a 128 px card: the head ends 12 px above the answer row',
  'components/board/BoardFocusBar.vue': '`.board-focus-bar__end`: 28 px round end button inside the 36 px focus pill, 4 px from its edge',
  'components/board/BoardColumnNotice.vue': '`.notice__action`: `xs` action inside the 48 px note strip (#377)',
}

describe('button ladder: call sites (#552, kd#177)', () => {
  const tags = buttonTags()

  it('finds the buttons it scans', () => {
    expect(tags.length).toBeGreaterThan(100)
  })

  it('uses no `sm`, `xs` or `xl` size and no `outline` or `subtle` variant: they left the vocabulary', () => {
    const hits = tags.filter((t) => {
      const size = attr(t.attrs, 'size') ?? ''
      const variant = attr(t.attrs, 'variant') ?? ''
      return /(^|')(xs|sm|xl)('|$)/.test(size) || /(^|')(outline|subtle)('|$)/.test(variant)
    })
    expect(hits.map(where)).toEqual([])
  })

  it('sets no touch-target class: the theme floor makes every button 44 px on a phone', () => {
    const hits = tags.filter((t) => /touch-target/.test(t.attrs))
    expect(hits.map(where)).toEqual([])
  })

  it('names `md` nowhere: it is the default size', () => {
    const hits = tags.filter((t) => attr(t.attrs, 'size') === 'md')
    expect(hits.map(where)).toEqual([])
  })

  it('lets only a link inside running text drop the height (`md:h-auto`) and the phone floor (`max-md:min-h-0`)', () => {
    const hits = tags.filter((t) => /(^|[\s"'])md:h-auto/.test(t.attrs) && !INLINE_TEXT_LINKS.includes(t.file) && !TWO_LINE_BUTTONS.includes(t.file))
    expect(hits.map(where)).toEqual([])
    for (const file of INLINE_TEXT_LINKS) {
      const tag = tags.find((t) => t.file === file && /md:h-auto/.test(t.attrs))
      expect(tag, file).toBeDefined()
      expect(attr(tag!.attrs, 'variant'), file).toBe('link')
      expect(tag!.attrs, file).toMatch(/max-md:min-h-0/)
    }
  })

  it('names `lg` nowhere: every button has the primary\'s height, so the CTA needs no size (#424)', () => {
    const hits = tags.filter((t) => /(^|')lg('|$)/.test(attr(t.attrs, 'size') ?? '') && LG_ALIAS_ALLOWED[t.file] === undefined)
    expect(hits.map(where)).toEqual([])
  })

  it('keeps every `lg` exemption and every smaller-by-design file honest: the file exists and says why', () => {
    for (const [file, why] of [...Object.entries(LG_ALIAS_ALLOWED), ...Object.entries(SMALLER_BY_DESIGN)]) {
      expect(why.length, file).toBeGreaterThan(10)
      expect(() => readFileSync(join(root, file), 'utf8'), file).not.toThrow()
    }
  })

  it('writes no 32 px utility class (h-8, min-h-8, size-8) on a button outside the smaller-by-design list', () => {
    const files = [...FOLDERS.flatMap((folder) => sourceFiles(join(root, folder))), join(root, 'assets/css/board.css'), join(root, 'assets/css/task-detail.css')]
    const hits: string[] = []
    for (const path of files) {
      const file = relative(root, path)
      if (SMALLER_BY_DESIGN[file] !== undefined) continue
      readFileSync(path, 'utf8').split('\n').forEach((text, index) => {
        if (/\b(?:md:)?(?:h-8|min-h-8|size-8)\b/.test(text) && !/<UIcon/.test(text) && !/\bmin-h-8 w-full\b/.test(text)) hits.push(`${file}:${index + 1}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('keeps the removed sizes and looks out of buttons configured as prop objects too (`:close`, alert and toast `actions`, `ButtonProps`)', () => {
    const files = [...FOLDERS.flatMap((folder) => sourceFiles(join(root, folder))), ...sourceFiles(join(root, 'composables'))]
    const hits: string[] = []
    for (const path of files) {
      const file = relative(root, path)
      readFileSync(path, 'utf8').split('\n').forEach((text, index) => {
        if (/\b(size|variant)\s*:\s*'(xs|sm|xl|outline|subtle)'/.test(text) && PROP_OBJECT_EXEMPT[file] === undefined) hits.push(`${file}:${index + 1}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('gives an icon-only button (`square`, static or bound) the ghost look: a soft one would be a second fill beside its row\'s main action (kd#177)', () => {
    const hits = tags.filter((t) => /(^|\s):?square(\s|=|$|\/)/.test(t.attrs) && attr(t.attrs, 'variant') !== 'ghost')
    expect(hits.map(where)).toEqual([])
  })
})

describe('button ladder: theme (#552)', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals() })

  async function theme() {
    vi.stubGlobal('defineAppConfig', (config: unknown) => config)
    const { default: config } = await import('~/app.config')
    return (config as unknown as { ui: { button: ButtonTheme } }).ui.button
  }

  interface ButtonTheme {
    defaultVariants?: { size?: string }
    slots?: { base?: string | string[] }
    variants?: { size?: Record<string, { base?: string } | undefined> }
    compoundVariants?: Array<{ size?: string; square?: boolean; color?: string | string[]; variant?: string; class?: string }>
  }

  const base = (t: ButtonTheme) => [t.slots?.base ?? []].flat().join(' ')

  it('pins `md` as the default size', async () => {
    expect((await theme()).defaultVariants?.size).toBe('md')
  })

  it('floors every button at 44 px on a phone', async () => {
    expect(base(await theme())).toContain('max-md:min-h-11')
  })

  it('writes the desktop height of every size that stays: md 36 (the primary\'s), lg the same line, the notice action xs 24', async () => {
    const sizes = (await theme()).variants?.size
    expect(sizes?.md?.base).toMatch(/(^|\s)md:h-9(\s|$)/)
    expect(sizes?.lg?.base).toBe(sizes?.md?.base)
    expect(sizes?.xs?.base).toMatch(/(^|\s)md:h-6(\s|$)/)
  })

  it('lifts the default size to 48 px on a phone, like the former main action (#424)', async () => {
    expect((await theme()).variants?.size?.md?.base).toContain('max-md:min-h-12')
  })

  it('keeps the label of every button at the 14 px interface step', async () => {
    const sizes = (await theme()).variants?.size
    expect(sizes?.md?.base).toMatch(/(^|\s)text-sm(\s|$)/)
    expect(sizes?.lg?.base).not.toMatch(/text-base/)
  })

  it('gives a solid primary and a solid error button a 96 px minimum width, not an icon-only one (#424)', async () => {
    const compound = (await theme()).compoundVariants?.find((c) => c.variant === 'solid' && c.square === false && /min-w-24/.test(c.class ?? ''))
    expect(compound).toBeDefined()
    expect([compound!.color].flat().sort()).toEqual(['error', 'primary'])
  })

  it('sets the notice action `xs` at the 14 px text step of the notice beside it, not Nuxt UI\'s 12 px (#377)', async () => {
    const base = (await theme()).variants?.size?.xs?.base ?? ''
    expect(base).toMatch(/(^|\s)text-sm(\s|$)/)
    expect(base).not.toMatch(/(^|\s)text-xs(\s|$)/)
  })

  it('leaves the notice action `xs` without a floor: the notice has its own phone rule', async () => {
    const xs = (await theme()).compoundVariants?.find((c) => c.size === 'xs')
    expect(xs?.class).toContain('max-md:min-h-0')
  })

  it('makes icon-only buttons 44 px wide on a phone and 36 px wide on desktop', async () => {
    const square = (await theme()).compoundVariants?.find((c) => c.square === true)
    expect(square?.class).toContain('max-md:min-w-11')
    expect(square?.class).toContain('max-md:min-h-11')
    expect(square?.class).toContain('md:min-w-9')
  })
})
