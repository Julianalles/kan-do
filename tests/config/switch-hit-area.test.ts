import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// #592 (review): the switch's phone hit area is an invisible `::after` around the track. A switch sits beside a field with a
// `gap-3` (12 px) between them (Notion custom-properties step), so the pseudo-element may reach 6 px to the sides and never
// the 12 px of the gap: 14 px each way reached 2 px into the neighbouring input and a tap on its edge toggled the switch.
// #822: the pseudo-element is placed from the track's padding box, inside its 2 px border, so an inset of n px reaches n - 2 px
// past the drawn track. `-inset-x-1.5` reached 4 px and left the small track (32 px, the sheet's ad-hoc switch) at 40 px.

const config = readFileSync(resolve(__dirname, '../../app.config.ts'), 'utf8')
const base = config.match(/switch:\s*{\s*slots:\s*{[\s\S]*?base:\s*'([^']*)'/)?.[1] ?? ''
/** The track's border (Nuxt UI `border-2`): the inset starts inside it */
const BORDER = 2
/** The smallest track in use, `size="sm"` (`w-8`, `h-4` plus the border): 32 x 18 px */
const SMALL = { width: 32, height: 18 }

const reach = (axis: 'x' | 'y') => Number(base.match(new RegExp(`max-md:after:-inset-${axis}-(\\d+(?:\\.\\d+)?)`))?.[1]) * 4 - BORDER

describe('switch phone hit area', () => {
  it('stays inside the 12 px gap a field leaves', () => {
    expect(base).toContain('max-md:after:absolute')
    expect(reach('x')).toBeLessThan(12)
  })

  it('totals 44 px on both axes for the small track too', () => {
    expect(SMALL.width + 2 * reach('x')).toBeGreaterThanOrEqual(44)
    expect(SMALL.height + 2 * reach('y')).toBeGreaterThanOrEqual(44)
  })

  it('has no symmetric -inset utility that would reach 14 px sideways', () => {
    expect(base).not.toMatch(/max-md:after:-inset-\d/)
  })
})
