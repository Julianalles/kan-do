import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskDetailMetadata',
  source: 'app',
  alternatives: [],
  variants: [
    { id: 'local', props: { icon: 'i-ph-desktop', createdAt: '09.11.2026' } },
    { id: 'notion', props: { source: 'Notion', icon: 'i-ph-notebook', createdAt: '09.11.2026' } },
  ],
  states: [],
} satisfies CatalogEntry
