import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checkRatchet, countRatchet, lowerRatchets, RATCHETS, readRatchetBaseline } from '../../scripts/lint/ratchets.mjs'
import { buildManifest, loadCatalogEntries, UI_CATEGORIES } from '../../scripts/ui-manifest.mjs'
import { missingEntries } from '~/dev-tools/ui-catalog/validateEntry'
import type { ManifestRow } from '~/dev-tools/ui-catalog/catalogModel'

// Count ratchets of the UI kit (#78, epic #58, #599): raw `<button>`, `:ui` bindings, raw page elements, style blocks and look classes per file, against committed baselines
// that may only fall (`npm run ratchet:lower`), and the `/ui` entries check. Counts, not a frozen file list, so the category
// slices that remove buttons and bindings in parallel only lower their own file's number.

const root = resolve(__dirname, '../..')
const names = Object.keys(RATCHETS) as (keyof typeof RATCHETS)[]

describe('count ratchets on the repository (#78)', () => {
  for (const name of names) {
    it(`${name}: no file above its baseline, no baseline above its count, every entry has a reason`, () => {
      expect(checkRatchet(root, name)).toEqual([])
    })
    it(`${name}: scans the real sources`, () => {
      expect(Object.keys(countRatchet(root, name)).length).toBeGreaterThan(5)
      expect(Object.keys(readRatchetBaseline(root, name)).length).toBeGreaterThan(5)
    })
  }
})

describe('seeded violations (#78)', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  function fixture(files: Record<string, string>, baselines: Record<string, unknown> = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'ratchets-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'tests/config'), { recursive: true })
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
    for (const name of names) writeFileSync(join(dir, RATCHETS[name].baseline), JSON.stringify(baselines[name] ?? {}))
    return dir
  }

  it('a new raw <button> fails and names the fix and the owning doc', () => {
    const dir = fixture({ 'components/New.vue': '<template><button class="x">Go</button></template>' })
    const [finding] = checkRatchet(dir, 'raw-button')
    expect(finding).toContain('components/New.vue has 1 raw <button> element, the baseline allows 0')
    expect(finding).toContain('UButton')
    expect(finding).toContain('DESIGN.md "Components"')
  })

  it('a new :ui or ui binding fails and names the theme and the epic decision; the *-ui forwarding props count, comments do not', () => {
    const dir = fixture({
      'pages/p.vue': '<template><UCard :ui="{ root: \'p-0\' }" /><UCard ui="x" /><Foo :picker-ui="a" :desktop-ui="b" /></template>',
      'components/c.vue': '<!-- doc: <button> and :ui="x" are described here -->\n<template><UCard /></template>',
    })
    expect(countRatchet(dir, 'ui-prop')).toEqual({ 'pages/p.vue': 4 })
    expect(countRatchet(dir, 'raw-button')).toEqual({})
    const [finding] = checkRatchet(dir, 'ui-prop')
    expect(finding).toContain('pages/p.vue has 4 :ui bindings, the baseline allows 0')
    expect(finding).toContain('app.config.ts theme')
    expect(finding).toContain('D1')
  })

  it('raw elements: a page counts everything but div, template and slot; a component and the dev page are not counted (#599, guard 90)', () => {
    const page = '<template>\n  <div><section><p>a</p><ul><li>x</li></ul></section><slot /><UButton /><template #x><span /></template></div>\n</template>\n<script setup lang="ts">\nconst a: Array<string> = []\n</script>'
    const dir = fixture({ 'pages/p.vue': page, 'pages/ui.vue': page, 'layouts/l.vue': '<template>\n  <main><slot /></main>\n</template>', 'components/C.vue': page })
    expect(countRatchet(dir, 'raw-element')).toEqual({ 'pages/p.vue': 5, 'layouts/l.vue': 1 })
    const [finding] = checkRatchet(dir, 'raw-element')
    expect(finding).toContain('pages/p.vue has 5 raw elements, the baseline allows 0')
  })

  it('style blocks: counted outside board, task, ui, overlay and recap; lines counted in board and task only (#599, guard 91)', () => {
    const block = '<template><div /></template>\n<style scoped>\n.a {\n  color: red;\n}\n</style>\n'
    const dir = fixture({
      'components/Misc.vue': block,
      'components/topic/T.vue': block,
      'components/board/B.vue': block,
      'components/ui/K.vue': block,
      'components/overlay/O.vue': block,
      'components/recap/R.vue': block,
      'components/task/Card.vue': `${block}<style>\n.b { top: 0; }\n</style>\n`,
      'pages/p.vue': '<template><div /></template>\n<style></style>\n',
    })
    expect(countRatchet(dir, 'style-block')).toEqual({ 'components/Misc.vue': 1, 'components/topic/T.vue': 1, 'pages/p.vue': 1 })
    expect(countRatchet(dir, 'style-lines')).toEqual({ 'components/board/B.vue': 3, 'components/task/Card.vue': 4 })
    expect(checkRatchet(dir, 'style-block')[0]).toContain('components/Misc.vue has 1 style block outside board, task, ui, overlay and recap, the baseline allows 0')
  })

  it('a look class on a kit component: text, font, padding to zero, ring and background count; layout classes and a UIcon tint do not (#599, guard 98)', () => {
    const dir = fixture({
      'components/Look.vue': [
        '<template>',
        '  <div>',
        '    <UButton class="px-0">a</UButton>',
        '    <UBadge :class="active ? \'ring ring-accented\' : \'\'" />',
        '    <ULink class="hover:text-default underline" />',
        '    <UCard class="bg-elevated" />',
        '    <UChip class="md:bg-[color:var(--x)]" />',
        '    <UAlert class="items-center w-full mt-2 flex-wrap" />',
        '    <UIcon name="i-ph-x" class="text-muted size-4" />',
        '    <UButton class="text-center" @click="() => go()">b</UButton>',
        '    <p class="text-muted bg-muted">no kit tag</p>',
        '  </div>',
        '</template>',
      ].join('\n'),
    })
    expect(countRatchet(dir, 'ui-class-look')).toEqual({ 'components/Look.vue': 5 })
    const [finding] = checkRatchet(dir, 'ui-class-look')
    expect(finding).toContain('components/Look.vue has 5 kit component tags with a look class, the baseline allows 0')
    expect(finding).toContain('app.config.ts theme')
  })

  it('a file at its baseline passes; above fails; a baseline above the count fails and says how to lower it', () => {
    const files = { 'components/Kept.vue': '<button>a</button><button>b</button>' }
    const entry = (count: number) => ({ 'components/Kept.vue': { count, reason: 'kept' } })
    expect(checkRatchet(fixture(files, { 'raw-button': entry(2) }), 'raw-button')).toEqual([])
    expect(checkRatchet(fixture(files, { 'raw-button': entry(1) }), 'raw-button')).toEqual([expect.stringContaining('baseline allows 1')])
    expect(checkRatchet(fixture(files, { 'raw-button': entry(3) }), 'raw-button')).toEqual([expect.stringContaining('npm run ratchet:lower')])
  })

  it('a baseline entry without a reason fails', () => {
    const dir = fixture({ 'components/Kept.vue': '<button>a</button>' }, { 'raw-button': { 'components/Kept.vue': { count: 1, reason: ' ' } } })
    expect(checkRatchet(dir, 'raw-button')).toEqual([expect.stringContaining('needs a reason')])
  })

  it('the lowering script lowers and drops entries, keeps reasons, and never raises', () => {
    const dir = fixture(
      { 'components/A.vue': '<button>a</button>', 'components/B.vue': '<button>a</button><button>b</button>' },
      { 'raw-button': { 'components/A.vue': { count: 3, reason: 'ra' }, 'components/Gone.vue': { count: 1, reason: 'rg' }, 'components/B.vue': { count: 1, reason: 'rb' } } },
    )
    const refused = lowerRatchets(dir)
    expect(refused).toEqual([expect.stringContaining('components/B.vue has 2')])
    expect(JSON.parse(readFileSync(join(dir, RATCHETS['raw-button'].baseline), 'utf8'))).toEqual({
      'components/A.vue': { count: 1, reason: 'ra' },
      'components/B.vue': { count: 1, reason: 'rb' },
    })
  })

  it('lowering is a no-op on the repository baselines', () => {
    for (const name of names) expect(existsSync(join(root, RATCHETS[name].baseline))).toBe(true)
    expect(names.flatMap(n => checkRatchet(root, n))).toEqual([])
  })
})

describe('/ui entries (#78, #66, #117)', () => {
  const manifest = buildManifest() as ManifestRow[]

  it('has a catalog folder for every category', () => {
    for (const category of UI_CATEGORIES) {
      expect(existsSync(join(root, 'catalog', category)), `catalog/${category}/ is missing: a category ships its /ui entries there (.claude/rules/ui-catalog.md)`).toBe(true)
    }
  })

  it('has no kit component without an entry; the check fails on a seeded gap', () => {
    const entries = (loadCatalogEntries() as { entry: unknown }[]).map(l => l.entry) as Parameters<typeof missingEntries>[1]
    expect(missingEntries(manifest, entries)).toEqual([])
    // the seeded gap is a kit component: a feature part may go without an entry
    expect(missingEntries(manifest, entries.filter(entry => (entry as { component: string }).component !== 'UButton'))).toEqual(['UButton'])
  })
})
