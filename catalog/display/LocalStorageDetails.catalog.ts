import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'LocalStorageDetails',
  source: 'app',
  alternatives: ['DataStorageNotice'],
  screen: '/settings?tab=sources',
  sampleNote: 'reads the data-folder composable (folder, status, cloud state), desktop only; shown in the Lokal row of the Verbindungen tab.',
  states: [],
} satisfies CatalogEntry
