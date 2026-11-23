import { isNotionAvailable } from '~/utils/publicCloud';

/**
 * /settings/notion on the public web instance (#742): it offers no Notion, so the setup and the settings of a stored
 * Notion source cannot open there; the route goes to the sources tab, which says why.
 */
export default defineNuxtRouteMiddleware(() => {
  if (import.meta.server) return;
  if (!isNotionAvailable()) return navigateTo('/settings?tab=sources', { replace: true });
});
