/**
 * @module copy-editor/follow
 * @description The deterministic part of "the tests follow the new copy" (#340, decision D4a): where the old value of
 * a changed key stands as a whole string literal in a test (`'…'`, `"…"`, `` `…` ``) or as a whole name or scalar in an
 * ARIA snapshot, it becomes the new value. Everything else (a regex, a fragment, an assertion about the content) is
 * left to the verify run and the repair round. A value that is short or that another key shares is never rewritten
 * blindly: it could mean something else in that test.
 * @responsibility Pure text rewriting plus the walk over `tests/`. Writes only `.ts` files and `.aria.yml` snapshots below `tests/`.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { flattenMessages, getLeaf } from '../../lib/copy-editor/messages'
import type { BaseTrees, Edit, Lang } from './validate'

export interface ChangedValue { key: string, lang: Lang, before: string, after: string }
export interface Skipped { key: string, lang: Lang, before: string, reason: 'short' | 'shared' }
/** `changes` is every changed value (the repair agent needs the skipped ones too), `files` what the exact rewrite touched. */
export interface RewriteResult { files: string[], skipped: Skipped[], changes: ChangedValue[] }

export const MIN_REWRITE_LENGTH = 3
/** Tests that quote their own fixtures, not the app's copy. */
const OWN_TESTS = ['tests/server/copy-editor/', 'tests/lib/copy-editor/', 'tests/fixtures/']
const SKIP_DIRS = new Set(['node_modules', 'test-results', 'playwright-report'])
const QUOTES = ["'", '"', '`'] as const

/** The values an edit changes, per language. */
export function changedValues(base: BaseTrees, edits: readonly Edit[]): ChangedValue[] {
  const out: ChangedValue[] = []
  for (const edit of edits) {
    for (const lang of ['de', 'en'] as const) {
      const before = getLeaf(base[lang], edit.key)
      if (before !== undefined && before !== edit[lang]) out.push({ key: edit.key, lang, before, after: edit[lang] })
    }
  }
  return out
}

/** Which changes may be rewritten by exact match, and which are left to the verify run. */
export function splitRewritable(base: BaseTrees, edits: readonly Edit[]): { rewritable: ChangedValue[], skipped: Skipped[] } {
  const changes = changedValues(base, edits)
  const flat = { de: flattenMessages(base.de), en: flattenMessages(base.en) }
  const rewritable: ChangedValue[] = []
  const skipped: Skipped[] = []
  for (const change of changes) {
    if (change.before.trim().length < MIN_REWRITE_LENGTH) {
      skipped.push({ key: change.key, lang: change.lang, before: change.before, reason: 'short' })
      continue
    }
    // Another key with the same text may be what the test means; two edited keys that end in the same text are safe.
    const shared = Object.entries(flat[change.lang]).some(([key, value]) => {
      if (key === change.key || value !== change.before) return false
      return !changes.some(other => other.key === key && other.lang === change.lang && other.after === change.after)
    })
    if (shared) skipped.push({ key: change.key, lang: change.lang, before: change.before, reason: 'shared' })
    else rewritable.push(change)
  }
  return { rewritable, skipped }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `text` as it is written between `quote` characters in TypeScript source. */
function encodeLiteral(text: string, quote: string): string {
  let out = text.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(quote, `\\${quote}`)
  if (quote === '`') out = out.replaceAll('${', '\\${')
  return out
}

/** One pass over the source, so a new value that equals another change's old value is not rewritten twice. */
export function rewriteSource(text: string, changes: readonly ChangedValue[]): string {
  const map = new Map<string, string>()
  for (const change of changes) {
    for (const quote of QUOTES) map.set(`${quote}${encodeLiteral(change.before, quote)}${quote}`, `${quote}${encodeLiteral(change.after, quote)}${quote}`)
  }
  if (map.size === 0) return text
  const pattern = new RegExp([...map.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'), 'g')
  return text.replace(pattern, match => map.get(match) ?? match)
}

const yamlInner = (text: string) => JSON.stringify(text).slice(1, -1)
/** A plain YAML scalar when that reads back the same, else a double-quoted one. */
const yamlScalar = (text: string) => (/^[\p{L}\p{N}][^:#]*$/u.test(text) && text === text.trim() ? text : JSON.stringify(text))

/** ARIA snapshot (`- button "Weiter"`, `- paragraph: Text`): quoted names and whole plain scalars. */
export function rewriteAria(text: string, changes: readonly ChangedValue[]): string {
  const quoted = new Map<string, string>()
  const plain = new Map<string, string>()
  for (const change of changes) {
    quoted.set(`"${yamlInner(change.before)}"`, `"${yamlInner(change.after)}"`)
    plain.set(change.before, yamlScalar(change.after))
  }
  if (quoted.size === 0) return text
  const pattern = new RegExp([...quoted.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'), 'g')
  return text.split('\n').map((line) => {
    const scalar = /^(\s*- [\w-]+: )(.*)$/.exec(line)
    if (scalar && plain.has(scalar[2]!)) return `${scalar[1]}${plain.get(scalar[2]!)}`
    return line.replace(pattern, match => quoted.get(match) ?? match)
  }).join('\n')
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

/** Rewrites the tests and ARIA snapshots below `<root>/tests`; returns the repository-relative files that changed. */
export function rewriteTests(root: string, base: BaseTrees, edits: readonly Edit[]): RewriteResult {
  const { rewritable, skipped } = splitRewritable(base, edits)
  const changes = changedValues(base, edits)
  const files: string[] = []
  if (rewritable.length === 0) return { files, skipped, changes }
  for (const path of walk(join(root, 'tests'))) {
    const rel = relative(root, path).split('\\').join('/')
    if (OWN_TESTS.some(prefix => rel.startsWith(prefix))) continue
    const aria = rel.endsWith('.aria.yml')
    if (!aria && !rel.endsWith('.ts')) continue
    const before = readFileSync(path, 'utf8')
    const after = aria ? rewriteAria(before, rewritable) : rewriteSource(before, rewritable)
    if (after !== before) {
      writeFileSync(path, after)
      files.push(rel)
    }
  }
  return { files: files.sort(), skipped, changes }
}
