import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/ui/SegmentedChoice.vue` (the manifest). */

const options = [
  { value: 'topic', label: { $t: 'onboarding.flow.reminders.lists.topic' } },
  { value: 'activity', label: { $t: 'onboarding.flow.reminders.lists.activity' } },
  { value: 'off', label: { $t: 'onboarding.flow.reminders.lists.off' } },
]
const label = { $t: 'onboarding.flow.reminders.lists.groupLabel' }

export default {
  component: 'SegmentedChoice',
  source: 'app',
  alternatives: ['ChoiceChip', 'ChoiceCard', 'SwatchRadioGroup', 'UTabs'],
  variants: [
    { id: 'default', label: 'one answer picked', props: { options, label, modelValue: 'topic' } },
  ],
  states: [
    { id: 'selected', state: 'selected', label: 'Aus picked', props: { options, label, modelValue: 'off' } },
    { id: 'disabled', state: 'disabled', props: { options, label, modelValue: 'topic', disabled: true } },
    { id: 'focus', state: 'focus', props: { options, label, modelValue: 'activity' } },
  ],
} satisfies CatalogEntry
