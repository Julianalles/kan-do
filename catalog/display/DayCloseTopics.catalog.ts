import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'DayCloseTopics',
  source: 'app',
  alternatives: ['StatsTimeSplit'],
  variants: [
    {
      id: 'folded',
      props: {
        rows: [
          { key: 'Angebote', kind: 'topic', count: 4, step: 0 },
          { key: 'Steuern', kind: 'topic', count: 2, step: 1 },
          { key: '__other__', kind: 'other', count: 2, step: 4 },
          { key: '__none__', kind: 'none', count: 1, step: 4 },
        ],
      },
    },
  ],
  states: [],
} satisfies CatalogEntry
