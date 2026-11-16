/**
 * #356 (D3 o): when the user counts as away from the app window, and whether a return follows a real absence. A glance
 * at another window stays below the grace; a focus and a visibility event of one return answer the same.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AWAY_GRACE_MS, isAway, resetPresence, returnedAfterAbsence, startPresence, takeAppStart } from '~/lib/appPresence'

const blur = () => window.dispatchEvent(new Event('blur'))
const focus = () => window.dispatchEvent(new Event('focus'))
const visibility = (state: 'hidden' | 'visible') => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('appPresence (#356)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 22, 0, 0))
    resetPresence()
    startPresence()
  })
  afterEach(() => {
    resetPresence()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('is present until the window is left, and away only once the grace has passed', () => {
    expect(isAway()).toBe(false)
    blur()
    expect(isAway()).toBe(false)
    vi.advanceTimersByTime(AWAY_GRACE_MS - 1)
    expect(isAway()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(isAway()).toBe(true)
  })

  it('a hidden tab is leaving too, and the return ends it', () => {
    visibility('hidden')
    vi.advanceTimersByTime(AWAY_GRACE_MS)
    expect(isAway()).toBe(true)
    visibility('visible')
    expect(isAway()).toBe(false)
  })

  it('focus ends the absence by itself, with no board page listening', () => {
    blur()
    vi.advanceTimersByTime(5 * AWAY_GRACE_MS)
    focus()
    expect(isAway()).toBe(false)
  })

  it('a return after a real absence counts; the second event of the same return answers the same', () => {
    blur()
    vi.advanceTimersByTime(20 * 60 * 1000)
    focus()
    expect(returnedAfterAbsence()).toBe(true)
    visibility('visible')
    expect(returnedAfterAbsence()).toBe(true)
  })

  it('a return after a glance below the grace does not count, on both events of it', () => {
    blur()
    vi.advanceTimersByTime(AWAY_GRACE_MS - 1)
    focus()
    expect(returnedAfterAbsence()).toBe(false)
    visibility('visible')
    expect(returnedAfterAbsence()).toBe(false)
  })

  it('the handler may run before the module\'s own listener: the absence is still read', () => {
    blur()
    vi.advanceTimersByTime(AWAY_GRACE_MS)
    expect(returnedAfterAbsence()).toBe(true)
    blur()
    vi.advanceTimersByTime(1000)
    focus()
    expect(returnedAfterAbsence()).toBe(false)
  })

  it('a return whose leaving was never seen (the page loaded in the background, a synthetic event) counts', () => {
    expect(returnedAfterAbsence()).toBe(true)
    vi.advanceTimersByTime(10_000)
    expect(returnedAfterAbsence()).toBe(true)
  })

  it('the first board of a page load is the app start, later mounts are not', () => {
    expect(takeAppStart()).toBe(true)
    expect(takeAppStart()).toBe(false)
    resetPresence()
    expect(takeAppStart()).toBe(true)
  })
})
