import { hasInjectionContext } from 'vue'
import { useNuxtApp, useToast } from '#imports'
import { translate } from '~/lib/i18n'
import { integrationLabel } from '~/lib/taskSources'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import type { IntegrationSourceId } from '~/types/taskSource'

type Toast = ReturnType<typeof useToast>

/** `useToast()` calls `inject()`: inside setup directly, elsewhere (after an await, in an integration class) in the app context. */
const resolveToast = (): Toast => (hasInjectionContext() ? useToast() : useNuxtApp().vueApp.runWithContext(() => useToast()))

/**
 * Tells the user that a source cannot be reached, once per outage (#851): one calm toast that names the source and
 * says the changes are kept and sync once it answers again. Every later call for that source stays quiet until the
 * source is reachable again (`useIntegrationHealthStore.tellOutageOnce` holds the state and says when it resets).
 * The card cloud and the sync button keep showing the outage (#319).
 * Called by `useErrorHandler` for a failed sync and by `useTaskSync` where a change is put aside without a request.
 * @returns whether the toast was shown
 */
export function informUnreachable(source: IntegrationSourceId, toast: Toast = resolveToast()): boolean {
  if (!useIntegrationHealthStore().tellOutageOnce(source)) return false
  const name = integrationLabel(source)
  toast.add({
    title: translate('errors.sourceUnreachableTitle', { source: name }),
    description: translate('errors.sourceUnreachable', { source: name }),
    color: 'warning',
    // Two sentences: longer than the 5 s of a one-line error
    duration: 8000,
    icon: 'i-ph-wifi-slash',
  })
  return true
}
