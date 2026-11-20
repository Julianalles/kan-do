import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import DayCloseStage from '~/components/board/DayCloseStage.vue'
import { useDayClose } from '~/composables/useDayClose'
import { setTestLocale } from '../../helpers/i18n'

vi.mock('~/composables/useDayCloseAction', () => ({
  dayCloseBlocked: () => false,
  useDayCloseAction: () => ({ finishDay: () => true }),
}))

const stubs = {
  UButton: { props: ['color', 'variant'], template: '<button type="button" v-bind="$attrs"><slot /></button>' },
}

let wrapper: VueWrapper | null = null
const stage = () => document.querySelector('[data-testid="day-close-stage"]') as HTMLElement | null

/** Two animation frames, the second one flushes the entry. */
async function frames() {
  await vi.advanceTimersByTimeAsync(40)
  await nextTick()
}

async function open() {
  wrapper = mount(DayCloseStage, { global: { stubs }, attachTo: document.body })
  useDayClose().open()
  await nextTick()
  await nextTick()
}

describe('DayCloseStage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    setTestLocale('de')
    window.matchMedia = vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
    document.body.innerHTML = '<div id="recap-stage-host"></div>'
  })
  afterEach(() => {
    useDayClose().close()
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  it('wears the curtain-down modifier and enters after the first frames, not on the first one', async () => {
    await open()
    expect(stage()?.classList.contains('recap-stage--curtain-down')).toBe(true)
    expect(stage()?.hasAttribute('data-entered')).toBe(false)
    expect(stage()?.hasAttribute('data-landed')).toBe(false)
    await frames()
    expect(stage()?.hasAttribute('data-entered')).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(stage()?.hasAttribute('data-landed')).toBe(true)
  })

  it('resets the entry when the stage is left, so a reopen starts covered again', async () => {
    await open()
    await frames()
    await vi.advanceTimersByTimeAsync(2000)
    useDayClose().close()
    await nextTick()
    await vi.advanceTimersByTimeAsync(2000)
    useDayClose().open()
    await nextTick()
    await nextTick()
    expect(stage()?.hasAttribute('data-entered')).toBe(false)
    expect(stage()?.hasAttribute('data-landed')).toBe(false)
  })

  it('keeps the focus halo quiet until the first key or press inside the stage', async () => {
    await open()
    expect(stage()?.hasAttribute('data-quiet-focus')).toBe(true)
    stage()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    await nextTick()
    expect(stage()?.hasAttribute('data-quiet-focus')).toBe(false)
  })

  it('clears the quiet halo on a pointer press too', async () => {
    await open()
    stage()!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()
    expect(stage()?.hasAttribute('data-quiet-focus')).toBe(false)
  })
})
