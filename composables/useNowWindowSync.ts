/**
 * @composable useNowWindowSync
 * @description The main window's half of the floating Now window (#383, ADR 020). Publishes the setting and the Jetzt
 * task to Rust (`overlay_sync`), and carries out what the pill asks for (`overlay://action`).
 * @responsibility
 * - Desktop only: a no-op on the web
 * - One push per change of what the pill shows (setting, task, title, timebox, stored time, running, locale), never per
 *   second: the stored time changes at the 10 s checkpoint (#286), and the snapshot carries the live seconds of that
 *   moment, so the pill counts on by the wall clock in between (`lib/nowWindow.ts`)
 * - Pause (#405) is a move of the Jetzt task to the top of Wartet (`moveTaskToStatus(…, { pause: true })`: the board's
 *   guarded move, so the write to a source and the timer stop behave as for any move out of Jetzt); done is the board's own
 *   completion path (`moveOrSwapToStatus`), so undo and the writes to a source behave as everywhere else
 * - The paused task stays the pill's task (the "pin": runtime only, a restart drops it) while it sits in Wartet and
 *   Jetzt is empty; resume moves it back to Jetzt (`moveTaskToStatus`, the WIP rule holds by construction). The pin
 *   ends when any card is in Jetzt (the pill follows it), the task leaves Wartet, or the setting is turned off
 * - An action whose task is neither the Jetzt task nor the pinned one is ignored
 * - Takes no part in showing the window: Rust decides that from the main window's focus
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isTauri } from '~/utils/isTauri'
import { useSettingsStore } from '~/store/settings'
import { useTasksStore } from '~/store/tasks'
import { useTaskOperations } from '~/composables/useTaskOperations'
import { resumeTaskTimer } from '~/composables/useTaskTimerDriver'
import { liveTimeSpent } from '~/lib/liveTime'
import { OVERLAY_ACTIONS, OVERLAY_ACTION_EVENT, type NowSnapshot, type OverlayActionPayload } from '~/lib/nowWindow'
import { TaskStatus } from '~/types/taskStatus'

export function useNowWindowSync(): void {
  if (!isTauri()) return

  const settings = useSettingsStore()
  const tasksStore = useTasksStore()
  const { moveOrSwapToStatus, moveTaskToStatus } = useTaskOperations()
  const { locale } = useI18n()

  /** The task the user paused from the pill (#405); read through `pinned`, which is null once it is not in Wartet */
  const pinnedId = ref<string | null>(null)
  const pinned = computed(() => {
    const task = pinnedId.value === null ? null : tasksStore.task(pinnedId.value)
    return task !== null && task.status === TaskStatus.Waiting ? task : null
  })
  const jetzt = computed(() => tasksStore.tasksProgress[0] ?? null)
  /** The Jetzt task, or while Jetzt is empty the paused one */
  const shown = computed(() => jetzt.value ?? pinned.value)

  // The pin ends with its reason: a card in Jetzt, a task that left Wartet, the setting turned off
  watch([jetzt, pinned, () => settings.floatingNowEnabled], ([inJetzt, paused, enabled]) => {
    if (pinnedId.value !== null && (inJetzt !== null || paused === null || !enabled)) pinnedId.value = null
  }, { flush: 'sync' })

  /** Only stored fields: the live seconds are read when a push is built, so they never trigger one */
  const pushKey = computed(() => {
    const task = shown.value
    return [
      settings.floatingNowEnabled,
      task?.id,
      task?.title,
      task?.timeBoxSeconds,
      task?.timeSpentSeconds,
      task !== null && task.timerId !== null,
      locale.value,
    ].join('\u0000')
  })

  function snapshot(): NowSnapshot | null {
    const task = shown.value
    if (!task) return null
    return {
      taskId: task.id,
      title: task.title,
      timeBoxSeconds: task.timeBoxSeconds && task.timeBoxSeconds > 0 ? task.timeBoxSeconds : null,
      spentSeconds: Math.floor(liveTimeSpent(task)),
      at: Date.now(),
      running: task.timerId !== null,
      locale: locale.value,
    }
  }

  async function push(): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const enabled = settings.floatingNowEnabled
      await invoke('overlay_sync', { enabled, snapshot: enabled ? snapshot() : null })
    } catch (error) {
      // The pill is a convenience: a failed push leaves it as it was
      if (import.meta.dev) console.warn('[now-window] sync failed:', error)
    }
  }

  async function onAction(payload: OverlayActionPayload): Promise<void> {
    const task = tasksStore.task(payload.taskId)
    if (!task) return
    if (task.status === TaskStatus.Progress) {
      if (payload.kind === 'toggle-pause') {
        if (task.timerId === null) {
          resumeTaskTimer(task.id)
          return
        }
        // The status changes synchronously inside the move: the pin is set once the task sits in Wartet
        const moved = moveTaskToStatus(task.id, TaskStatus.Waiting, { pause: true })
        pinnedId.value = task.id
        await moved
      } else if (payload.kind === 'done') {
        await moveOrSwapToStatus(task.id, TaskStatus.Done)
      }
    } else if (task.status === TaskStatus.Waiting && pinnedId.value === task.id) {
      if (payload.kind === 'toggle-pause') await moveTaskToStatus(task.id, TaskStatus.Progress, { resume: true })
      else if (payload.kind === 'done') await moveOrSwapToStatus(task.id, TaskStatus.Done)
    }
  }

  function isActionPayload(value: unknown): value is OverlayActionPayload {
    if (typeof value !== 'object' || value === null) return false
    const v = value as Record<string, unknown>
    return typeof v.taskId === 'string' && typeof v.kind === 'string' && (OVERLAY_ACTIONS as readonly string[]).includes(v.kind)
  }

  let unlisten: (() => void) | null = null
  let unmounted = false
  let stopWatching: (() => void) | null = null

  onMounted(async () => {
    // Pushing starts after mount: the board is hydrated by then, so the pill never shows a half-loaded state
    stopWatching = watch(pushKey, () => { void push() }, { immediate: true })
    const { listen } = await import('@tauri-apps/api/event')
    const off = await listen<unknown>(OVERLAY_ACTION_EVENT, (event) => {
      if (isActionPayload(event.payload)) void onAction(event.payload)
    })
    if (unmounted) off()
    else unlisten = off
  })

  onBeforeUnmount(() => {
    unmounted = true
    stopWatching?.()
    unlisten?.()
    unlisten = null
  })
}
