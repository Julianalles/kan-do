import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'DayCloseTimebox',
  source: 'app',
  alternatives: ['StatsEstimateRing'],
  variants: [
    { id: 'mixed', props: { groups: { under: 1, within: 3, over: 2, total: 6 } } },
    { id: 'one-group', props: { groups: { under: 0, within: 2, over: 0, total: 2 } } },
  ],
  states: [],
} satisfies CatalogEntry
