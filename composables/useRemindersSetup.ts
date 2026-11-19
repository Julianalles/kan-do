/**
 * @composable useRemindersSetup
 * @description The state and the one write of the Apple Reminders setup (#552, epic #481 slice 3): the access step, the
 * lists with the answer per list, and the connect at the last button. The flow component (`RemindersSetupFlow`) only
 * renders it.
 * @responsibility
 * - The answers are the flow's own until `connect()`: Back, a denied permission and a leave write nothing to
 *   `remindersConfig` or `boardConfig.sources`. Access that macOS granted stays macOS's; that is not "connected"
 * - `requestAccess` is the only call that can show the macOS prompt (a user action); `refreshAccess` and `recheck` never prompt
 * - `connect()` re-checks the permission first, writes the answered roles (a list not answered reads Thema) and calls
 *   `useSourceConnections().connectSource('reminders')`. A failure at any point puts everything back: the earlier roles,
 *   the connection, and (first run) the "never onboarded" state, and says why (`denied` or `failed`)
 * - First run onboards the board as Local first (`setSingleSource('local')`, the welcome flow's rule): Reminders is never
 *   the default source (decision E7)
 */
import { computed, ref } from 'vue'
import {
  remindersAccessStatus,
  remindersLists,
  remindersOpenSettings,
  remindersRequestAccess,
  type ReminderList,
  type RemindersAccessStatus,
} from '~/lib/reminders'
import { DEFAULT_LIST_ROLE, isReadRole, type ReminderListRole } from '~/lib/remindersSource'
import { useBoardStore } from '~/store/board'
import { useRemindersConfigStore } from '~/store/remindersConfig'
import { useTasksStore } from '~/store/tasks'
import { useSourceConnections } from '~/composables/useSourceConnections'

/** What the access step shows: nothing asked yet, macOS asking, access given, or no access (denied, restricted, write-only). */
export type SetupAccess = 'idle' | 'asking' | 'granted' | 'denied'

export type SetupStep = 0 | 1 | 2

export type ConnectOutcome = 'connected' | 'denied' | 'failed'

const accessOf = (status: RemindersAccessStatus): SetupAccess =>
  status === 'granted' ? 'granted' : status === 'notDetermined' ? 'idle' : 'denied'

export function useRemindersSetup(options: { firstRun: boolean }) {
  const boardStore = useBoardStore()
  const tasksStore = useTasksStore()
  const config = useRemindersConfigStore()
  const { connectSource, disconnectSource } = useSourceConnections()

  const step = ref<SetupStep>(0)
  const access = ref<SetupAccess>('idle')
  /** `null` until the first read; `[]` is an account without lists. */
  const lists = ref<ReminderList[] | null>(null)
  const loadingLists = ref(false)
  const listsFailed = ref(false)
  /** The answers of this run: only a list the user touched is here, the rest reads Thema. */
  const draft = ref<Record<string, ReminderListRole>>({})
  const connecting = ref(false)
  const connectFailed = ref(false)

  const roleOf = (listId: string): ReminderListRole => draft.value[listId] ?? DEFAULT_LIST_ROLE
  const setRole = (listId: string, role: ReminderListRole) => {
    draft.value = { ...draft.value, [listId]: role }
  }
  const listCount = computed(() => lists.value?.length ?? 0)
  const anyRead = computed(() => (lists.value ?? []).some((list) => isReadRole(roleOf(list.id))))
  /** Every list is Aus (or there is none): "Weiter" and "Verbinden" stay off and the step says why. */
  const allOff = computed(() => lists.value !== null && lists.value.length > 0 && !anyRead.value)
  const noLists = computed(() => lists.value !== null && lists.value.length === 0)

  async function loadLists(): Promise<void> {
    loadingLists.value = true
    listsFailed.value = false
    try {
      lists.value = await remindersLists()
    } catch {
      lists.value = null
      listsFailed.value = true
    } finally {
      loadingLists.value = false
    }
  }

  /** The permission as macOS holds it now (never prompts); a granted one loads the lists. */
  async function refreshAccess(): Promise<void> {
    try {
      const status = await remindersAccessStatus()
      config.setAccessStatus(status)
      access.value = accessOf(status)
    } catch {
      access.value = 'denied'
      return
    }
    if (access.value === 'granted') await loadLists()
  }

  /** "Zugriff erlauben": the one call that can show the macOS prompt. */
  async function requestAccess(): Promise<void> {
    if (access.value === 'asking') return
    access.value = 'asking'
    try {
      const status = await remindersRequestAccess()
      config.setAccessStatus(status)
      access.value = accessOf(status)
      // A prompt that ended without an answer reads as "not asked": the button stays what it was
    } catch {
      access.value = 'denied'
    }
    if (access.value === 'granted') await loadLists()
  }

  /** "Erneut prüfen" after the user changed it in System Settings: no prompt. */
  const recheck = refreshAccess

  async function openSystemSettings(): Promise<void> {
    try {
      await remindersOpenSettings()
    } catch {
      // Nothing to repair here: the panel already says where to go
    }
  }

  const canProceed = computed(() => {
    if (step.value === 0) return access.value === 'granted' && !loadingLists.value && lists.value !== null
    if (step.value === 1) return anyRead.value && !loadingLists.value
    return !connecting.value
  })

  function next(): void {
    if (step.value < 2 && canProceed.value) step.value = (step.value + 1) as SetupStep
  }

  /** One step back; `false` from the first step: the host leaves the flow (nothing was written). */
  function back(): boolean {
    if (step.value === 0) return false
    step.value = (step.value - 1) as SetupStep
    return true
  }

  /**
   * The last button: writes the answers and connects. Re-checks the permission first (it can be revoked between the
   * steps) and undoes everything on a failure, so a failed connect leaves nothing connected.
   */
  async function connect(): Promise<ConnectOutcome> {
    if (connecting.value) return 'failed'
    connecting.value = true
    connectFailed.value = false
    const previousLists = { ...config.lists }
    const onboardedHere = options.firstRun && !boardStore.isOnboarded
    const undo = async (connectedHere: boolean) => {
      if (connectedHere) await disconnectSource('reminders')
      config.setLists(previousLists)
      if (onboardedHere) boardStore.setSources(null)
    }
    try {
      try {
        const status = await remindersAccessStatus()
        config.setAccessStatus(status)
        access.value = accessOf(status)
      } catch {
        access.value = 'denied'
      }
      if (access.value !== 'granted') {
        step.value = 0
        return 'denied'
      }

      const all = lists.value ?? []
      config.setLists({
        ...previousLists,
        ...Object.fromEntries(all.map((list) => [list.id, { role: roleOf(list.id), title: list.title }])),
      })
      if (onboardedHere) {
        // The welcome flow's first run: a Local board that Reminders joins; the sample or stale tasks make way
        tasksStore.setTasks([])
        boardStore.setSingleSource('local')
        tasksStore.adoptAsLocal()
      }

      const alreadyConnected = boardStore.isIntegrationConnected('reminders')
      const result = await connectSource('reminders')
      const ok = alreadyConnected || (result.ok && result.fetched)
      if (!ok) {
        await undo(result.ok)
        // The permission may have gone between the check and the fetch
        try {
          access.value = accessOf(await remindersAccessStatus())
        } catch {
          access.value = 'denied'
        }
        if (access.value !== 'granted') {
          step.value = 0
          return 'denied'
        }
        connectFailed.value = true
        return 'failed'
      }
      return 'connected'
    } catch {
      await undo(boardStore.isIntegrationConnected('reminders'))
      connectFailed.value = true
      return 'failed'
    } finally {
      connecting.value = false
    }
  }

  return {
    step,
    access,
    lists,
    loadingLists,
    listsFailed,
    draft,
    connecting,
    connectFailed,
    roleOf,
    setRole,
    listCount,
    anyRead,
    allOff,
    noLists,
    canProceed,
    refreshAccess,
    requestAccess,
    recheck,
    openSystemSettings,
    loadLists,
    next,
    back,
    connect,
  }
}
