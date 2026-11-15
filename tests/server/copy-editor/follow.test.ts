// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { changedValues, rewriteAria, rewriteSource, rewriteTests, splitRewritable } from '~/server/copy-editor/follow'

const base = {
  de: { welcome: { intro: 'Standardmäßig liegen sie lokal', title: 'Willkommen', ok: 'OK', same1: 'Weiter', same2: 'Weiter' }, it: 'Don\'t go' },
  en: { welcome: { intro: 'They stay local by default', title: 'Welcome', ok: 'OK', same1: 'Next', same2: 'Next' }, it: 'Don\'t go' },
}
const edit = (key: string, de: string, en: string) => ({ key, de, en })

describe('copy publish: changed values and what may be rewritten blindly', () => {
  it('lists only the languages whose text changed', () => {
    expect(changedValues(base, [edit('welcome.title', 'Hallo', 'Welcome')])).toEqual([{ key: 'welcome.title', lang: 'de', before: 'Willkommen', after: 'Hallo' }])
  })

  it('leaves short values and values another key shares to the checks', () => {
    const split = splitRewritable(base, [edit('welcome.ok', 'Gut', 'OK'), edit('welcome.same1', 'Los', 'Next'), edit('welcome.title', 'Hallo', 'Welcome')])
    expect(split.rewritable.map(change => change.key)).toEqual(['welcome.title'])
    expect(split.skipped).toEqual([
      { key: 'welcome.ok', lang: 'de', before: 'OK', reason: 'short' },
      { key: 'welcome.same1', lang: 'de', before: 'Weiter', reason: 'shared' },
    ])
  })

  it('rewrites a value shared by two edited keys that end in the same text', () => {
    const split = splitRewritable(base, [edit('welcome.same1', 'Los', 'Next'), edit('welcome.same2', 'Los', 'Next')])
    expect(split.rewritable.map(change => change.key)).toEqual(['welcome.same1', 'welcome.same2'])
  })
})

describe('copy publish: source rewrite', () => {
  const changes = [{ key: 'welcome.title', lang: 'de' as const, before: 'Willkommen', after: 'Hallo "Du"' }]

  it('rewrites a whole literal in every quote style and escapes the new value', () => {
    const text = `await expect(page.getByText('Willkommen')).toBeVisible()\ngetByRole('heading', { name: "Willkommen" })\nconst x = \`Willkommen\``
    expect(rewriteSource(text, changes)).toBe(`await expect(page.getByText('Hallo "Du"')).toBeVisible()\ngetByRole('heading', { name: "Hallo \\"Du\\"" })\nconst x = \`Hallo "Du"\``)
  })

  it('leaves a regex source, a fragment and a longer literal alone', () => {
    const text = `a(/Willkommen/); b('Willkommen zurück'); c('im Willkommen'); d(\`Willkommen \${x}\`)`
    expect(rewriteSource(text, changes)).toBe(text)
  })

  it('handles an apostrophe in the old value and does not chain two rewrites', () => {
    const swap = [
      { key: 'a', lang: 'en' as const, before: 'Don\'t go', after: 'Stay' },
      { key: 'b', lang: 'en' as const, before: 'Stay', after: 'Go on' },
    ]
    expect(rewriteSource(`x("Don't go"); y('Don\\'t go'); z('Stay')`, swap)).toBe(`x("Stay"); y('Stay'); z('Go on')`)
  })
})

describe('copy publish: ARIA snapshot rewrite', () => {
  const changes = [{ key: 'k', lang: 'de' as const, before: 'Weiter zur Liste', after: 'Los geht\'s: Liste' }]

  it('rewrites quoted names and whole plain scalars, quoting the new value when YAML needs it', () => {
    const yml = ['- button "Weiter zur Liste"', '- paragraph: Weiter zur Liste', '- paragraph: Weiter zur Liste und mehr', '- link "Weiter zur Liste" [level=1]'].join('\n')
    expect(rewriteAria(yml, changes)).toBe(['- button "Los geht\'s: Liste"', '- paragraph: "Los geht\'s: Liste"', '- paragraph: Weiter zur Liste und mehr', '- link "Los geht\'s: Liste" [level=1]'].join('\n'))
  })
})

describe('copy publish: walk over tests/', () => {
  const dirs: string[] = []
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

  it('rewrites specs and ARIA snapshots, skips the editor\'s own tests and non-test files, and reports the files', () => {
    const root = mkdtempSync(join(tmpdir(), 'follow-'))
    dirs.push(root)
    for (const dir of ['tests/e2e/snapshots/x.spec.ts', 'tests/server/copy-editor', 'tests/store']) mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, 'tests/e2e/a.spec.ts'), `x('Willkommen')`)
    writeFileSync(join(root, 'tests/e2e/b.spec.ts'), `x('Anderes')`)
    writeFileSync(join(root, 'tests/e2e/snapshots/x.spec.ts/s.aria.yml'), '- heading "Willkommen"')
    writeFileSync(join(root, 'tests/e2e/snapshots/x.spec.ts/s.png'), 'Willkommen')
    writeFileSync(join(root, 'tests/server/copy-editor/own.test.ts'), `x('Willkommen')`)
    writeFileSync(join(root, 'tests/store/c.test.ts'), `x('Willkommen')`)
    const result = rewriteTests(root, base, [edit('welcome.title', 'Hallo', 'Welcome'), edit('welcome.ok', 'Gut', 'OK')])
    expect(result.files).toEqual(['tests/e2e/a.spec.ts', 'tests/e2e/snapshots/x.spec.ts/s.aria.yml', 'tests/store/c.test.ts'])
    expect(readFileSync(join(root, 'tests/e2e/a.spec.ts'), 'utf8')).toBe(`x('Hallo')`)
    expect(readFileSync(join(root, 'tests/e2e/b.spec.ts'), 'utf8')).toBe(`x('Anderes')`)
    expect(readFileSync(join(root, 'tests/server/copy-editor/own.test.ts'), 'utf8')).toBe(`x('Willkommen')`)
    expect(readFileSync(join(root, 'tests/e2e/snapshots/x.spec.ts/s.png'), 'utf8')).toBe('Willkommen')
    expect(result.skipped).toEqual([{ key: 'welcome.ok', lang: 'de', before: 'OK', reason: 'short' }])
    // every changed value, rewritten or not, goes on to the repair agent
    expect(result.changes.map(change => change.key)).toEqual(['welcome.title', 'welcome.ok'])
  })
})
