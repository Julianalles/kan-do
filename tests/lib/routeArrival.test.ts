import { beforeEach, describe, expect, it } from 'vitest'
import { arrivedFromAnotherPage, isSheetRoutePath, noteNavigation, resetRouteArrival } from '~/lib/routeArrival'

// kd#133: a cold load is not an arrival; leaving any real page is, and stays one
describe('routeArrival', () => {
  beforeEach(resetRouteArrival)

  it('a cold load is no arrival: the start location, the redirect page / and a navigation on the same path do not count', () => {
    expect(arrivedFromAnotherPage()).toBe(false)
    noteNavigation(null, '/tasks')
    noteNavigation('/', '/tasks')
    noteNavigation('/tasks', '/tasks')
    expect(arrivedFromAnotherPage()).toBe(false)
  })

  it('leaving a real page for another counts, and keeps counting for later navigations', () => {
    noteNavigation(null, '/tasks')
    noteNavigation('/tasks', '/statistics')
    expect(arrivedFromAnotherPage()).toBe(true)
    noteNavigation('/statistics', '/statistics')
    expect(arrivedFromAnotherPage()).toBe(true)
  })

  // #594: only a link that opens a sheet on load opens it at rest
  it('names the sheet routes: a task, the add route, under tasks, all and statistics', () => {
    expect(isSheetRoutePath('/tasks/seed-open-1')).toBe(true)
    expect(isSheetRoutePath('/tasks/add')).toBe(true)
    expect(isSheetRoutePath('/all/add')).toBe(true)
    expect(isSheetRoutePath('/statistics/abc')).toBe(true)
    expect(isSheetRoutePath('/tasks')).toBe(false)
    expect(isSheetRoutePath('/settings/notion')).toBe(false)
  })
})
