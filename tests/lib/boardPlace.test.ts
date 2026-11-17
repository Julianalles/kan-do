/**
 * #354: the two places of the board page. `/all` is an alias of `/tasks`, so a link between them must be forced, and
 * a sheet or the add flow opens under the place that shows.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { armGlide, armLift, resetPlacePace, takePlacePace, boardBaseOfPath, boardPlaceLocation, boardPlaceOfPath, openColumnTitleKey, readPlaceMove, setCurrentBoardPath } from '~/lib/boardPlace'
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

  it('the Offen column is headed "Heute" on "Alle" and "Offen" on "Heute" (#375); by default for the place that shows', () => {
    expect(openColumnTitleKey('all')).toBe('board.columns.openPlanning')
    expect(openColumnTitleKey('today')).toBe('board.columns.open')
    expect(openColumnTitleKey()).toBe('board.columns.open')
    setCurrentBoardPath('/all/add')
    expect(openColumnTitleKey()).toBe('board.columns.openPlanning')
    setCurrentBoardPath('/statistics')
    expect(openColumnTitleKey()).toBe('board.columns.open')
  })

  it('reads the place move from the element: ms or s, 0 without a value (reduced motion sets 0ms)', () => {
    const el = document.createElement('div')
    document.body.append(el)
    expect(readPlaceMove(null)).toEqual({ ms: 0, easing: 'ease' })
    expect(readPlaceMove(el)).toEqual({ ms: 0, easing: 'ease' })
    el.style.setProperty('--place-move', '420ms')
    el.style.setProperty('--place-ease', 'cubic-bezier(0.2, 0.7, 0.2, 1)')
    expect(readPlaceMove(el)).toEqual({ ms: 420, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' })
    el.style.setProperty('--place-move', '0.3s')
    expect(readPlaceMove(el).ms).toBe(300)
    el.style.setProperty('--place-move', '0ms')
    expect(readPlaceMove(el).ms).toBe(0)
    el.remove()
  })
})

describe('the pace of a place move (#433)', () => {
  afterEach(() => resetPlacePace())

  it('the first move to Heute after a fresh start glides, once', () => {
    armGlide('2026-11-17')
    expect(takePlacePace('all', '2026-11-17')).toBeNull()
    expect(takePlacePace('today', '2026-11-17')).toBe('glide')
    expect(takePlacePace('today', '2026-11-17')).toBeNull()
  })

  it('nothing armed (planning skipped, or a reload) stays at the standard pace', () => {
    expect(takePlacePace('today', '2026-11-17')).toBeNull()
  })

  it('an arm from another day is ignored and dropped', () => {
    armGlide('2026-11-16')
    expect(takePlacePace('today', '2026-11-17')).toBeNull()
    expect(takePlacePace('today', '2026-11-16')).toBeNull()
  })

  it('the recap lifts the move to Alle once, and a move to Heute is not a lift', () => {
    armLift()
    expect(takePlacePace('today', '2026-11-17')).toBeNull()
    armLift()
    expect(takePlacePace('all', '2026-11-17')).toBe('lift')
    expect(takePlacePace('all', '2026-11-17')).toBeNull()
  })

  it('the glide survives the lift to Alle that comes first', () => {
    armGlide('2026-11-17')
    armLift()
    expect(takePlacePace('all', '2026-11-17')).toBe('lift')
    expect(takePlacePace('today', '2026-11-17')).toBe('glide')
  })

  it('reduced motion sets no pace', () => {
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce') })) as typeof window.matchMedia
    try {
      armGlide('2026-11-17')
      armLift()
      expect(takePlacePace('all', '2026-11-17')).toBeNull()
      expect(takePlacePace('today', '2026-11-17')).toBeNull()
    }
    finally {
      window.matchMedia = original
    }
  })
})
