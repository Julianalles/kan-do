import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTaskReturning, markTaskReturning, resetDeleteGapState, returningRoom, UNDO_RETURN_MS } from '~/lib/deleteGapState'

describe('markTaskReturning (#595)', () => {
  afterEach(() => { resetDeleteGapState(); vi.useRealTimers() })

  it('keeps the measured room and drops it after the return window', () => {
    vi.useFakeTimers()
    markTaskReturning('a', 83.6)
    expect(isTaskReturning('a')).toBe(true)
    expect(returningRoom('a')).toBe(84)
    vi.advanceTimersByTime(UNDO_RETURN_MS)
    expect(isTaskReturning('a')).toBe(false)
    expect(returningRoom('a')).toBe(0)
  })

  it('has no room without a gap or when the gap is taller than the slot', () => {
    markTaskReturning('b')
    markTaskReturning('c', -12)
    expect(isTaskReturning('b')).toBe(true)
    expect(returningRoom('b')).toBe(0)
    expect(returningRoom('c')).toBe(0)
  })
})
