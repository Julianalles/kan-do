import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'DayCloseSummary',
  source: 'app',
  alternatives: ['StatsVerdict'],
  variants: [
    { id: 'mixed', props: { doneCount: 3, openCount: 2 } },
    { id: 'all-done', props: { doneCount: 4, openCount: 0 } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { doneCount: 0, openCount: 0 } },
  ],
} satisfies CatalogEntry
