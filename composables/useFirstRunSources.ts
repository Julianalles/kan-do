/**
 * @composable useFirstRunSources
 * @description How the welcome flow's Notion setup ends on a board that may already hold Reminders (#552): one rule for the
 * first-run sources, so the page stays thin and the decision is unit-tested.
 * @responsibility
 * - `beginNotionAsDefault()`: Notion becomes the default source. Without Reminders it is the old single-source switch
 *   (`beginSourceSwitch`: Notion alone, other sources' tasks become Local and the first fetch replaces them). With Reminders
 *   connected (the setup ran first) Notion joins it, `connected = ['reminders', 'notion']`, the Reminders tasks stay and the
 *   board opens mixed; Reminders is never the default (`sourceCanBeDefault`)
 * - `beginLocalDefault()`: the plain Local ending; a Reminders connection that is already there stays beside Local
 */
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'

export function useFirstRunSources() {
  const boardStore = useBoardStore()
  const tasksStore = useTasksStore()

  function beginNotionAsDefault(): void {
    if (boardStore.isIntegrationConnected('reminders')) {
      boardStore.setSources({ connected: ['reminders', 'notion'], default: 'notion' })
      boardStore.markSourceSwitchPending()
      return
    }
    tasksStore.beginSourceSwitch('notion')
  }

  function beginLocalDefault(): void {
    const keepReminders = boardStore.isIntegrationConnected('reminders')
    boardStore.setSingleSource('local')
    if (keepReminders) boardStore.connectIntegration('reminders')
    tasksStore.adoptAsLocal(keepReminders ? 'reminders' : null)
  }

  return { beginNotionAsDefault, beginLocalDefault }
}
