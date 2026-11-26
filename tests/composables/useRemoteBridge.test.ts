/**
 * ADR 023: the desktop bridge applies queued commands once, reports each result, uploads the board, and stays out of the way
 * when it is off, unconfigured, on the web or while the data file is blocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { useRemoteBridgeStore } from '~/store/remoteBridge'
import { dataState } from '~/lib/dataStorage'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

type Call = { cmd: string; args: Record<string, unknown> }
const calls: Call[] = []
let commands: unknown[] = []
let requestFails: { kind: string } | null = null
let failResultReports = false
let host: string | null = 'mcp.example.com'
let tokenPresent = true

const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  calls.push({ cmd, args })
  if (cmd === 'bridge_host') return host
  if (cmd === 'secret_status') return { 'mcp-sync-token': { state: 'ok', present: tokenPresent, last4: 'abcd', rejected: false, source: 'keychain' } }
  if (cmd === 'bridge_request') {
    if (requestFails) throw requestFails
    if (failResultReports && String(args.path).endsWith('/result')) throw { kind: 'network' }
    if (args.method === 'GET') return { status: 200, body: { commands } }
    return { status: 200, body: { ok: true } }
  }
  return null
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }))

const moveTaskToStatus = vi.fn(async (id: string, status: TaskStatus) => {
  useTasksStore().updateTask(id, { status })
  return true
})
const createTask = vi.fn(async (draft: Partial<Task>) => {
  const task = makeTask(`new-${createTask.mock.calls.length}`, draft)
  useTasksStore().tasks.push(task)
  return task
})
vi.mock('~/composables/useTaskOperations', () => ({ useTaskOperations: () => ({ moveTaskToStatus }) }))
vi.mock('~/composables/useTaskSync', () => ({
  useTaskSync: () => ({ createTask, editTask: vi.fn(async () => true), syncTaskToIntegration: vi.fn(async () => undefined) }),
}))
vi.mock('~/composables/useAddTarget', () => ({ useAddTarget: () => ({ defaultSource: { value: 'local' } }) }))

// eslint-disable-next-line import/first -- the mocks above must be registered before the composable loads
import { resetRemoteBridgeForTests, useRemoteBridge } from '~/composables/useRemoteBridge'

function makeTask(id: string, extra: Partial<Task> = {}): Task {
  return {
    id, source: 'local', externalId: null, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null,
    topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
  }
}

const requests = () => calls.filter(c => c.cmd === 'bridge_request').map(c => `${c.args.method} ${c.args.path}`)
const results = () => calls.filter(c => c.cmd === 'bridge_request' && String(c.args.path).endsWith('/result')).map(c => ({ path: c.args.path, body: c.args.body as { ok: boolean; message: string } }))

describe('useRemoteBridge (ADR 023)', () => {
  let wrapper: VueWrapper | null = null
  let bridge: ReturnType<typeof useRemoteBridge>

  async function mountBridge() {
    wrapper = mount(defineComponent({ setup() { bridge = useRemoteBridge(); return () => null } }))
    await bridge.refresh()
    await flushPromises()
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    calls.length = 0
    commands = []
    requestFails = null
    failResultReports = false
    host = 'mcp.example.com'
    tokenPresent = true
    dataState.available = false
    dataState.status = 'ok'
    moveTaskToStatus.mockClear()
    createTask.mockClear()
    resetRemoteBridgeForTests()
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('does nothing while the switch is off', async () => {
    await mountBridge()
    await bridge.poll()
    expect(requests()).toEqual([])
    expect(bridge.active.value).toBe(false)
  })

  it('does nothing without a saved address or without a token', async () => {
    useRemoteBridgeStore().setEnabled(true)
    host = null
    await mountBridge()
    await bridge.poll()
    expect(requests()).toEqual([])
    host = 'mcp.example.com'
    tokenPresent = false
    resetRemoteBridgeForTests()
    await bridge.refresh()
    await bridge.poll()
    expect(requests()).toEqual([])
  })

  it('does nothing on the web', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    useRemoteBridgeStore().setEnabled(true)
    await mountBridge()
    await bridge.poll()
    expect(bridge.available).toBe(false)
    expect(calls).toEqual([])
  })

  it('applies a queued command, reports the result and uploads the board', async () => {
    useRemoteBridgeStore().setEnabled(true)
    useTasksStore().tasks.push(makeTask('a', { title: 'Schnitt' }))
    commands = [{ id: 'c1', type: 'start_work', payload: { title: 'schnitt' } }]
    await mountBridge()
    expect(requests()).toEqual(['GET /sync/commands', 'POST /sync/commands/c1/result', 'PUT /sync/snapshot'])
    expect(useTasksStore().task('a')?.status).toBe(TaskStatus.Progress)
    expect(results()[0]!.body.ok).toBe(true)
    const upload = calls.find(c => c.args.path === '/sync/snapshot')!.args.body as { tasks: { title: string; status: string }[] }
    expect(upload.tasks).toMatchObject([{ title: 'Schnitt', status: 'progress' }])
  })

  it('applies a command only once even when the Worker lists it again', async () => {
    useRemoteBridgeStore().setEnabled(true)
    useTasksStore().tasks.push(makeTask('a', { title: 'Schnitt' }))
    commands = [{ id: 'c1', type: 'log_time', payload: { title: 'Schnitt', minutes: 10 } }]
    await mountBridge()
    await bridge.poll()
    const total = useTasksStore().task('a')?.timeSpentSeconds
    expect(total).toBe(600)
    expect(results().map(r => r.body.message).slice(-1)[0]).toBe('Applied earlier.')
  })

  it('records the id even when the report fails, so the next poll does not apply it again', async () => {
    useRemoteBridgeStore().setEnabled(true)
    useTasksStore().tasks.push(makeTask('a', { title: 'Schnitt' }))
    commands = [{ id: 'c9', type: 'log_time', payload: { title: 'Schnitt', minutes: 5 } }]
    failResultReports = true
    await mountBridge()
    expect(useTasksStore().task('a')?.timeSpentSeconds).toBe(300)
    expect(useRemoteBridgeStore().wasApplied('c9')).toBe(true)
    expect(bridge.state.problem).toBe('network')
    failResultReports = false
    await bridge.poll()
    expect(useTasksStore().task('a')?.timeSpentSeconds).toBe(300)
    expect(results().slice(-1)[0]!.body.message).toBe('Applied earlier.')
  })

  it('leaves commands queued while the data file is blocked', async () => {
    useRemoteBridgeStore().setEnabled(true)
    commands = [{ id: 'c1', type: 'add_task', payload: { title: 'X' } }]
    await mountBridge()
    calls.length = 0
    dataState.available = true
    dataState.status = 'conflict'
    await bridge.poll()
    expect(requests()).toEqual([])
    expect(bridge.state.problem).toBe('blocked')
    expect(createTask).toHaveBeenCalledTimes(1) // only the earlier, unblocked round
  })

  it('maps a transport failure to a fixed problem key and applies nothing', async () => {
    useRemoteBridgeStore().setEnabled(true)
    await mountBridge()
    requestFails = { kind: 'rejected' }
    await bridge.poll()
    expect(bridge.state.problem).toBe('rejected')
    requestFails = { kind: 'network' }
    await bridge.poll()
    expect(bridge.state.problem).toBe('network')
  })

  it('skips a malformed command list without failing', async () => {
    useRemoteBridgeStore().setEnabled(true)
    commands = [null, { id: 1 }, { id: 'ok', type: 'nope', payload: {} }]
    await mountBridge()
    expect(results()).toEqual([])
    expect(bridge.state.problem).toBeNull()
  })

  it('connect saves the address and the token through Rust, never keeping the token', async () => {
    await mountBridge()
    await bridge.connect('https://mcp.example.com', 'tok-secret')
    const cmds = calls.map(c => c.cmd)
    expect(cmds).toContain('bridge_configure')
    expect(calls.find(c => c.cmd === 'secret_set')?.args).toEqual({ entry: 'mcp-sync-token', value: 'tok-secret' })
    expect(useRemoteBridgeStore().enabled).toBe(true)
    expect(JSON.stringify(bridge.state)).not.toContain('tok-secret')
  })

  it('disconnect forgets the address and removes the token', async () => {
    useRemoteBridgeStore().setEnabled(true)
    await mountBridge()
    await bridge.disconnect()
    const cmds = calls.map(c => c.cmd)
    expect(cmds).toContain('bridge_clear')
    expect(calls.find(c => c.cmd === 'secret_delete')?.args).toEqual({ entry: 'mcp-sync-token' })
    expect(useRemoteBridgeStore().enabled).toBe(false)
  })
})
