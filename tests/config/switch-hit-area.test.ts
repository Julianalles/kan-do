import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// #592 (review): the switch's phone hit area is an invisible `::after` around a 32.8 x 16.8 track. A switch sits beside a
// field with a `gap-3` (12 px) between them (Notion custom-properties step), so the pseudo-element may reach 6 px to
// the sides (32.8 + 12 = 44.8 px wide) and never the 12 px of the gap: 14 px each way reached 2 px into the neighbouring
// input and a tap on its edge toggled the switch. The height takes the rest (16.8 + 32 = 48.8 px).

const config = readFileSync(resolve(__dirname, '../../app.config.ts'), 'utf8')
const base = config.match(/switch:\s*{\s*slots:\s*{[\s\S]*?base:\s*'([^']*)'/)?.[1] ?? ''

describe('switch phone hit area', () => {
  it('stays inside the 12 px gap a field leaves', () => {
    expect(base).toContain('max-md:after:absolute')
    const side = base.match(/max-md:after:-inset-x-(\d+(?:\.\d+)?)/)?.[1]
    expect(Number(side) * 4).toBeLessThan(12)
  })

  it('still totals 44 px on both axes (track 32.8 x 16.8)', () => {
    const side = Number(base.match(/max-md:after:-inset-x-(\d+(?:\.\d+)?)/)?.[1]) * 4
    const vertical = Number(base.match(/max-md:after:-inset-y-(\d+(?:\.\d+)?)/)?.[1]) * 4
    expect(32.8 + 2 * side).toBeGreaterThanOrEqual(44)
    expect(16.8 + 2 * vertical).toBeGreaterThanOrEqual(44)
  })

  it('has no symmetric -inset utility that would reach 14 px sideways', () => {
    expect(base).not.toMatch(/max-md:after:-inset-\d/)
  })
})
