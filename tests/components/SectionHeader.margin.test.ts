import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SectionHeader from '~/components/ui/SectionHeader.vue'

// #623: the label role's margin must sit at zero specificity (`[:where(&)]:mb-*`), so a host `mb-*`
// of the same utility layer wins. A bare `mb-*` on the element ties on specificity and loses to source order.
const mountLabel = (tag: string, attrs: Record<string, string> = {}) =>
  mount(SectionHeader, { props: { size: 'label', tag, text: 'Label' }, attrs, global: { stubs: { UIcon: true } } })

describe('SectionHeader label role margin', () => {
  it.each([['h1', 'mb-4'], ['h2', 'mb-3'], ['h3', 'mb-2'], ['div', 'mb-2']])('%s carries %s only through :where()', (tag, mb) => {
    const classes = mountLabel(tag).classes()
    expect(classes).toContain(`[:where(&)]:${mb}`)
    expect(classes).not.toContain(mb)
  })

  it('a host mb-* lands on the element next to the zero-specificity default', () => {
    const classes = mountLabel('h2', { class: 'mb-1' }).classes()
    expect(classes).toContain('mb-1')
    expect(classes).toContain('[:where(&)]:mb-3')
  })

  it('label and legend take no margin from the role', () => {
    for (const tag of ['label', 'legend']) {
      expect(mountLabel(tag).classes().some(c => c.includes('mb-'))).toBe(false)
    }
  })
})
