import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import NewCardOptionList from '~/components/board/NewCardOptionList.vue'

let w: VueWrapper
const mountList = (props: Record<string, unknown> = {}) => {
  w = mount(NewCardOptionList, {
    props: {
      values: ['15', '30', '45', '60'],
      current: null,
      label: 'Timebox?',
      optionLabel: (value: string) => `${value} min`,
      ...props,
    },
    attachTo: document.body,
  })
  return w
}
const names = () => w.findAll('button').map((button) => button.text())
const list = () => w.get('[data-testid="new-card-more-list"]')

afterEach(() => w?.unmount())

describe('NewCardOptionList (Timebox only since #434)', () => {
  it('is the plain list of the timebox values, the current one marked, a pick emitted', async () => {
    mountList({ current: '30' })
    expect(names()).toEqual(['15 min', '30 min', '45 min', '60 min'])
    expect(w.findAll('button').map((b) => b.attributes('aria-current'))).toEqual([undefined, 'true', undefined, undefined])
    await w.findAll('button')[2]!.trigger('click')
    expect(w.emitted('pick')).toEqual([['45']])
    expect(w.find('input').exists()).toBe(false)
  })

  it('arrows walk the options with wrapping; Home and End jump to the first and last; the keys stop here', async () => {
    mountList()
    const buttons = w.findAll('button').map((b) => b.element)
    buttons[0]!.focus()
    await list().trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(buttons[3])
    await list().trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(buttons[0])
    await list().trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(buttons[3])
    await list().trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(buttons[0])
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    buttons[0]!.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
  })
})
