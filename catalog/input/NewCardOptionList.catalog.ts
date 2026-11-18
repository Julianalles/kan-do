import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/board/NewCardOptionList.vue` (the manifest). */
export default {
  component: 'NewCardOptionList',
  source: 'app',
  alternatives: ['ChoiceChip', 'UInput'],
  screen: '/tasks',
  variants: [
    { id: 'timebox', label: 'Timebox', fixture: 'minutesOptionLabel', props: { values: ['5', '10', '15', '30', '45', '60', '90', '120'], current: '30', label: 'Timebox' } },
  ],
  states: [
    { id: 'large', state: 'selected', label: 'drawer: bigger targets', fixture: 'minutesOptionLabel', props: { values: ['15', '30', '45', '60'], current: null, label: 'Timebox', large: true } },
  ],
} satisfies CatalogEntry
