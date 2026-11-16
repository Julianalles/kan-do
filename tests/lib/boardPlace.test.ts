/**
 * #354: the two places of the board page. `/all` is an alias of `/tasks`, so a link between them must be forced, and
 * a sheet or the add flow opens under the place that shows.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { boardBaseOfPath, boardPlaceLocation, boardPlaceOfPath, setCurrentBoardPath } from '~/lib/boardPlace'
import { boardBasePath, todayLocation, useBoardPlace } from '~/composables/useBoardPlace'

describe('board places (#354)', () => {
  afterEach(() => setCurrentBoardPath('/tasks'))

  it.each([
    ['/all', 'all'],
    ['/all/task-1', 'all'],
    ['/all/add', 'all'],
    ['/tasks', 'today'],
    ['/tasks/task-1', 'today'],
    ['/allx', null],
    ['/statistics', null],
    ['/', null],
  ])('%s is the place %s', (path, place) => {
    expect(boardPlaceOfPath(path)).toBe(place)
  })

  it('a sheet opens under the place that shows, and under /tasks from anywhere else', () => {
    expect(boardBaseOfPath('/all')).toBe('/all')
    expect(boardBaseOfPath('/all/task-1')).toBe('/all')
    expect(boardBaseOfPath('/tasks')).toBe('/tasks')
    expect(boardBaseOfPath('/statistics')).toBe('/tasks')
  })

  it('a link between the places is forced: vue-router calls alias -> original redundant otherwise', () => {
    expect(boardPlaceLocation('all')).toEqual({ path: '/all', force: true })
    expect(boardPlaceLocation('today')).toEqual({ path: '/tasks', force: true })
  })

  it('follows the path the router plugin mirrors; without it the place is Heute', () => {
    const { place, isAll, basePath } = useBoardPlace()
    expect([place.value, isAll.value, basePath.value, boardBasePath()]).toEqual(['today', false, '/tasks', '/tasks'])
    setCurrentBoardPath('/all/task-1')
    expect([place.value, isAll.value, basePath.value, boardBasePath()]).toEqual(['all', true, '/all', '/all'])
    setCurrentBoardPath('/settings')
    expect([place.value, basePath.value]).toEqual(['today', '/tasks'])
  })

  it('"go to Heute" is forced only while "Alle" shows', () => {
    expect(todayLocation()).toBe('/tasks')
    setCurrentBoardPath('/statistics')
    expect(todayLocation()).toBe('/tasks')
    setCurrentBoardPath('/all')
    expect(todayLocation()).toEqual({ path: '/tasks', force: true })
  })
})
