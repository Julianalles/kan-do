import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LoadingLine from '~/components/ui/LoadingLine.vue'

describe('LoadingLine', () => {
  it('is a status line with the sentence and a turning ring that reduced motion leaves alone (#603)', () => {
    const wrapper = mount(LoadingLine, { slots: { default: 'Lädt…' }, global: { stubs: { UIcon: { template: '<i class="icon" />' } } } })
    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.text()).toBe('Lädt…')
    expect(wrapper.find('.icon').classes()).toContain('animate-spin')
    expect(wrapper.find('.icon').classes().join(' ')).not.toContain('motion-safe')
  })
})
