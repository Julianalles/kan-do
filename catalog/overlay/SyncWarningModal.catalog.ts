import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'SyncWarningModal',
  source: 'app',
  alternatives: ['UModal'],
  launch: 'open',
  screen: '/tasks',
  variants: [
    { id: 'drop', label: 'task count dropped', props: { source: 'notion', reason: 'significant_task_count_drop', currentTaskCount: 42, fetchedCount: 6 } },
    { id: 'empty', label: 'empty result', props: { source: 'notion', reason: 'empty_sync_with_local_data', currentTaskCount: 12, fetchedCount: 0 } },
  ],
  states: [],
} satisfies CatalogEntry
