import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useKeychainStatus } from '~/composables/useKeychainStatus'

/**
 * @composable useBoardSetup
 * @description Whether the board is set up (#561): the one question behind both redirects between the board and the
 * welcome page. `pages/tasks.vue` sends a board that is not set up to /welcome, `middleware/welcome-guard.ts` sends a
 * set-up board away from it; they share this answer so they can never point at each other (a loop).
 * @responsibility
 * - Set up = a usable default source (`isIntegrationConfigured`), or a token that is only unreachable (Keychain
 *   locked or denied): that board stays on its cached data instead of going through the welcome flow
 */
export function useBoardSetup() {
  const { isIntegrationConfigured } = useIntegrationManager()
  const { unavailable } = useKeychainStatus()
  /** Read at call time: the Keychain status fills in after start-up */
  const isSetUp = (): boolean => isIntegrationConfigured() || unavailable.value.length > 0
  return { isSetUp }
}
