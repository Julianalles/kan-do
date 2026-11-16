/**
 * @composable useNowWindowSync
 * @description The main window's half of the floating Now window (#383, ADR 020). Publishes the setting and the Jetzt
 * task to Rust (`overlay_sync`), and carries out what the pill asks for (`overlay://action`).
 * @responsibility
 * - Desktop only: a no-op on the web
 * - One push per change of what the pill shows (setting, task, title, timebox, stored time, running, locale), never per
 *   second: the stored time changes at the 10 s checkpoint (#286), and the snapshot carries the live seconds of that
 *   moment, so the pill counts on by the wall clock in between (`lib/nowWindow.ts`)
 * - Pause is the existing timer stop (`stopTaskTimer`, `resumeTaskTimer`), runtime-only (D5); done is the board's own
 *   completion path (`moveOrSwapToStatus`), so undo and the writes to a source behave as everywhere else
 * - An action whose task is no longer the Jetzt task is ignored
 * - Takes no part in showing the window: Rust decides that from the main window's focus
 */
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isTauri } from '~/utils/isTauri'
import { useSettingsStore } from '~/store/settings'
import { useTasksStore } from '~/store/tasks'
import { useTaskOperations } from '~/composables/useTaskOperations'
import { resumeTaskTimer, stopTaskTimer } from '~/composables/useTaskTimerDriver'
import { liveTimeSpent } from '~/lib/liveTime'
import { OVERLAY_ACTIONS, OVERLAY_ACTION_EVENT, type NowSnapshot, type OverlayActionPayload } from '~/lib/nowWindow'
import { TaskStatus } from '~/types/taskStatus'

export function useNowWindowSync(): void {
  if (!isTauri()) return

  const settings = useSettingsStore()
  const tasksStore = useTasksStore()
  const { moveOrSwapToStatus } = useTaskOperations()
  const { locale } = useI18n()

  const jetzt = computed(() => tasksStore.tasksProgress[0] ?? null)

  /** Only stored fields: the live seconds are read when a push is built, so they never trigger one */
  const pushKey = computed(() => {
    const task = jetzt.value
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
    const task = jetzt.value
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
    if (!task || task.status !== TaskStatus.Progress) return
    if (payload.kind === 'toggle-pause') {
      if (task.timerId !== null) stopTaskTimer(task.id)
      else resumeTaskTimer(task.id)
    } else if (payload.kind === 'done') {
      await moveOrSwapToStatus(task.id, TaskStatus.Done)
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
