import { describe, expect, it } from 'vitest'
import { cssTimeMs } from '~/lib/cssTime'

describe('cssTimeMs', () => {
  it('reads milliseconds', () => {
    expect(cssTimeMs('1400ms')).toBe(1400)
    expect(cssTimeMs(' 700ms ')).toBe(700)
  })

  // the production build minifies `700ms` / `1400ms` to `.7s` / `1.4s`; a bare parseFloat read 0.7 and 1.4 (#490)
  it('reads seconds, as the minified production CSS writes them', () => {
    expect(cssTimeMs('1.4s')).toBe(1400)
    expect(cssTimeMs('.7s')).toBe(700)
  })

  it('is 0 for a missing or unreadable value', () => {
    expect(cssTimeMs('')).toBe(0)
    expect(cssTimeMs('auto')).toBe(0)
  })
})
