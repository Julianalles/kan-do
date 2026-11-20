import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'DisclosureCaret',
  source: 'app',
  alternatives: ['ListRow', 'StatsTile'],
  variants: [
    { id: 'closed', label: 'the block is closed: it points down', props: { open: false } },
    { id: 'open', label: 'the block is open: it points up', props: { open: true } },
  ],
  states: [],
} satisfies CatalogEntry
