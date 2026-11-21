import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/ui/SegmentedChoice.vue` (the manifest). */

const options = [
  { value: 'day', label: 'Tag' },
  { value: 'week', label: 'Woche' },
  { value: 'month', label: 'Monat' },
]
const label = { $t: 'onboarding.flow.reminders.lists.groupLabel' }

export default {
  component: 'SegmentedChoice',
  source: 'app',
  alternatives: ['ChoiceChip', 'ChoiceCard', 'SwatchRadioGroup', 'UTabs'],
  variants: [
    { id: 'default', label: 'one answer picked', props: { options, label, modelValue: 'day' } },
  ],
  states: [
    { id: 'selected', state: 'selected', label: 'last picked', props: { options, label, modelValue: 'month' } },
    { id: 'disabled', state: 'disabled', props: { options, label, modelValue: 'day', disabled: true } },
    { id: 'focus', state: 'focus', props: { options, label, modelValue: 'week' } },
  ],
} satisfies CatalogEntry
