import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive, ref } from 'vue'

import { markPlanningFromRecap, clearPlanningFromRecap } from '~/composables/usePlanningFromRecap'
import { placeOfPath, thirdItemOfPath, useAppNav } from '~/composables/useAppNav'

const route = reactive<{ path: string; meta: Record<string, unknown> }>({ path: '/tasks', meta: {} })
// The bar reads the live router route (#507); Nuxt's lagging `useRoute()` is a trap and throws here
// The recap's open flag is the one input taken from it (#428)
const recapFlag = vi.hoisted(() => ({ ref: null as unknown as { value: boolean } }))
vi.mock('~/composables/useNewDayRecap', async () => {
  const { ref: vueRef } = await import('vue')
  recapFlag.ref = vueRef(false)
  return { recapOpen: recapFlag.ref }
})
vi.mock('nuxt/app', () => ({
  useRouter: () => ({ currentRoute: ref(route) }),
  useRoute: () => { throw new Error('useAppNav must read router.currentRoute, not the lagging useRoute()') },
  navigateTo: vi.fn(),
}))

describe('placeOfPath: route -> place', () => {
  it.each([
    ['/all', 'all'], // the planning side of the board page (#354)
    ['/all/x', 'all'],
    ['/all/add', 'all'],
    ['/allx', null],
    ['/tasks', 'board'],
    ['/tasks/add', 'board'],
    ['/tasks/x', 'board'],
    ['/statistics', 'statistics'],
    ['/statistics/test-task-1', 'statistics'], // a task opened from the statistics page (kd#179)
    ['/trash', 'more'],
    ['/settings', 'more'],
    ['/settings/topics', 'more'],
    ['/settings/updates', 'more'],
    ['/welcome', null],
    ['/', null],
    ['/tasksfoo', null],
    ['/settingsx', null],
    ['/unknown', null],
  ])('%s -> %s', (path, expected) => {
    expect(placeOfPath(path)).toBe(expected)
  })
})

describe('thirdItemOfPath: route -> third segment of the pill (#583)', () => {
  it.each([
    ['/trash', '/trash', 'nav.trash'],
    ['/settings', '/settings', 'nav.settings'],
    ['/settings/topics', '/settings?tab=manage', 'nav.settings'],
    ['/settings/updates', '/settings?tab=manage', 'nav.settings'],
    ['/settings/notion', '/settings?tab=sources', 'nav.settings'],
  ])('%s -> link %s, label %s', (path, to, labelKey) => {
    expect(thirdItemOfPath(path)).toEqual({ to, labelKey })
  })

  it.each(['/tasks', '/tasks/add', '/statistics', '/welcome', '/', '/settingsx', '/trashed', '/unknown'])('%s -> none', (path) => {
    expect(thirdItemOfPath(path)).toBeNull()
  })
})

describe('useAppNav', () => {
  beforeEach(() => {
    route.path = '/tasks'
    route.meta = {}
    recapFlag.ref.value = false
    clearPlanningFromRecap()
  })

  it('selectedPlace is "recap" on the board page while the recap is open, the route\'s place elsewhere (#428)', () => {
    const nav = useAppNav()
    expect(nav.selectedPlace.value).toBe('board')
    recapFlag.ref.value = true
    expect(nav.recapShown.value).toBe(true)
    expect(nav.selectedPlace.value).toBe('recap')
    route.path = '/all'
    expect(nav.selectedPlace.value).toBe('recap')
    route.path = '/statistics'
    expect(nav.selectedPlace.value).toBe('statistics')
    route.path = '/trash'
    expect(nav.selectedPlace.value).toBe('more')
  })

  it('no recap on a route without bar (#428)', () => {
    recapFlag.ref.value = true
    route.meta = { appNav: false }
    const nav = useAppNav()
    expect(nav.recapShown.value).toBe(false)
    expect(nav.selectedPlace.value).toBeNull()
  })

  it('continuesToBoard needs Alle, the notice mark and a closed recap (#428)', () => {
    const nav = useAppNav()
    route.path = '/all'
    markPlanningFromRecap()
    expect(nav.continuesToBoard.value).toBe(true)
    recapFlag.ref.value = true
    expect(nav.continuesToBoard.value).toBe(false)
    recapFlag.ref.value = false
    route.path = '/tasks'
    expect(nav.continuesToBoard.value).toBe(false)
  })

  it('selects the place of the route and flags the board', () => {
    const nav = useAppNav()
    expect(nav.showsBar.value).toBe(true)
    expect(nav.currentPlace.value).toBe('board')
    expect(nav.onBoard.value).toBe(true)

    route.path = '/statistics'
    expect(nav.currentPlace.value).toBe('statistics')
    expect(nav.onBoard.value).toBe(false)

    route.path = '/settings/topics'
    expect(nav.currentPlace.value).toBe('more')
  })

  it('has no bar and no place on a route with appNav: false, whatever its path', () => {
    route.path = '/tasks'
    route.meta = { appNav: false }
    const nav = useAppNav()
    expect(nav.showsBar.value).toBe(false)
    expect(nav.currentPlace.value).toBeNull()
  })

  it('has a bar but no place on an unknown route', () => {
    route.path = '/somewhere'
    const nav = useAppNav()
    expect(nav.showsBar.value).toBe(true)
    expect(nav.currentPlace.value).toBeNull()
  })

  it('follows a Heute -> Statistik -> Heute -> Papierkorb sequence', () => {
    const nav = useAppNav()
    const seen: Array<string | null> = []
    for (const path of ['/tasks', '/statistics', '/tasks', '/trash', '/settings', '/settings/topics', '/tasks']) {
      route.path = path
      seen.push(nav.currentPlace.value)
    }
    expect(seen).toEqual(['board', 'statistics', 'board', 'more', 'more', 'more', 'board'])
  })

  it('shows a third segment only on a page behind ⋯, and none without a bar', () => {
    const nav = useAppNav()
    const seen: Array<string | undefined> = []
    for (const path of ['/tasks', '/settings', '/trash', '/statistics', '/settings/updates']) {
      route.path = path
      seen.push(nav.thirdItem.value?.labelKey)
    }
    expect(seen).toEqual([undefined, 'nav.settings', 'nav.trash', undefined, 'nav.settings'])

    route.path = '/settings'
    route.meta = { appNav: false }
    expect(nav.thirdItem.value).toBeNull()
  })
})
