/**
 * #383: the main window's half of the floating Now window. One push per change of what the pill shows (never per
 * second), the setting off sends no task, pause and done act on the Jetzt task, and an action for a task that is not
 * in Jetzt any more is ignored. #405: pause moves the task to Wartet and the pill keeps it, paused, until it is resumed,
 * done, replaced by a card in Jetzt, moved on, or the setting turns off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { useSettingsStore } from '~/store/settings'
import { stopTaskTimer, useTaskTimerDriver } from '~/composables/useTaskTimerDriver'
import { disarmAllTaskTimers, isTaskTimerArmed } from '~/lib/taskTimers'
import { clearAllLiveSeconds } from '~/lib/liveTime'
import { OVERLAY_ACTION_EVENT } from '~/lib/nowWindow'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const invoke = vi.fn(async () => null)
let handlers: Array<(event: { payload: unknown }) => void> = []
const unlisten = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => (invoke as (...a: unknown[]) => unknown)(...args) }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    if (name === OVERLAY_ACTION_EVENT) handlers.push(handler)
    return unlisten
  }),
}))
const moveOrSwapToStatus = vi.fn(async (_id: string, _status: TaskStatus) => true)
/** The board's guarded move without its toasts and sync: the status changes synchronously, as in the real one */
const moveTaskToStatus = vi.fn(async (id: string, status: TaskStatus, _options?: { pause?: boolean }) => {
  useTasksStore().updateTask(id, { status })
  return true
})
vi.mock('~/composables/useTaskOperations', () => ({ useTaskOperations: () => ({ moveOrSwapToStatus, moveTaskToStatus }) }))

// eslint-disable-next-line import/first -- the mocks above must be registered before the composable loads
import { useNowWindowSync } from '~/composables/useNowWindowSync'

function makeTask(id: string, extra: Partial<Task> = {}): Task {
  return {
    id, source: 'local', externalId: null, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null,
    topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: 1500, timeSpentSeconds: 0, timerId: null, ...extra,
  }
}

const syncs = () => invoke.mock.calls.filter(call => (call as unknown[])[0] === 'overlay_sync').map(call => (call as unknown as [string, { enabled: boolean; snapshot: Record<string, unknown> | null }])[1])
const fire = (payload: unknown) => handlers.forEach(handler => handler({ payload }))

describe('useNowWindowSync (#383)', () => {
  let tasks: ReturnType<typeof useTasksStore>
  let settings: ReturnType<typeof useSettingsStore>
  let wrapper: VueWrapper | null = null

  async function mountSync() {
    wrapper = mount(defineComponent({ setup() { useNowWindowSync(); return () => null } }))
    await flushPromises()
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    invoke.mockClear(); moveOrSwapToStatus.mockClear(); moveTaskToStatus.mockClear(); unlisten.mockClear()
    handlers = []
    tasks = useTasksStore()
    settings = useSettingsStore()
  })
  afterEach(() => {
    wrapper?.unmount(); wrapper = null
    useTaskTimerDriver().stop()
    disarmAllTaskTimers(); clearAllLiveSeconds()
    vi.useRealTimers()
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('does nothing on the web', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    await mountSync()
    expect(invoke).not.toHaveBeenCalled()
    expect(handlers).toEqual([])
  })

  it('publishes the Jetzt task once mounted, with its timer state', async () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress, timeSpentSeconds: 40 }), makeTask('b')])
    useTaskTimerDriver().start()
    await mountSync()
    expect(syncs()).toHaveLength(1)
    expect(syncs()[0]).toMatchObject({ enabled: true, snapshot: { taskId: 'a', title: 'Task a', timeBoxSeconds: 1500, spentSeconds: 40, running: true, locale: 'de' } })
  })

  it('publishes none when nothing is in Jetzt, and again when a task arrives and leaves (A -> B -> A)', async () => {
    tasks.setTasks([makeTask('a')])
    useTaskTimerDriver().start()
    await mountSync()
    expect(syncs().at(-1)).toMatchObject({ enabled: true, snapshot: null })
    tasks.updateTask('a', { status: TaskStatus.Progress })
    await nextTick(); await flushPromises()
    expect(syncs().at(-1)?.snapshot).toMatchObject({ taskId: 'a', running: true })
    tasks.updateTask('a', { status: TaskStatus.Done })
    await nextTick(); await flushPromises()
    expect(syncs().at(-1)?.snapshot).toBeNull()
  })

  it('sends no task while the setting is off, and the task again when it is switched on', async () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    useTaskTimerDriver().start()
    settings.setFloatingNowEnabled(false)
    await mountSync()
    expect(syncs().at(-1)).toEqual({ enabled: false, snapshot: null })
    settings.setFloatingNowEnabled(true)
    await nextTick(); await flushPromises()
    expect(syncs().at(-1)).toMatchObject({ enabled: true, snapshot: { taskId: 'a' } })
  })

  it('does not push per second: 60 ticks make a push per 10 s checkpoint, not 60', async () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    useTaskTimerDriver().start()
    await mountSync()
    const before = syncs().length
    for (let i = 0; i < 60; i++) { vi.advanceTimersByTime(1000); await nextTick(); await flushPromises() }
    const pushes = syncs().length - before
    expect(pushes).toBeGreaterThan(0)
    expect(pushes).toBeLessThanOrEqual(7)
    // the snapshot carries the live seconds of its moment, so the pill does not lag a checkpoint behind
    expect(syncs().at(-1)?.snapshot?.spentSeconds).toBeGreaterThanOrEqual(50)
  })

  it('pause moves the Jetzt task to Wartet (on top), stops its timer and keeps it in the pill, paused (#405)', async () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress, timeSpentSeconds: 40 })])
    useTaskTimerDriver().start()
    await mountSync()
    fire({ kind: 'toggle-pause', taskId: 'a' })
    await nextTick(); await flushPromises()
    expect(moveTaskToStatus).toHaveBeenCalledWith('a', TaskStatus.Waiting, { pause: true })
    expect(tasks.task('a')!.status).toBe(TaskStatus.Waiting)
    expect(isTaskTimerArmed('a')).toBe(false)
    expect(tasks.task('a')!.timerId).toBeNull()
    expect(syncs().at(-1)?.snapshot).toMatchObject({ taskId: 'a', running: false, spentSeconds: 40 })
  })

  it('resume moves the pinned task back to Jetzt and the pill shows it running', async () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    useTaskTimerDriver().start()
    await mountSync()
    fire({ kind: 'toggle-pause', taskId: 'a' })
    await nextTick(); await flushPromises()
    fire({ kind: 'toggle-pause', taskId: 'a' })
    await nextTick(); await flushPromises()
    expect(moveTaskToStatus).toHaveBeenLastCalledWith('a', TaskStatus.Progress)
    expect(tasks.task('a')!.status).toBe(TaskStatus.Progress)
    expect(isTaskTimerArmed('a')).toBe(true)
    expect(syncs().at(-1)?.snapshot).toMatchObject({ taskId: 'a', running: true })
  })

  it('done on the pinned task takes the board path, and the pill then shows nothing', async () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    useTaskTimerDriver().start()
    await mountSync()
    fire({ kind: 'toggle-pause', taskId: 'a' })
    await nextTick(); await flushPromises()
    moveOrSwapToStatus.mockImplementationOnce(async (id: string) => { tasks.updateTask(id, { status: TaskStatus.Done }); return true })
    fire({ kind: 'done', taskId: 'a' })
    await nextTick(); await flushPromises()
    expect(moveOrSwapToStatus).toHaveBeenCalledWith('a', TaskStatus.Done)
    expect(syncs().at(-1)?.snapshot).toBeNull()
  })

  it('a card in Jetzt replaces the pinned task, which is never shown again (A -> B -> A)', async () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress }), makeTask('b')])
    useTaskTimerDriver().start()
    await mountSync()
    fire({ kind: 'toggle-pause', taskId: 'a' })
    await nextTick(); await flushPromises()
    tasks.updateTask('b', { status: TaskStatus.Progress })
    await nextTick(); await flushPromises()
    expect(syncs().at(-1)?.snapshot).toMatchObject({ taskId: 'b', running: true })
    // b leaves Jetzt: a is waiting, but its pin ended with b's arrival
    tasks.updateTask('b', { status: TaskStatus.Done })
    await nextTick(); await flushPromises()
    expect(syncs().at(-1)?.snapshot).toBeNull()
    // and an action for a is ignored now
    moveTaskToStatus.mockClear()
    fire({ kind: 'toggle-pause', taskId: 'a' })
    await flushPromises()
    expect(moveTaskToStatus).not.toHaveBeenCalled()
  })

  it.each([
    ['moved to Offen', (t: ReturnType<typeof useTasksStore>) => t.updateTask('a', { status: TaskStatus.Open })],
    ['moved to Erledigt', (t: ReturnType<typeof useTasksStore>) => t.updateTask('a', { status: TaskStatus.Done })],
    ['deleted', (t: ReturnType<typeof useTasksStore>) => t.removeTask('a')],
  ])('the pin ends when the paused task is %s', async (_name, move) => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    useTaskTimerDriver().start()
    await mountSync()
    fire({ kind: 'toggle-pause', taskId: 'a' })
    await nextTick(); await flushPromises()
    move(tasks)
    await nextTick(); await flushPromises()
    expect(syncs().at(-1)?.snapshot).toBeNull()
  })

  it('the pin ends when the setting is turned off, and a later switch-on shows nothing', async () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    useTaskTimerDriver().start()
    await mountSync()
    fire({ kind: 'toggle-pause', taskId: 'a' })
    await nextTick(); await flushPromises()
    settings.setFloatingNowEnabled(false)
    await nextTick(); await flushPromises()
    expect(syncs().at(-1)).toEqual({ enabled: false, snapshot: null })
    settings.setFloatingNowEnabled(true)
    await nextTick(); await flushPromises()
    expect(syncs().at(-1)).toEqual({ enabled: true, snapshot: null })
  })

  it('a Jetzt task whose timer is stopped (day close) is still resumed by the pill, not moved', async () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    useTaskTimerDriver().start()
    await mountSync()
    stopTaskTimer('a')
    await nextTick(); await flushPromises()
    fire({ kind: 'toggle-pause', taskId: 'a' })
    await nextTick(); await flushPromises()
    expect(moveTaskToStatus).not.toHaveBeenCalled()
    expect(isTaskTimerArmed('a')).toBe(true)
  })

  it('done takes the board path for the Jetzt task', async () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    useTaskTimerDriver().start()
    await mountSync()
    fire({ kind: 'done', taskId: 'a' })
    await flushPromises()
    expect(moveOrSwapToStatus).toHaveBeenCalledWith('a', TaskStatus.Done)
  })

  it.each([
    ['a task that left Jetzt', { kind: 'done', taskId: 'b' }],
    ['an unknown task', { kind: 'done', taskId: 'zzz' }],
    ['an unknown kind', { kind: 'quit', taskId: 'a' }],
    ['open (handled in Rust)', { kind: 'open', taskId: 'a' }],
    ['a malformed payload', 'done'],
  ])('ignores %s', async (_name, payload) => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress }), makeTask('b', { status: TaskStatus.Waiting })])
    useTaskTimerDriver().start()
    await mountSync()
    fire(payload)
    await flushPromises()
    expect(moveOrSwapToStatus).not.toHaveBeenCalled()
    expect(isTaskTimerArmed('a')).toBe(true)
  })

  it('stops listening and pushing when the host unmounts', async () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    await mountSync()
    wrapper!.unmount(); wrapper = null
    expect(unlisten).toHaveBeenCalled()
    const before = syncs().length
    tasks.updateTask('a', { title: 'Renamed' })
    await nextTick(); await flushPromises()
    expect(syncs().length).toBe(before)
  })
})
