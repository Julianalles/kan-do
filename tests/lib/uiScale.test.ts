import { describe, expect, it } from 'vitest'
import { DEFAULT_UI_SCALE, UI_SCALE_STEPS, isUiScale, sanitizeUiScale, stepUiScale, type UiScale } from '~/lib/uiScale'

// #845: the size of the interface moves in fixed steps and never leaves them.

describe('uiScale steps', () => {
  it('are ascending, hold the default and end at 125 %', () => {
    expect([...UI_SCALE_STEPS]).toEqual([80, 90, 100, 110, 125])
    expect(DEFAULT_UI_SCALE).toBe(100)
  })

  it.each([['a step', 110, 110], ['no step', 150, 100], ['zero', 0, 100], ['a string', '110', 100], ['null', null, 100], ['undefined', undefined, 100], ['NaN', Number.NaN, 100], ['an object', {}, 100]])(
    'sanitize reads %s as %s -> %i',
    (_name, value, expected) => {
      expect(sanitizeUiScale(value)).toBe(expected)
      expect(isUiScale(value)).toBe(value === expected)
    },
  )

  it('steps up and down one step at a time and stays at the ends', () => {
    expect(stepUiScale(100, 'in')).toBe(110)
    expect(stepUiScale(110, 'in')).toBe(125)
    expect(stepUiScale(125, 'in')).toBe(125)
    expect(stepUiScale(100, 'out')).toBe(90)
    expect(stepUiScale(90, 'out')).toBe(80)
    expect(stepUiScale(80, 'out')).toBe(80)
  })

  it('walks the whole range and back (A -> B -> A)', () => {
    let scale: UiScale = UI_SCALE_STEPS[0]
    const seen: UiScale[] = [scale]
    for (let i = 0; i < UI_SCALE_STEPS.length; i++) seen.push(scale = stepUiScale(scale, 'in'))
    expect(seen).toEqual([80, 90, 100, 110, 125, 125])
    for (let i = 0; i < UI_SCALE_STEPS.length; i++) scale = stepUiScale(scale, 'out')
    expect(scale).toBe(80)
  })

  it('reset is 100 % from anywhere', () => {
    for (const step of UI_SCALE_STEPS) expect(stepUiScale(step, 'reset')).toBe(100)
  })
})
