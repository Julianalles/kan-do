import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { reactive, ref, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

import MorePanel from '~/components/nav/MorePanel.vue'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'

const route = reactive<{ path: string; meta: Record<string, unknown> }>({ path: '/tasks', meta: {} })
const isTauri = vi.fn(() => false)
const resync = vi.fn()
const isLoading = ref(false)
const trashCount = ref(0)
vi.mock('nuxt/app', () => ({ useRoute: () => route, useRouter: () => ({ currentRoute: ref(route) }), navigateTo: vi.fn() }))
vi.mock('~/utils/isTauri', () => ({ isTauri: () => isTauri() }))
vi.mock('~/composables/useManualSync', () => ({
  useManualSync: () => ({ resync, isLoading, lastSyncText: ref('Vor 2 Minuten aktualisiert') }),
}))
vi.mock('~/composables/useTrash', () => ({ useTrash: () => ({ count: trashCount }) }))

const stubs = {
  UButton: {
    props: ['icon', 'to', 'loading', 'disabled', 'color', 'variant'],
    inheritAttrs: false,
    template: '<component :is="to ? \'a\' : \'button\'" :data-icon="icon" :href="typeof to === \'string\' ? to : to?.path" :disabled="disabled || undefined" :data-variant="variant" v-bind="$attrs"><slot /></component>',
  },
  USwitch: { props: ['modelValue', 'label'], emits: ['update:modelValue'], template: '<button role="switch" :aria-checked="modelValue" v-bind="$attrs" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>' },
  UCollapsible: { props: ['open'], template: '<div><slot v-if="open" name="content" /></div>' },
  UFormField: { template: '<div><slot /></div>' },
  USeparator: true,
  UKbd: { props: ['value'], template: '<kbd>{{ value }}</kbd>' },
  UIcon: true,
}

const render = (open = true): VueWrapper => mount(MorePanel, { props: { open }, global: { stubs } })

describe('MorePanel: the Mehr panel (#470)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    useIntegrationHealthStore().recordSuccessfulSync('notion')
    route.path = '/tasks'
    route.meta = {}
    isTauri.mockReturnValue(false)
    isLoading.value = false
    trashCount.value = 0
    resync.mockClear()
  })

  it('on the board: Auf dieser Seite (stack, Tag abschließen), then Navigation, then the sync footer', () => {
    const w = render()
    const text = w.text()
    const order = ['Auf dieser Seite', 'Karten stapeln', 'Tag abschließen', 'Navigation', 'Papierkorb', 'Einstellungen', 'Jetzt synchronisieren']
    const positions = order.map(label => text.indexOf(label))
    expect(positions.every(p => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('has one heading level: one h2 per group, none for the command group, none inside a group, and arrows only on the places', () => {
    const w = render()
    expect(w.findAll('h2').map(h => h.text())).toEqual(['Auf dieser Seite', 'Navigation'])
    const sections = w.findAll('section')
    expect(sections).toHaveLength(2)
    for (const section of sections) expect(section.findAll('h2, h3')).toHaveLength(1)
    const places = sections[1]!
    for (const id of ['more-trash', 'more-settings']) {
      expect(places.find(`[data-testid="${id}"] [class*="i-ph-arrow-right"], [data-testid="${id}"] svg, [data-testid="${id}"] .iconify`).exists() || places.find(`[data-testid="${id}"]`).html().includes('arrow-right')).toBe(true)
    }
    expect(w.find('[data-testid="more-day-close"]').html()).not.toContain('arrow-right')
    expect(w.find('[data-testid="more-commands"]').html()).not.toContain('arrow-right')
  })

  it.each(['/statistics', '/trash', '/settings', '/settings/topics'])('on %s there is no Auf dieser Seite and no Tag abschließen, but the sync footer stays', (path) => {
    route.path = path
    const w = render()
    expect(w.find('[data-testid="more-stack"]').exists()).toBe(false)
    expect(w.find('[data-testid="more-day-close"]').exists()).toBe(false)
    expect(w.text()).not.toContain('Auf dieser Seite')
    expect(w.text()).toContain('Navigation')
    expect(w.find('[data-testid="more-sync"]').exists()).toBe(true)
  })

  it.each([
    ['/tasks', true, true],
    ['/statistics', true, true],
    ['/trash', false, true],
    ['/settings', true, false],
    ['/settings/topics', true, false],
  ])('on %s the page the pill shows is not listed (#583): Papierkorb %s, Einstellungen %s', (path, trash, settings) => {
    route.path = path
    const w = render()
    expect(w.find('[data-testid="more-trash"]').exists()).toBe(trash)
    expect(w.find('[data-testid="more-settings"]').exists()).toBe(settings)
  })

  it('on /settings/updates the pill shows Einstellungen, so App-Update stays in the panel (a different page)', () => {
    isTauri.mockReturnValue(true)
    route.path = '/settings/updates'
    const w = render()
    expect(w.find('[data-testid="more-settings"]').exists()).toBe(false)
    expect(w.find('[data-testid="more-update"]').exists()).toBe(true)
    expect(w.find('[data-testid="more-trash"]').exists()).toBe(true)
  })

  it('a row returns as soon as the page leaves the pill', async () => {
    route.path = '/settings'
    const w = render()
    expect(w.find('[data-testid="more-settings"]').exists()).toBe(false)
    route.path = '/statistics'
    await nextTick()
    expect(w.find('[data-testid="more-settings"]').exists()).toBe(true)
  })

  it('keeps its rows while it fades out after a route change (#595)', async () => {
    route.path = '/tasks'
    const w = render()
    expect(w.find('[data-testid="more-settings"]').exists()).toBe(true)
    await w.setProps({ open: false })
    route.path = '/settings'
    await nextTick()
    expect(w.find('[data-testid="more-settings"]').exists()).toBe(true)
    expect(w.find('[data-testid="more-stack"]').exists()).toBe(true)
  })

  it('keeps its rows when the route and `open` change in the same tick (#595)', async () => {
    route.path = '/tasks'
    const w = render()
    route.path = '/settings'
    await w.setProps({ open: false })
    await nextTick()
    expect(w.find('[data-testid="more-settings"]').exists()).toBe(true)
    expect(w.find('[data-testid="more-stack"]').exists()).toBe(true)
  })

  it.each(['/all', '/tasks', '/statistics', '/trash', '/settings'])('on %s the places are the pill\'s segments: no Heute and Statistik rows', (path) => {
    route.path = path
    const w = render()
    expect(w.find('[data-testid="more-today"]').exists()).toBe(false)
    expect(w.find('[data-testid="more-statistics"]').exists()).toBe(false)
  })

  it('does not offer Fokus: it lives only in Einstellungen', () => {
    expect(render().text()).not.toMatch(/Fokus/)
  })

  it('shows the trash count only when the trash holds something, the row always exists', async () => {
    const w = render()
    expect(w.find('[data-testid="more-trash"]').text()).toBe('Papierkorb')
    trashCount.value = 3
    await nextTick()
    expect(w.find('[data-testid="more-trash"]').text()).toBe('Papierkorb (3)')
    expect(w.find('[data-testid="more-trash"]').attributes('href')).toBe('/trash')
    expect(w.find('[data-testid="more-settings"]').attributes('href')).toBe('/settings')
  })

  it('App-Update exists only in the desktop app, never disabled', () => {
    expect(render().find('[data-testid="more-update"]').exists()).toBe(false)

    isTauri.mockReturnValue(true)
    const w = render()
    const row = w.find('[data-testid="more-update"]')
    expect(row.exists()).toBe(true)
    expect(row.attributes('href')).toBe('/settings/updates')
    expect(row.attributes('disabled')).toBeUndefined()
  })

  it('Karten stapeln picks the first group option when none is set and shows the chips', async () => {
    const board = useBoardStore()
    const w = render()
    expect(w.find('[role="group"]').exists()).toBe(false)

    await w.find('[data-testid="more-stack"]').trigger('click')

    expect(board.grouping.enabled).toBe(true)
    expect(board.grouping.key).toBe('topic')
    const group = w.find('[role="group"]')
    expect(group.attributes('aria-label')).toBe('Gruppieren nach')
    const chips = group.findAll('button')
    expect(chips.map(c => c.text())).toEqual(['Thema', 'Aktivität', 'Priorität'])
    expect(chips.map(c => c.attributes('aria-pressed'))).toEqual(['true', 'false', 'false'])

    await chips[1]!.trigger('click')
    expect(board.grouping.key).toBe('activity')
    expect(w.findAll('[role="group"] button').map(c => c.attributes('aria-pressed'))).toEqual(['false', 'true', 'false'])

    await chips[2]!.trigger('click')
    expect(board.grouping.key).toBe('priority')
    expect(w.findAll('[role="group"] button').map(c => c.attributes('aria-pressed'))).toEqual(['false', 'false', 'true'])

    await w.find('[data-testid="more-stack"]').trigger('click')
    expect(board.grouping.enabled).toBe(false)
    expect(w.find('[role="group"]').exists()).toBe(false)
  })

  it('Tag abschließen asks the host to close the panel first (emits dayClose)', async () => {
    const w = render()
    await w.find('[data-testid="more-day-close"]').trigger('click')
    expect(w.emitted('dayClose')).toHaveLength(1)
  })

  it('a navigation row emits close', async () => {
    const w = render()
    await w.find('[data-testid="more-settings"]').trigger('click')
    await w.find('[data-testid="more-trash"]').trigger('click')
    expect(w.emitted('close')).toHaveLength(2)
  })

  describe('sync footer', () => {
    it('is silent while every source is healthy: just the resync row and the last sync', () => {
      const w = render()
      expect(w.find('[data-testid^="sync-problem-"]').exists()).toBe(false)
      expect(w.find('[data-testid="more-sync"]').text()).toContain('Jetzt synchronisieren')
      expect(w.find('[data-testid="more-sync"]').text()).toContain('Vor 2 Minuten aktualisiert')
    })

    it('runs the manual sync and is disabled and busy while loading', async () => {
      const w = render()
      await w.find('[data-testid="more-sync"]').trigger('click')
      expect(resync).toHaveBeenCalledTimes(1)

      isLoading.value = true
      await nextTick()
      expect(w.find('[data-testid="more-sync"]').attributes('disabled')).toBeDefined()
      expect(w.find('[data-testid="more-sync"]').attributes('aria-busy')).toBe('true')
    })

    it('names the running sync in the button and a status region, and shows the last result again afterwards (#647)', async () => {
      const w = render()
      expect(w.find('[data-testid="more-sync"]').text()).toContain('Vor 2 Minuten aktualisiert')
      expect(w.find('[data-testid="more-sync-status"]').attributes('role')).toBe('status')
      expect(w.find('[data-testid="more-sync-status"]').text()).toBe('')

      isLoading.value = true
      await nextTick()
      expect(w.find('[data-testid="more-sync"]').text()).toContain('Wird synchronisiert…')
      expect(w.find('[data-testid="more-sync"]').text()).not.toContain('Vor 2 Minuten aktualisiert')
      expect(w.find('[data-testid="more-sync-status"]').text()).toBe('Wird synchronisiert…')

      isLoading.value = false
      await nextTick()
      expect(w.find('[data-testid="more-sync"]').text()).toContain('Vor 2 Minuten aktualisiert')
      expect(w.find('[data-testid="more-sync-status"]').text()).toBe('')
    })

    it('a broken source names the problem, its hint and offers the repair above the resync row', () => {
      useIntegrationHealthStore().markBroken('notion', 'Unauthorized')
      const w = render()
      const problem = w.find('[data-testid="sync-problem-notion"]')
      expect(problem.text()).toContain('Notion: Verbindung prüfen')
      expect(problem.text()).toContain('Der Zugriff wurde abgelehnt, oder das Token fehlt.')
      const repair = w.find('[data-testid="sync-repair-notion"]')
      expect(repair.text()).toBe('Notion-Verbindung reparieren')
      expect(repair.attributes('href')).toBe('/settings?tab=sources')
      const html = w.html()
      expect(html.indexOf('sync-repair-notion')).toBeLessThan(html.indexOf('more-sync"'))
    })

    it('an offline source outranked by a broken one: the worst problem wins; todoist has no repair entry', () => {
      useBoardStore().setSources({ connected: ['notion', 'todoist'], default: 'notion' })
      const health = useIntegrationHealthStore()
      health.markOffline('todoist', 'Network error')
      health.markBroken('notion', 'Unauthorized')
      expect(render().find('[data-testid="sync-problem-notion"]').exists()).toBe(true)

      health.recordSuccessfulSync('notion')
      const w = render()
      expect(w.find('[data-testid="sync-problem-todoist"]').text()).toContain('Todoist offline')
      expect(w.find('[data-testid="sync-repair-todoist"]').exists()).toBe(false)
    })

    it('shows nothing for a source that is not connected', () => {
      useIntegrationHealthStore().markBroken('todoist', 'old')
      expect(render().find('[data-testid^="sync-problem-"]').exists()).toBe(false)
    })
  })

  describe('keyboard (kd#23)', () => {
    const press = async (w: VueWrapper, key: string) => {
      await w.find('[data-testid="more-panel"]').trigger('keydown', { key })
    }
    const mountAttached = () => mount(MorePanel, { global: { stubs }, attachTo: document.body })
    const controls = (w: VueWrapper) => Array.from(w.element.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'))

    it('ArrowDown/ArrowUp move focus one control, clamped at both ends', async () => {
      const w = mountAttached()
      const all = controls(w)
      all[0]!.focus()
      await press(w, 'ArrowDown')
      expect(document.activeElement).toBe(all[1])
      await press(w, 'ArrowUp')
      await press(w, 'ArrowUp')
      expect(document.activeElement).toBe(all[0])
      all.at(-1)!.focus()
      await press(w, 'ArrowDown')
      expect(document.activeElement).toBe(all.at(-1))
      w.unmount()
    })

    it('Home and End jump to the first and last control; a disabled sync row is skipped', async () => {
      isLoading.value = true
      const w = mountAttached()
      const all = controls(w)
      expect(all.some(el => el.getAttribute('data-testid') === 'more-sync')).toBe(false)
      all[1]!.focus()
      await press(w, 'End')
      expect(document.activeElement).toBe(all.at(-1))
      await press(w, 'Home')
      expect(document.activeElement).toBe(all[0])
      w.unmount()
    })

    it('Befehle is the first row on every page (#224) and emits commands', async () => {
      const w = render()
      expect(w.find('[data-testid="more-commands"]').text()).toContain('Schnellaktionen')
      await w.find('[data-testid="more-commands"]').trigger('click')
      expect(w.emitted('commands')).toHaveLength(1)
      route.path = '/trash'
      const off = render()
      expect(off.find('[data-testid="more-commands"]').exists()).toBe(true)
      expect(off.find('[data-testid="more-day-close"]').exists()).toBe(false)
    })
  })
})
