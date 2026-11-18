import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'Subline',
  source: 'app',
  alternatives: ['SectionHeader', 'EmptyNote'],
  variants: [{ id: 'tagline', label: 'the welcome statement', props: { text: { $t: 'onboarding.page.tagline' } } }],
  states: [{ id: 'long-text', state: 'long-text', label: 'two lines in a narrow column', props: { text: { $t: 'onboarding.page.intro' } } }],
} satisfies CatalogEntry
