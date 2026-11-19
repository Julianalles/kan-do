import { vi } from 'vitest'
import { CREATE_LANDING_WAIT_MS } from '~/lib/createLookup'

/**
 * Moves `Date.now()` past the time a create with an unknown outcome can still land (#528), so the next push may
 * create. A `vi.spyOn`: `vi.restoreAllMocks()` puts the clock back. `by` adds to the wait (default: just over it).
 */
export const afterTheLandingWait = (by = 1000): void => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + CREATE_LANDING_WAIT_MS + by)
}
