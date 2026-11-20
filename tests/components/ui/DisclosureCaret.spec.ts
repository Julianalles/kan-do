import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DisclosureCaret from '~/components/ui/DisclosureCaret.vue'

// UIcon is an empty span here: the class and the attributes are what the caret owns (#610)
const stubs = { UIcon: { template: '<span />' } }
const mountCaret = (open: boolean) => mount(DisclosureCaret, { props: { open }, global: { stubs } })

describe('DisclosureCaret', () => {
  it('points down while the block is closed and turns up (a class that rotates it 180 degrees) while it is open', async () => {
    const w = mountCaret(false)
    expect(w.classes()).not.toContain('disclosure-caret--open')
    await w.setProps({ open: true })
    expect(w.classes()).toContain('disclosure-caret--open')
    await w.setProps({ open: false })
    expect(w.classes()).not.toContain('disclosure-caret--open')
  })

  it('is decorative: aria-hidden, so the toggle keeps the name and aria-expanded', () => {
    expect(mountCaret(true).attributes('aria-hidden')).toBe('true')
  })
})
