import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// #497: `.impeccable/design.json` is the Impeccable design-system sidecar of DESIGN.md (`/impeccable document`).
// PR #496 changed a named rule of DESIGN.md and left the sidecar stale. A named rule is the part of DESIGN.md that
// both files must state word for word, so a changed or added rule fails here until the sidecar is refreshed.

const root = resolve(__dirname, '../..')
const designMd = readFileSync(resolve(root, 'DESIGN.md'), 'utf8')
const sidecar = JSON.parse(readFileSync(resolve(root, '.impeccable/design.json'), 'utf8')) as {
  schemaVersion: number
  narrative: { rules: { name: string, body: string }[] }
}

const docRules = [...designMd.matchAll(/^\*\*(The [^*]+? Rule)\.\*\* (.*)$/gm)].map(m => ({ name: m[1], body: m[2] }))

describe('Impeccable sidecar (#497)', () => {
  it('reads DESIGN.md rules', () => {
    expect(docRules.length).toBeGreaterThan(5)
    expect(sidecar.schemaVersion).toBe(2)
  })

  it.each(docRules)('states $name as DESIGN.md does', ({ name, body }) => {
    const rule = sidecar.narrative.rules.find(r => r.name === name)
    expect(rule, `${name} is missing from .impeccable/design.json: run /impeccable document and keep DESIGN.md unchanged`).toBeDefined()
    expect(rule?.body, `${name} differs from DESIGN.md: refresh .impeccable/design.json (/impeccable document)`).toBe(body)
  })

  it('carries no rule DESIGN.md dropped', () => {
    const names = new Set(docRules.map(r => r.name))
    expect(sidecar.narrative.rules.map(r => r.name).filter(n => !names.has(n))).toEqual([])
  })
})
