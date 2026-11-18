import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import TaskSheet from '~/components/task/TaskSheet.vue'

/**
 * Mirrors vaul-vue's DrawerRoot: it watches `open` with `immediate: true` and emits
 * `update:open` with the current value on mount, also while the drawer is closed.
 */
const UDrawer = defineComponent({
  props: { open: Boolean },
  emits: ['update:open', 'after:enter', 'after:leave'],
  watch: {
    open: { handler(this: { $emit: (e: 'update:open', v: boolean) => void }, value: boolean) { this.$emit('update:open', value) }, immediate: true },
  },
  render() { return h('div', { 'data-testid': 'drawer' }) },
})

const mountSheet = async (open: boolean) => {
  const wrapper = mount(TaskSheet, {
    props: { open, title: 'Task' },
    global: { stubs: { UDrawer, USlideover: true } },
  })
  // The drawer replaces the slideover once onMounted has read the media query
  await flushPromises()
  expect(wrapper.findComponent(UDrawer).exists()).toBe(true)
  return wrapper
}

describe('TaskSheet', () => {
  beforeEach(() => {
    // Below the 768px breakpoint: the sheet renders the bottom drawer
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  })

  it('does not report a close when the closed drawer echoes its state on mount', async () => {
    const wrapper = await mountSheet(false)
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('does not report an open the host already knows about', async () => {
    const wrapper = await mountSheet(true)
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('forwards a real close request from the open drawer', async () => {
    const wrapper = await mountSheet(true)
    wrapper.findComponent(UDrawer).vm.$emit('update:open', false)
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('swallows an outside press right after opening (the second click of a double-click), not a later one (kd#25)', async () => {
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(1000)
    const wrapper = await mountSheet(false)
    await wrapper.setProps({ open: true, hideTitle: true })
    const content = wrapper.findComponent(UDrawer).vm.$attrs.content as { onPointerDownOutside: (e: Event) => void }
    const early = new Event('pointerdown', { cancelable: true })
    now.mockReturnValue(1400)
    content.onPointerDownOutside(early)
    expect(early.defaultPrevented).toBe(true)
    const late = new Event('pointerdown', { cancelable: true })
    now.mockReturnValue(1000 + 5000)
    content.onPointerDownOutside(late)
    expect(late.defaultPrevented).toBe(false)
    // The add route is not opened by a card click: its overlay click is never swallowed
    await wrapper.setProps({ hideTitle: false })
    now.mockReturnValue(1100)
    const add = new Event('pointerdown', { cancelable: true })
    content.onPointerDownOutside(add)
    expect(add.defaultPrevented).toBe(false)
    now.mockRestore()
  })

  it('gives the drawer footer the sheet-footer hook class', async () => {
    const wrapper = await mountSheet(true)
    const ui = wrapper.findComponent(UDrawer).vm.$attrs.ui as { footer?: string }
    expect(ui.footer).toContain('sheet-footer')
  })

  it('gives the slideover footer the sheet-footer hook class', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const USlideover = defineComponent({
      props: { ui: { type: Object, default: () => ({}) } },
      render() { return h('div', { 'data-testid': 'slideover', 'data-footer': (this.ui as { footer?: string }).footer }) },
    })
    const wrapper = mount(TaskSheet, {
      props: { open: true, title: 'Task' },
      global: { stubs: { USlideover, UDrawer: true } },
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="slideover"]').attributes('data-footer')).toContain('sheet-footer')
  })

  describe('detail route on desktop (#468)', () => {
    const listeners: Array<(event: { matches: boolean }) => void> = []
    let desktop = true
    const Morph = defineComponent({
      props: { open: Boolean, originId: { type: String, default: null } },
      render() { return h('div', { 'data-testid': 'morph', 'data-origin': this.originId ?? '' }) },
    })

    const mountDetail = async (open: boolean) => {
      const wrapper = mount(TaskSheet, {
        props: { open, title: 'Task', hideTitle: true, flushBody: true, originId: 'task-1' },
        global: { stubs: { TaskMorphShell: Morph, UDrawer, USlideover: true } },
      })
      await flushPromises()
      return wrapper
    }

    beforeEach(() => {
      listeners.length = 0
      desktop = true
      vi.stubGlobal('matchMedia', (query: string) => ({
        get matches() { return desktop },
        media: query,
        addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.push(listener),
        removeEventListener: vi.fn(),
      }))
    })

    const resize = (matches: boolean) => {
      desktop = matches
      listeners.forEach((listener) => listener({ matches }))
    }

    it('renders the morph shell with the task as its origin, not a slideover or a drawer', async () => {
      const wrapper = await mountDetail(true)
      expect(wrapper.find('[data-testid="morph"]').attributes('data-origin')).toBe('task-1')
      expect(wrapper.findComponent(UDrawer).exists()).toBe(false)
    })

    it('keeps the add route on the slideover', async () => {
      const wrapper = mount(TaskSheet, {
        props: { open: true, title: 'Task', hideTitle: false },
        global: { stubs: { TaskMorphShell: Morph, UDrawer, USlideover: true } },
      })
      await flushPromises()
      expect(wrapper.find('[data-testid="morph"]').exists()).toBe(false)
    })

    it('keeps its shell when the window crosses 768 px while open, and follows the window on the next open', async () => {
      const wrapper = await mountDetail(true)
      resize(false)
      await flushPromises()
      expect(wrapper.find('[data-testid="morph"]').exists()).toBe(true)
      await wrapper.setProps({ open: false })
      await flushPromises()
      await wrapper.setProps({ open: true })
      await flushPromises()
      expect(wrapper.findComponent(UDrawer).exists()).toBe(true)
    })
  })
})
