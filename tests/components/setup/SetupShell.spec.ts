import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import SetupShell from '~/components/setup/SetupShell.vue'

const stubs = {
  UButton: { inheritAttrs: false, props: ['loading', 'disabled', 'icon'], template: '<button v-bind="$attrs" :disabled="disabled" :data-loading="loading ? 1 : 0"><slot /></button>' },
  UAlert: { inheritAttrs: false, props: ['description'], template: '<div v-bind="$attrs">{{ description }}</div>' },
  UIcon: { template: '<i />' },
}
const steps = [{ key: 'a', label: 'Zugriff' }, { key: 'b', label: 'Listen' }, { key: 'c', label: 'Heute' }]

let wrapper: VueWrapper | undefined
const make = (props: Record<string, unknown> = {}, slot = '<p>Inhalt</p>') =>
  (wrapper = mount(SetupShell, { props: { steps, current: 0, ...props }, slots: { default: slot }, global: { stubs }, attachTo: document.body }))

describe('SetupShell (#648)', () => {
  const animate = vi.fn()
  beforeEach(() => {
    animate.mockReset()
    animate.mockReturnValue({ finished: Promise.resolve(), cancel() {} })
    HTMLElement.prototype.animate = animate as never
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  })
  afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.unstubAllGlobals() })

  it('shows rail, pane and footer in this DOM order, with no step heading', () => {
    const w = make({ current: 1 })
    const order = ['[data-testid="setup-progress"]', '[data-testid="setup-pane"]', '[data-testid="setup-footer"]'].map((s) => w.html().indexOf(s.slice(1, -1)))
    expect(order.every((n) => n > 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(w.find('h1, h2, h3').exists()).toBe(false)
    expect(w.find('[aria-current="step"]').text()).toContain('Listen')
  })

  it('names the pane by the current step, or by pane-label', async () => {
    const w = make({ current: 1 })
    expect(w.get('[data-testid="setup-pane"]').attributes('role')).toBe('group')
    expect(w.get('[data-testid="setup-pane"]').attributes('aria-label')).toBe('Listen')
    await w.setProps({ paneLabel: 'Eigener Name' })
    expect(w.get('[data-testid="setup-pane"]').attributes('aria-label')).toBe('Eigener Name')
  })

  it('footer: Zurück only with a back label, Weiter always, the test id comes in as a prop', async () => {
    const w = make({ nextTestId: 'wizard-proceed' })
    expect(w.find('[data-testid="setup-back"]').exists()).toBe(false)
    expect(w.get('[data-testid="wizard-proceed"]').text()).toBe('Weiter')
    expect(w.get('[data-testid="setup-footer"]').classes()).toContain('footer-actions')
    await w.setProps({ backLabel: 'Zurück zur Auswahl' })
    expect(w.get('[data-testid="setup-back"]').text()).toBe('Zurück zur Auswahl')
    await w.get('[data-testid="setup-back"]').trigger('click')
    await w.get('[data-testid="wizard-proceed"]').trigger('click')
    expect(w.emitted('back')).toHaveLength(1)
    expect(w.emitted('next')).toHaveLength(1)
  })

  it('footer: Zurück comes before Weiter', () => {
    const w = make({ backLabel: 'Zurück' })
    const buttons = w.findAll('[data-testid="setup-footer"] button')
    expect(buttons.map((b) => b.attributes('data-testid'))).toEqual(['setup-back', 'setup-next'])
  })

  it('loading puts Weiter in its loading state and marks the pane busy; the content stays', () => {
    const w = make({ loading: true })
    expect(w.get('[data-testid="setup-next"]').attributes('data-loading')).toBe('1')
    expect(w.get('[data-testid="setup-pane"]').attributes('aria-busy')).toBe('true')
    expect(w.text()).toContain('Inhalt')
  })

  it('an error is an alert inside the pane', () => {
    const w = make({ error: 'Das hat nicht geklappt.' })
    const alert = w.get('[data-testid="setup-pane"] [data-testid="setup-error"]')
    expect(alert.attributes('role')).toBe('alert')
    expect(alert.text()).toBe('Das hat nicht geklappt.')
  })

  it('a step change slides the pane 14 px from the side it is reached from and moves focus to it', async () => {
    const w = make({ current: 0 })
    expect(animate).not.toHaveBeenCalled() // the first mount animates nothing
    await w.setProps({ current: 1 })
    await nextTick()
    const [frames, options] = animate.mock.calls.find(([, o]) => o.duration === 300)!
    expect(frames[0].transform).toBe('translateX(14px)')
    expect(options.duration).toBe(300)
    expect(document.activeElement).toBe(w.get('[data-testid="setup-pane"]').element)
    await w.setProps({ current: 0 })
    await nextTick()
    expect(animate.mock.calls.at(-1)![0][0].transform).toBe('translateX(-14px)')
  })

  it('a step change under reduced motion does not animate, focus still moves', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    const w = make({ current: 0 })
    await w.setProps({ current: 1 })
    await nextTick()
    expect(animate).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(w.get('[data-testid="setup-pane"]').element)
  })

  it('the done beat replaces rail, pane and footer, is a status and takes focus', async () => {
    const w = make({ doneTitle: 'Erinnerungen ist verbunden', doneHint: 'Dein Board lädt.', backLabel: 'Zurück' })
    await w.setProps({ done: true })
    await nextTick()
    await nextTick()
    const done = w.get('[data-testid="setup-done"]')
    expect(done.attributes('role')).toBe('status')
    expect(done.text()).toContain('Erinnerungen ist verbunden')
    expect(w.find('[data-testid="setup-pane"]').exists()).toBe(false)
    expect(w.find('[data-testid="setup-footer"]').exists()).toBe(false)
    expect(w.find('[data-testid="setup-progress"]').exists()).toBe(false)
    expect(document.activeElement).toBe(done.element)
  })
})
