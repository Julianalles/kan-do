import { describe, expect, it } from 'vitest'
import { ESTIMATE_GROUPS, INK_STEPS } from '~/lib/inkRamp'
import de from '~/i18n/locales/de.json'
import en from '~/i18n/locales/en.json'

describe('ESTIMATE_GROUPS (#604)', () => {
  it('lists longer, as planned, shorter, darkest ink first, each step on the ramp', () => {
    expect(ESTIMATE_GROUPS.map(g => g.key)).toEqual(['longer', 'onTarget', 'shorter'])
    const steps = ESTIMATE_GROUPS.map(g => g.step)
    expect([...steps].sort((a, b) => a - b)).toEqual(steps)
    for (const step of steps) expect(step).toBeLessThan(INK_STEPS.length)
  })

  it('keeps every step at 18 % ink or darker (3:1 on the sheet; 10 % is below it)', () => {
    for (const g of ESTIMATE_GROUPS) expect(INK_STEPS[g.step]).toBeGreaterThanOrEqual(18)
  })

  it('maps onto the day-close group keys and has a label in both locales', () => {
    expect(ESTIMATE_GROUPS.map(g => g.group)).toEqual(['over', 'within', 'under'])
    for (const g of ESTIMATE_GROUPS) {
      expect(de.statistics.estimate[g.key]).toBeTruthy()
      expect(en.statistics.estimate[g.key]).toBeTruthy()
    }
  })
})
