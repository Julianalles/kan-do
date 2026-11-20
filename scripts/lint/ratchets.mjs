/**
 * Count ratchets of the UI kit (#78, epic #58): a baseline of per-file counts, committed as data under
 * `tests/config/`, that may only fall. A file above its count fails (a new file has 0), a baseline above the real count
 * fails too ("lower it"), so a cleanup that removes a raw `<button>` or a `:ui` binding has to say so in the same PR.
 *
 * - `raw-button`: `<button>` elements in shipped Vue UI. A button is a `UButton` (DESIGN.md "Components", `/ui` Aktion
 *   entries) or the `ListRow` action row; a raw one needs a reason in the baseline.
 * - `ui-prop`: `:ui="…"` / `ui="…"` bindings, and the `*-ui` forwarding props (`:desktop-ui`, `:picker-ui`, …) that carry call-site classes into a `:ui`. Visual identity belongs in the `app.config.ts` theme or in tokens (epic #58
 *   D1, DESIGN.md "Guards"); the call-site `ui` prop only places a part.
 *
 * - `raw-element`: raw HTML elements (not `div`) in a page or layout template (#599, guard 90). Pages compose kit and feature
 *   components; a raw `<section>`, `<p>` or `<ul>` in a page is a row or a text role that has no element yet.
 * - `style-block`: a `<style>` block in a component outside the places that earn one (board, task, kit, overlay, recap) (#599, guard 91).
 * - `style-lines`: the lines of the `<style>` blocks of a board or task component, per file (#599, guard 91): a plain block count would only freeze the board.
 * - `ui-class-look`: a text, font, padding-to-zero, ring or background class in the `class` of a Nuxt UI component tag (#599, guard 98).
 *   The `ui-prop` ratchet counts the override prop only, so a look moved from `:ui` into a `class` would pass. Layout classes (width,
 *   flex, margin, position) and the tint of a `UIcon` (it takes the text colour of its place) do not count.
 *
 * Lower: `npm run ratchet:lower` (never raises; raising is a hand edit of the baseline, visible in the diff).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RATCHETS = {
  'raw-button': {
    baseline: 'tests/config/raw-button.baseline.json',
    pattern: /<button(?=[\s>/])/g,
    unit: 'raw <button> element',
    fix: 'use UButton (ghost or soft, color neutral; DESIGN.md "Components", /ui Aktion entries) or the ListRow action row; a kept raw button needs a reason in the baseline',
  },
  'ui-prop': {
    baseline: 'tests/config/ui-prop.baseline.json',
    pattern: /(?<![\w:.-])(?::|v-bind:)?(?:[a-z]+-)*ui=(?=["'])/g,
    unit: ':ui binding',
    fix: 'move the visual identity into the app.config.ts theme or a token (DESIGN.md "Guards", epic #58 D1); the call-site ui prop only places a part',
  },
  'raw-element': {
    baseline: 'tests/config/raw-element.baseline.json',
    applies: rel => /^(?:pages|layouts)\//.test(rel) && rel !== 'pages/ui.vue',
    count: text => [...templateOf(text).matchAll(/<([a-z][a-z0-9]*)(?=[\s>/])/g)].filter(m => !['div', 'template', 'slot', 'component'].includes(m[1])).length,
    unit: 'raw element',
    fix: 'a page holds kit and feature components and layout `div`s: use the element that has the role (SectionHeader, EmptyNote, PageSheet, ListRow, a UButton), or give the repeated row a shared component',
  },
  'style-block': {
    baseline: 'tests/config/style-block.baseline.json',
    applies: rel => !STYLE_HOMES.test(rel),
    count: text => (text.match(/^<style[\s>]/gm) ?? []).length,
    unit: 'style block outside board, task, ui, overlay and recap',
    plural: 'style blocks outside board, task, ui, overlay and recap',
    fix: 'use utilities or a theme slot; a style block earns its place only for what a utility cannot say (keyframes, a pseudo-element, a selector over children), and then needs a reason in the baseline',
  },
  'style-lines': {
    baseline: 'tests/config/style-lines.baseline.json',
    applies: rel => /^components\/(?:board|task)\//.test(rel),
    count: text => [...text.matchAll(/^<style[^>]*>\n([\s\S]*?)^<\/style>/gm)].reduce((sum, m) => sum + m[1].split('\n').length - 1, 0),
    unit: 'style line',
    fix: 'the board and the card justify a style block, not a growing one: move a repeated value into a token (main.css) and a repeated look into a shared class or the theme',
  },
  'ui-class-look': {
    baseline: 'tests/config/ui-class-look.baseline.json',
    count: text => kitClassLooks(templateOf(text)),
    unit: 'kit component tag with a look class',
    plural: 'kit component tags with a look class',
    fix: 'a text, font, padding-to-zero, ring or background class on a Nuxt UI component is a look: move it into the app.config.ts theme (a variant, or a slot) (DESIGN.md "Guards"); the call site places the component',
  },
}

/** The top-level `<template>` block of a single-file component (nested `<template #slot>` is indented). @param {string} text */
const templateOf = text => text.match(/^<template[^>]*>\n([\s\S]*?)^<\/template>/m)?.[1] ?? ''

/** Places a style block is expected: the board, the task card, the kit, overlays and the recap. */
const STYLE_HOMES = /^components\/(?:board|task|ui|overlay|recap)\//

/** Look classes: text (size, role, colour), font, padding to zero, ring and background. Alignment and wrapping are layout. */
const LOOK_CLASS = /^(?:text-(?!left$|center$|right$|start$|end$|wrap$|nowrap$|balance$|pretty$|ellipsis$|clip$)\S+|font-\S+|p[xytblrse]?-0|ring(?:-\S+)?|bg-\S+)$/

/** @param {string} text the template of a component; @returns {number} Nuxt UI tags (not `UIcon`) whose `class` writes a look */
function kitClassLooks(text) {
  let n = 0
  for (const tag of text.matchAll(/<(U[A-Z][A-Za-z]*)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    if (tag[1] === 'UIcon') continue
    const classes = [...tag[2].matchAll(/(?:^|\s):?class=(?:"([^"]*)"|'([^']*)')/g)].map(m => m[1] ?? m[2]).join(' ')
    // Variant prefixes are skipped bracket-aware: `md:bg-[color:var(--x)]` is a `bg-` class, the colon inside `[…]` is its value
    const tokens = classes.split(/[\s'"`,{}]+/).filter(Boolean).map(t => t.replace(/^(?:(?:\[[^\]]*\]|[^\s:[\]])+:)+/, '').replace(/^!/, ''))
    if (tokens.some(t => LOOK_CLASS.test(t))) n++
  }
  return n
}

const FOLDERS = ['components', 'pages', 'layouts']

/** @param {string} dir @returns {string[]} */
function vueFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

/** Shipped UI sources (prototypes and the error test page are not part of the kit), relative to `root`. @param {string} root */
export function uiSources(root) {
  const files = FOLDERS.flatMap(f => vueFiles(join(root, f)))
  if (existsSync(join(root, 'app.vue'))) files.push(join(root, 'app.vue'))
  return files.filter(f => !/error-test\.vue$|\/prototype\//.test(f)).map(f => relative(root, f))
}

/** HTML comments hold doc blocks that name `<button>` and `:ui`; they are not markup. @param {string} text */
const withoutComments = text => text.replace(/<!--[\s\S]*?-->/g, '')

/**
 * Per-file counts of one ratchet.
 * @param {string} root
 * @param {keyof typeof RATCHETS} name
 * @returns {Record<string, number>}
 */
export function countRatchet(root, name) {
  const def = /** @type {{ pattern?: RegExp, count?: (text: string) => number, applies?: (rel: string) => boolean }} */ (RATCHETS[name])
  /** @type {Record<string, number>} */
  const counts = {}
  for (const rel of uiSources(root)) {
    if (def.applies && !def.applies(rel)) continue
    const text = withoutComments(readFileSync(join(root, rel), 'utf8'))
    const n = def.count ? def.count(text) : (text.match(/** @type {RegExp} */ (def.pattern)) ?? []).length
    if (n > 0) counts[rel] = n
  }
  return counts
}

/**
 * @param {string} root
 * @param {keyof typeof RATCHETS} name
 * @returns {Record<string, { count: number, reason: string }>}
 */
export function readRatchetBaseline(root, name) {
  const path = join(root, RATCHETS[name].baseline)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
}

/**
 * Findings of one ratchet: a file above its baseline, a baseline above the count, an entry without a reason.
 * @param {string} root
 * @param {keyof typeof RATCHETS} name
 * @returns {string[]}
 */
export function checkRatchet(root, name) {
  const def = /** @type {{ baseline: string, unit: string, plural?: string, fix: string }} */ (RATCHETS[name])
  const { baseline: file, fix } = def
  /** @param {number} n */
  const noun = n => (n === 1 ? def.unit : def.plural ?? `${def.unit}s`)
  const real = countRatchet(root, name)
  const base = readRatchetBaseline(root, name)
  /** @type {string[]} */
  const out = []
  for (const [path, n] of Object.entries(real)) {
    const limit = base[path]?.count ?? 0
    if (n > limit) out.push(`${path} has ${n} ${noun(n)}, the baseline allows ${limit}: ${fix}`)
  }
  for (const [path, entry] of Object.entries(base)) {
    const n = real[path] ?? 0
    if (entry.count > n) out.push(`${file}: ${path} has ${n} ${noun(n)}, the baseline says ${entry.count}; lower it (npm run ratchet:lower)`)
    if (!entry.reason || !entry.reason.trim()) out.push(`${file}: ${path} needs a reason (why it stays, or which issue removes it)`)
  }
  return out
}

/**
 * Rewrites every baseline down to the real counts. Never raises: a file above its baseline is reported and left alone.
 * @param {string} root
 * @returns {string[]} files above their baseline
 */
export function lowerRatchets(root) {
  /** @type {string[]} */
  const refused = []
  for (const name of /** @type {(keyof typeof RATCHETS)[]} */ (Object.keys(RATCHETS))) {
    const real = countRatchet(root, name)
    const base = readRatchetBaseline(root, name)
    /** @type {Record<string, { count: number, reason: string }>} */
    const next = {}
    for (const [path, entry] of Object.entries(base)) {
      const n = Math.min(real[path] ?? 0, entry.count)
      if (n > 0) next[path] = { count: n, reason: entry.reason }
    }
    for (const [path, n] of Object.entries(real)) if (n > (base[path]?.count ?? 0)) refused.push(`${name}: ${path} has ${n}, the baseline allows ${base[path]?.count ?? 0}`)
    writeFileSync(join(root, RATCHETS[name].baseline), `${JSON.stringify(next, null, 2)}\n`)
  }
  return refused
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), '../../..')
  if (process.argv.includes('--update')) {
    const refused = lowerRatchets(root)
    for (const r of refused) console.log(`not raised: ${r}`)
    process.exit(refused.length > 0 ? 1 : 0)
  }
  const findings = /** @type {(keyof typeof RATCHETS)[]} */ (Object.keys(RATCHETS)).flatMap(n => checkRatchet(root, n))
  for (const f of findings) console.log(f)
  process.exit(findings.length > 0 ? 1 : 0)
}
