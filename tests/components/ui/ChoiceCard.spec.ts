import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { RadioGroupRoot } from 'reka-ui'
import { h } from 'vue'
import ChoiceCard from '~/components/ui/ChoiceCard.vue'

describe('ChoiceCard (kd#178)', () => {
  it('without a value it is one native button with the go-on mark; the click and attributes land on it', async () => {
    const wrapper = mount(ChoiceCard, { props: { icon: 'i-ph-desktop' }, attrs: { 'data-testid': 'card' }, slots: { default: 'Noch nirgends' } })
    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.attributes('data-testid')).toBe('card')
    expect(wrapper.text()).toBe('Noch nirgends')
    expect(wrapper.find('[class*="rounded-full"]').exists()).toBe(false)
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('shows the hint under the label', () => {
    const wrapper = mount(ChoiceCard, { props: { icon: 'i-ph-plus-circle' }, slots: { default: 'Neu starten', hint: 'Leeres Board' } })
    expect(wrapper.text()).toContain('Neu starten')
    expect(wrapper.text()).toContain('Leeres Board')
  })

  it('with a value it is a radio card of the surrounding group, with the radio mark', () => {
    const wrapper = mount({
      render: () => h(RadioGroupRoot, { modelValue: 'fresh' }, () => [
        h(ChoiceCard, { value: 'fresh', icon: 'i-ph-plus-circle' }, () => 'Neu starten'),
        h(ChoiceCard, { value: 'samples', icon: 'i-ph-sparkle' }, () => 'Mit Beispielaufgaben'),
      ]),
    })
    const radios = wrapper.findAll('[role="radio"]')
    expect(radios).toHaveLength(2)
    expect(radios[0]!.attributes('aria-checked')).toBe('true')
    expect(radios[1]!.attributes('aria-checked')).toBe('false')
    expect(radios[0]!.find('[class*="rounded-full"]').exists()).toBe(true)
  })

  it('has the 12 px corner of buttons and fields and a checked radio card is a wash fill, never an outline or a solid green (kd#200)', () => {
    const wrapper = mount({
      render: () => h(RadioGroupRoot, { modelValue: 'fresh' }, () => [h(ChoiceCard, { value: 'fresh', icon: 'i-ph-plus-circle' }, () => 'Neu starten')]),
    })
    const classes = wrapper.find('[role="radio"]').classes()
    expect(classes).toContain('rounded-md')
    expect(classes).not.toContain('rounded-xl')
    expect(classes).toContain('data-[state=checked]:bg-primary/10')
    expect(classes.some((name) => name.includes('border-inverted'))).toBe(false)
  })

  it('with a v-model it is a checkbox card: role checkbox, aria-checked, a square mark with a check, never the radio dot (#651)', async () => {
    const wrapper = mount(ChoiceCard, {
      props: { icon: 'i-ph-notebook', modelValue: false, 'onUpdate:modelValue': (v: boolean | undefined) => wrapper.setProps({ modelValue: v }) },
      attrs: { 'data-testid': 'card' },
      slots: { default: 'Notion', hint: 'Aufgaben aus einer Notion-Datenbank' },
    })
    const box = wrapper.find('[role="checkbox"]')
    expect(box.exists()).toBe(true)
    expect(box.attributes('aria-checked')).toBe('false')
    expect(box.attributes('data-testid')).toBe('card')
    expect(box.attributes('type')).toBe('button')
    expect(wrapper.find('[class*="rounded-full"]').exists()).toBe(false)
    expect(wrapper.find('[class*="rounded-sm"]').exists()).toBe(true)
    await box.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([true])
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="checkbox"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.find('[role="checkbox"]').attributes('data-state')).toBe('checked')
    await wrapper.find('[role="checkbox"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('a disabled checkbox card cannot be ticked and keeps its reason in the text', async () => {
    const wrapper = mount(ChoiceCard, {
      props: { icon: 'i-ph-check-square', modelValue: false },
      attrs: { disabled: true },
      slots: { default: 'Todoist', hint: 'Bald verfügbar' },
    })
    const box = wrapper.find('[role="checkbox"]')
    expect(box.attributes('disabled')).toBeDefined()
    expect(box.text()).toContain('Bald verfügbar')
    await box.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('without a v-model it is not a checkbox card', () => {
    const wrapper = mount(ChoiceCard, { props: { icon: 'i-ph-desktop' } })
    expect(wrapper.find('[role="checkbox"]').exists()).toBe(false)
  })
})
