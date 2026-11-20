import type { CatalogEntry } from '../types'

const steps = [
  { key: 'access', label: { $t: 'onboarding.flow.reminders.steps.access' } },
  { key: 'lists', label: { $t: 'onboarding.flow.reminders.steps.lists' } },
  { key: 'today', label: { $t: 'onboarding.flow.reminders.steps.today' } },
]
const shared = { steps, help: { $t: 'onboarding.flow.reminders.help.lists' }, backLabel: { $t: 'common.back' } }
const lead = { $t: 'onboarding.flow.reminders.lists.lead' }

/** Description, usage and avoid come from the doc block of `components/setup/SetupShell.vue` (the manifest). */
export default {
  component: 'SetupShell',
  source: 'app',
  alternatives: ['SetupRail', 'BackButton'],
  variants: [
    // The first step: no way back inside the shell, so Weiter is alone and fills the row on a phone
    { id: 'step-1', label: 'Step 1', props: { ...shared, current: 0, backLabel: null }, slot: lead },
    { id: 'step-2', label: 'Step 2', props: { ...shared, current: 1 }, slot: lead },
    { id: 'step-3', label: 'Step 3', props: { ...shared, current: 2, nextLabel: { $t: 'onboarding.flow.reminders.connect' } }, slot: lead },
    {
      id: 'done',
      label: 'Done beat',
      props: {
        ...shared,
        current: 2,
        done: true,
        doneTitle: { $t: 'onboarding.flow.reminders.connected' },
        doneHint: { $t: 'onboarding.flow.reminders.loadingBoard' },
      },
      slot: lead,
    },
  ],
  states: [
    { id: 'loading', state: 'loading', props: { ...shared, current: 1, loading: true }, slot: lead },
    { id: 'error', state: 'error', props: { ...shared, current: 2, error: { $t: 'onboarding.flow.reminders.connectFailed' } }, slot: lead },
    { id: 'disabled', state: 'disabled', props: { ...shared, current: 1, nextDisabled: true }, slot: lead },
  ],
} satisfies CatalogEntry
