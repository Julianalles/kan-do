import { describe, expect, it } from 'vitest'
import { hiddenChipCount } from '~/utils/chipOverflow'

describe('hiddenChipCount (#705)', () => {
  it('counts none when every chip sits in the first two lines', () => {
    expect(hiddenChipCount([0, 0, 0, 28, 28], 56)).toBe(0)
    expect(hiddenChipCount([], 56)).toBe(0)
  })

  it('counts the chips that wrapped to a third line or further', () => {
    expect(hiddenChipCount([0, 0, 28, 56, 56, 84], 56)).toBe(3)
  })

  it('a chip that starts inside the two lines is shown even when it reaches past them', () => {
    expect(hiddenChipCount([0, 28, 55], 56)).toBe(0)
  })
})
