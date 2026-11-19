import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useBoardStore } from '~/store/board'
import { useKeychainStatus } from '~/composables/useKeychainStatus'

/**
 * @composable useBoardSetup
 * @description Whether the board is set up (#561): the one question behind both redirects between the board and the
 * welcome page. `pages/tasks.vue` sends a board that is not set up to /welcome, `middleware/welcome-guard.ts` sends a
 * set-up board away from it; they share this answer so they can never point at each other (a loop).
 * @responsibility
 * - Set up = a usable default source (`isIntegrationConfigured`), or an onboarded board whose token is only
 *   unreachable (Keychain locked or denied): that board stays on its cached data instead of going through the welcome
 *   flow. A board that never finished onboarding (`sources` null) is not set up whatever the Keychain says
 */
export function useBoardSetup() {
  const { isIntegrationConfigured } = useIntegrationManager()
  const boardStore = useBoardStore()
  const { unavailable } = useKeychainStatus()
  /** Read at call time: the Keychain status can change after start-up */
  const isSetUp = (): boolean => isIntegrationConfigured() || (boardStore.isOnboarded && unavailable.value.length > 0)
  return { isSetUp }
}
