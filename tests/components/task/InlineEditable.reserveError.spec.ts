import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import InlineEditable from '~/components/ui/inline/InlineEditable.vue'

// #594: the error line is held in read mode too, so starting to edit moves nothing
describe('InlineEditable reserveError (#594)', () => {
  const render = (props: Record<string, unknown> = {}) => mount(InlineEditable, { props: { modelValue: 'Titel', label: 'Titel', ...props } })

  it('holds the line in read mode and in edit mode', async () => {
    const wrapper = render({ reserveError: true })
    expect(wrapper.findAll('[data-testid="inline-required-reserve"]')).toHaveLength(1)
    await wrapper.get('[role="button"]').trigger('keydown.enter')
    expect(wrapper.findAll('[data-testid="inline-required-reserve"]')).toHaveLength(1)
  })

  it('holds nothing without reserveError', () => {
    expect(render().find('[data-testid="inline-required-reserve"]').exists()).toBe(false)
  })
})
