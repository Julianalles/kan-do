import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/ui/LoadingLine.vue` (the manifest). */
export default {
  component: 'LoadingLine',
  source: 'app',
  alternatives: ['UButton'],
  variants: [
    { id: 'default', props: {}, slot: { $t: 'notion.database.loading' } },
  ],
  states: [
    { id: 'long-text', state: 'long-text', props: {}, slot: { $t: 'board.dropToComplete' } },
  ],
} satisfies CatalogEntry
