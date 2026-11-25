import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskSheetMenu from '~/components/task/TaskSheetMenu.vue'
import type { MoveTarget } from '~/composables/useTaskMoveTargets'

const UButton = { inheritAttrs: false, template: '<button v-bind="$attrs"><slot /></button>' }
const UDropdownMenu = { props: ['items'], template: '<div data-testid="menu"><slot /></div>' }

const target: MoveTarget = { source: 'notion', name: 'Notion', menuName: 'Notion', targetPhrase: 'zu Notion', icon: 'i-ph-notion', hint: '', disabled: false }

type Item = { label: string; color?: string; disabled?: boolean; description?: string; children?: Item[]; onSelect?: () => void }

const render = (props: { openLabel?: string | null; moveTargets?: MoveTarget[]; deleteLabel?: string | null }) =>
  mount(TaskSheetMenu, {
    props: { moveTargets: [], deleteLabel: 'Löschen', ...props },
    global: { stubs: { UButton, UDropdownMenu } },
  })

const groupsOf = (wrapper: ReturnType<typeof render>) => wrapper.getComponent(UDropdownMenu).props('items') as Item[][]

describe('TaskSheetMenu (#705)', () => {
  it('Local board: Delete alone, in the error tone, which only emits', () => {
    const wrapper = render({})
    const groups = groupsOf(wrapper)
    expect(groups.map(group => group.map(item => item.label))).toEqual([['Löschen']])
    expect(groups[0]![0]!.color).toBe('error')
    groups[0]![0]!.onSelect!()
    expect(wrapper.emitted('delete')).toHaveLength(1)
  })

  it('Notion board: open in source and move to source, then Delete in its own group', () => {
    const wrapper = render({ openLabel: 'In Notion öffnen', moveTargets: [target], deleteLabel: 'Löschen, auch in Notion' })
    const groups = groupsOf(wrapper)
    expect(groups.map(group => group.map(item => item.label))).toEqual([['In Notion öffnen', 'Verschieben zu …'], ['Löschen, auch in Notion']])
    groups[0]![0]!.onSelect!()
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('the move sub-menu lists the targets and emits the chosen source; disabled targets stay disabled with their hint', () => {
    const wrapper = render({ moveTargets: [target, { ...target, source: 'local', name: 'Lokal', menuName: 'lokalem Speicher', targetPhrase: 'zum lokalen Speicher', hint: 'Wartet', disabled: true }] })
    const children = groupsOf(wrapper)[0]![0]!.children!
    expect(children.map(item => item.label)).toEqual(['Notion', 'lokalem Speicher'])
    expect(children[1]!.disabled).toBe(true)
    expect(children[1]!.description).toBe('Wartet')
    children[0]!.onSelect!()
    expect(wrapper.emitted('move')).toEqual([['notion']])
  })

  it('a task that cannot be deleted shows no Delete; with nothing left there is no button at all', () => {
    expect(groupsOf(render({ openLabel: 'In Reminders öffnen', deleteLabel: null }))).toEqual([[expect.objectContaining({ label: 'In Reminders öffnen' })]])
    const empty = render({ deleteLabel: null })
    expect(empty.find('button').exists()).toBe(false)
    expect(empty.find('[data-testid="menu"]').exists()).toBe(false)
  })

  it('the trigger is named for screen readers', () => {
    expect(render({}).get('[data-testid="task-menu"]').attributes('aria-label')).toBe('Aufgabenmenü')
  })
})
