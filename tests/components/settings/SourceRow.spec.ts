import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SourceRow from '~/components/settings/SourceRow.vue'
import type { ConnectedSourceRow } from '~/composables/useSourceList'

const row = (overrides: Partial<ConnectedSourceRow> = {}): ConnectedSourceRow => ({
  id: 'notion', name: 'Notion', icon: 'i-ph-notebook', isDefault: false, statusText: 'Synchronisiert vor 5 Min.',
  statusTone: 'muted', canSetDefault: true, canRepair: false, canConfigure: true, ...overrides,
})

// The menu stub renders its trigger and one button per item, so a test reads and picks the items without the portal
const stubs = {
  UButton: { inheritAttrs: false, template: '<button v-bind="$attrs"><slot /></button>' },
  UBadge: { template: '<span data-testid="badge"><slot /></span>' },
  UIcon: true,
  UDropdownMenu: {
    props: ['items'],
    template: '<div><slot /><button v-for="item in items.flat()" :key="item.label" data-menu-item @click="item.onSelect()">{{ item.label }}</button></div>',
  },
}
const render = (r: ConnectedSourceRow) => mount(SourceRow, { props: { row: r }, global: { stubs } })
const items = (w: ReturnType<typeof render>) => w.findAll('[data-menu-item]')
const pick = (w: ReturnType<typeof render>, label: string) => items(w).find((i) => i.text() === label)!.trigger('click')

describe('SourceRow (#324, menu since #333)', () => {
  it('the default row shows the badge as text and no "Als Standard festlegen"', () => {
    const w = render(row({ isDefault: true, canSetDefault: false }))
    expect(w.text()).toContain('Standard')
    expect(items(w).map((i) => i.text())).toEqual(['Notion-Einstellungen', 'Trennen'])
  })

  it('another row offers "Als Standard festlegen" in a menu whose button carries the source, and emits its id', async () => {
    const w = render(row())
    expect(w.get('[data-testid="source-actions-notion"]').attributes('aria-label')).toBe('Aktionen für Notion')
    expect(items(w).map((i) => i.text())).toEqual(['Als Standard festlegen', 'Notion-Einstellungen', 'Trennen'])
    await pick(w, 'Als Standard festlegen')
    expect(w.emitted('setDefault')).toEqual([['notion']])
  })

  it('the repair is a visible button only when the row allows it and the status takes the warning tone without an error colour', async () => {
    expect(render(row()).find('[data-testid="source-repair-notion"]').exists()).toBe(false)
    const w = render(row({ canRepair: true, statusText: 'Verbindung prüfen', statusTone: 'warning' }))
    expect(w.get('[data-testid="source-status-notion"]').classes()).toContain('text-warning-700')
    expect(w.get('[data-testid="source-status-notion"]').classes().join(' ')).not.toContain('error')
    expect(w.get('[data-testid="source-repair-notion"]').attributes('aria-label')).toBe('Notion-Verbindung reparieren')
    await w.get('[data-testid="source-repair-notion"]').trigger('click')
    expect(w.emitted('repair')).toEqual([['notion']])
  })

  it('a two-word source is coupled with hyphens in the German menu item and repair label (#685)', () => {
    const w = render(row({ id: 'reminders', name: 'Apple Erinnerungen', canRepair: true }))
    expect(items(w).map((i) => i.text())).toContain('Apple-Erinnerungen-Einstellungen')
    expect(w.get('[data-testid="source-repair-reminders"]').attributes('aria-label')).toBe('Apple-Erinnerungen-Verbindung reparieren')
  })

  it('settings and disconnect emit with the id', async () => {
    const w = render(row())
    await pick(w, 'Notion-Einstellungen')
    await pick(w, 'Trennen')
    expect(w.emitted('openSettings')).toEqual([['notion']])
    expect(w.emitted('disconnect')).toEqual([['notion']])
  })

  it('Local offers nothing but "Als Standard festlegen" (and no menu button at all when it is the only source)', () => {
    const local = row({ id: 'local', name: 'Lokal', canConfigure: false, statusText: 'Auf diesem Gerät gespeichert' })
    const w = render(local)
    expect(items(w).map((i) => i.text())).toEqual(['Als Standard festlegen'])
    const only = render({ ...local, isDefault: true, canSetDefault: false })
    expect(only.findAll('button')).toHaveLength(0)
    expect(only.text()).toContain('Standard')
  })
})
