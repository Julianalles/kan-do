/**
 * @composable useRemoteBridge
 * @description The desktop side of the MCP bridge (ADR 023): while the app is open and the bridge is switched on, it applies the
 * commands Claude queued at the `kando-mcp` Worker and uploads today's board for `get_board`.
 * @responsibility
 * - Desktop main window only, and only with a saved address, a stored token and the switch on; a no-op everywhere else
 * - Polls `GET /sync/commands` (start, every 30 s, on window focus), applies each command once (ledger in the
 *   `remote-bridge-store`) through `applyRemoteCommand` and reports the result; nothing is applied while the data file is
 *   in a blocking state (conflict, unavailable folder, read-only), the command simply stays queued
 * - Uploads `buildSnapshot` (debounced, only when it changed) after commands and board changes
 * - Every request goes through Rust (`bridge_request`): the token and the address never reach this module
 */
import { computed, reactive, readonly, watch } from 'vue'
import { dataState } from '~/lib/dataStorage'
import { liveTimeSpent } from '~/lib/liveTime'
import { parseCommands } from '~/lib/remoteBridge'
import { applyRemoteCommand, buildSnapshot, type RemoteBoardDeps, type RemoteCommand } from '~/lib/remoteCommands'
import { BRIDGE_SECRET_ENTRY } from '~/lib/secrets'
import { isOverlayWindow } from '~/lib/overlayWindow'
import { useAddTarget } from '~/composables/useAddTarget'
import { useSecrets } from '~/composables/useSecrets'
import { useTaskOperations } from '~/composables/useTaskOperations'
import { useTaskSync } from '~/composables/useTaskSync'
import { useToday } from '~/composables/useToday'
import { useDayRecapStore } from '~/store/dayRecap'
import { useRemoteBridgeStore } from '~/store/remoteBridge'
import { useTasksStore } from '~/store/tasks'
import { dayKey } from '~/utils/recapDay'
import { isTauri } from '~/utils/isTauri'
import type { SecretErrorKind } from '~/composables/useSecrets'

export const POLL_INTERVAL_MS = 30_000
export const SNAPSHOT_DEBOUNCE_MS = 5_000

/** Why the bridge is not working, for the settings row: a fixed key, never a message from the network. */
export type BridgeProblem = 'blocked' | 'rejected' | 'network' | 'timeout' | 'unreachable'

const runtime = reactive<{
  /** Saved Worker host (Rust returns the host only). */
  host: string | null
  tokenPresent: boolean
  running: boolean
  problem: BridgeProblem | null
  lastSyncAt: number | null
}>({ host: null, tokenPresent: false, running: false, problem: null, lastSyncAt: null })

interface BridgeResponse<T> {
  status: number
  body: T
}

async function request<T = unknown>(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown): Promise<BridgeResponse<T>> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<BridgeResponse<T>>('bridge_request', { method, path, body })
}

function problemOf(error: unknown): BridgeProblem {
  const kind = (error as { kind?: SecretErrorKind } | null)?.kind
  if (kind === 'rejected') return 'rejected'
  if (kind === 'timeout') return 'timeout'
  if (kind === 'network') return 'network'
  return 'unreachable'
}

let timer: ReturnType<typeof setInterval> | null = null
let snapshotTimer: ReturnType<typeof setTimeout> | null = null
let started = false
let polling = false
let lastUploaded = ''
let stopWatch: (() => void) | null = null

export function useRemoteBridge() {
  const store = useRemoteBridgeStore()
  const tasksStore = useTasksStore()
  const sync = useTaskSync()
  const ops = useTaskOperations()
  const addTarget = useAddTarget()
  const { today } = useToday()
  const secrets = useSecrets()

  const available = isTauri() && !isOverlayWindow()
  const active = computed(() => available && store.enabled && runtime.host !== null && runtime.tokenPresent)
  /** Nothing may be written while the data file is in a blocking state (ADR 011). */
  const blocked = () => dataState.available && dataState.status !== 'ok'

  function deps(): RemoteBoardDeps {
    return {
      tasks: () => tasksStore.tasks.filter(task => !tasksStore.archivedTaskIds.includes(task.id)),
      today: () => today.value,
      defaultSource: () => addTarget.defaultSource.value,
      createTask: (draft, source) => sync.createTask(draft, source),
      moveToStatus: (id, status) => ops.moveTaskToStatus(id, status),
      async setTimeSpent(taskId, seconds) {
        // Like the sheet's own time edit (`setTimeSpentAndSync`): the total is the truth, an open "Zeit abziehen" question would lower it again.
        const operationVersion = tasksStore.incrementTaskOperationVersion(taskId)
        if (!tasksStore.setTimeSpent(taskId, seconds)) throw new Error('Time could not be written.')
        useDayRecapStore().resolveTimeOffer(taskId)
        const updated = tasksStore.task(taskId)
        if (updated) await sync.syncTaskToIntegration(updated, operationVersion)
      },
      timeSpent: task => liveTimeSpent(task),
      async setTimeBox(taskId, seconds) {
        await sync.editTask(taskId, { timeBoxSeconds: seconds })
      },
    }
  }

  async function uploadSnapshot(force = false): Promise<void> {
    if (!active.value || blocked()) return
    const snapshot = buildSnapshot(deps().tasks(), today.value, dayKey(today.value), task => liveTimeSpent(task))
    const text = JSON.stringify(snapshot)
    if (!force && text === lastUploaded) return
    await request('PUT', '/sync/snapshot', snapshot)
    lastUploaded = text
    runtime.lastSyncAt = Date.now()
  }

  async function applyOne(command: RemoteCommand): Promise<void> {
    let result: { ok: boolean; message: string }
    if (store.wasApplied(command.id)) {
      result = { ok: true, message: 'Applied earlier.' }
    } else {
      result = await applyRemoteCommand(command, deps())
      // Recorded before the report: a report that fails must not make the next poll apply the command again.
      store.markApplied(command.id, Date.now())
    }
    await request('POST', `/sync/commands/${command.id}/result`, result)
  }

  /** One round: fetch, apply, report, upload. Never throws; a failure becomes `runtime.problem`. */
  async function poll(): Promise<void> {
    if (!active.value || polling) return
    if (blocked()) {
      runtime.problem = 'blocked'
      return
    }
    polling = true
    runtime.running = true
    try {
      const { status, body } = await request<unknown>('GET', '/sync/commands')
      if (status !== 200) {
        runtime.problem = 'unreachable'
        return
      }
      for (const command of parseCommands(body)) await applyOne(command)
      await uploadSnapshot(true)
      runtime.problem = null
    } catch (error) {
      runtime.problem = problemOf(error)
    } finally {
      polling = false
      runtime.running = false
    }
  }

  function scheduleSnapshot(): void {
    if (snapshotTimer) clearTimeout(snapshotTimer)
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null
      void uploadSnapshot().catch((error: unknown) => { runtime.problem = problemOf(error) })
    }, SNAPSHOT_DEBOUNCE_MS)
  }

  /** Reads the saved host and whether a token is stored (never its value). */
  async function refresh(): Promise<void> {
    if (!available) return
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      runtime.host = await invoke<string | null>('bridge_host')
      const status = await secrets.status([BRIDGE_SECRET_ENTRY])
      const entry = status[BRIDGE_SECRET_ENTRY]
      runtime.tokenPresent = entry?.state === 'ok' && entry.present
    } catch {
      runtime.host = null
      runtime.tokenPresent = false
    }
    if (active.value) {
      void poll()
    } else {
      lastUploaded = ''
    }
  }

  /** Starts the loop once per window; safe to call from the shell on every mount. */
  function start(): void {
    if (!available || started) return
    started = true
    void refresh()
    timer = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
    window.addEventListener('focus', () => { void poll() })
    // The board's own changes: a cheap key first, the snapshot is built only when the timer fires.
    stopWatch = watch(
      () => tasksStore.tasks.map(task => `${task.id}:${task.status}:${task.title}:${task.timeBoxSeconds ?? ''}:${task.timeSpentSeconds}`).join('|'),
      () => { if (active.value) scheduleSnapshot() },
    )
  }

  function stop(): void {
    if (timer) clearInterval(timer)
    if (snapshotTimer) clearTimeout(snapshotTimer)
    timer = null
    snapshotTimer = null
    stopWatch?.()
    stopWatch = null
    started = false
  }

  /** Saves the Worker address and the token (settings page); the token goes to the Keychain through Rust and is never kept here. */
  async function connect(url: string, token: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke<string>('bridge_configure', { url })
    await secrets.set(BRIDGE_SECRET_ENTRY, token)
    store.setEnabled(true)
    await refresh()
  }

  async function disconnect(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    store.setEnabled(false)
    await invoke('bridge_clear')
    await secrets.remove(BRIDGE_SECRET_ENTRY)
    runtime.problem = null
    runtime.lastSyncAt = null
    await refresh()
  }

  function setEnabled(value: boolean): void {
    store.setEnabled(value)
    if (value) void refresh()
  }

  return { available, state: readonly(runtime), enabled: computed(() => store.enabled), active, start, stop, refresh, poll, connect, disconnect, setEnabled }
}

/** Test hook: forgets the module-level loop state between tests. */
export function resetRemoteBridgeForTests(): void {
  if (timer) clearInterval(timer)
  if (snapshotTimer) clearTimeout(snapshotTimer)
  timer = snapshotTimer = null
  started = polling = false
  lastUploaded = ''
  stopWatch?.()
  stopWatch = null
  Object.assign(runtime, { host: null, tokenPresent: false, running: false, problem: null, lastSyncAt: null })
}

