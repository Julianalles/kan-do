import { describe, expect, it } from 'vitest'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { applyRemoteCommand, buildSnapshot, findTaskByTitle, type RemoteBoardDeps, type RemoteCommand } from '~/lib/remoteCommands'

const task = (id: string, title: string, status = TaskStatus.Open, extra: Partial<Task> = {}): Task => ({
  id, title, status, source: 'local', externalId: null, activity: null, topic: null, topicColorCode: null, priority: 0, notes: null,
  timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
})

function makeDeps(initial: Task[]) {
  const tasks = [...initial]
  const calls: string[] = []
  let refuse = false
  const deps: RemoteBoardDeps = {
    tasks: () => tasks,
    today: () => new Date('2026-11-26T00:00:00'),
    defaultSource: () => 'local',
    async createTask(draft) {
      const created = task(`new-${tasks.length}`, draft.title!, draft.status ?? TaskStatus.Open, draft)
      tasks.push(created)
      calls.push(`create ${created.title} ${TaskStatus[created.status]}`)
      return created
    },
    async moveToStatus(id, status) {
      if (refuse) return false
      const t = tasks.find(x => x.id === id)!
      t.status = status
      calls.push(`move ${t.title} ${TaskStatus[status]}`)
      return true
    },
    async setTimeSpent(id, seconds) {
      tasks.find(x => x.id === id)!.timeSpentSeconds = seconds
      calls.push(`time ${id} ${seconds}`)
    },
    timeSpent: t => t.timeSpentSeconds,
    async setTimeBox(id, seconds) {
      tasks.find(x => x.id === id)!.timeBoxSeconds = seconds
      calls.push(`box ${id} ${seconds}`)
    },
  }
  return { deps, tasks, calls, refuse: () => { refuse = true } }
}

const cmd = (type: RemoteCommand['type'], payload: Record<string, unknown>): RemoteCommand => ({ id: 'c', type, payload })

describe('findTaskByTitle', () => {
  const list = [task('1', 'Angebot Müller'), task('2', 'Angebot Meier'), task('3', 'Größe ÄÖ prüfen'), task('4', 'Schnitt', TaskStatus.Done), task('5', 'Schnitt')]
  it('matches exactly regardless of case, spacing and umlauts', () => {
    expect(findTaskByTitle(list, '  angebot   MÜLLER ')).toMatchObject({ kind: 'found', task: { id: '1' } })
    expect(findTaskByTitle(list, 'größe äö prüfen')).toMatchObject({ kind: 'found', task: { id: '3' } })
  })
  it('prefers the open task over a finished twin', () => {
    expect(findTaskByTitle(list, 'schnitt')).toMatchObject({ kind: 'found', task: { id: '5' } })
  })
  it('matches one partial candidate and refuses to guess between several', () => {
    expect(findTaskByTitle(list, 'prüfen')).toMatchObject({ kind: 'found', task: { id: '3' } })
    expect(findTaskByTitle(list, 'angebot')).toMatchObject({ kind: 'ambiguous' })
    expect(findTaskByTitle(list, 'steuer')).toEqual({ kind: 'none' })
    expect(findTaskByTitle(list, '   ')).toEqual({ kind: 'none' })
  })
})

describe('start_work', () => {
  it('moves an existing task to Jetzt and pauses the current one', async () => {
    const { deps, calls } = makeDeps([task('1', 'Alt', TaskStatus.Progress), task('2', 'Neu')])
    const result = await applyRemoteCommand(cmd('start_work', { title: 'neu' }), deps)
    expect(result.ok).toBe(true)
    expect(calls).toEqual(['move Alt Waiting', 'move Neu Progress'])
  })
  it('creates a missing task first', async () => {
    const { deps, calls } = makeDeps([])
    const result = await applyRemoteCommand(cmd('start_work', { title: 'Büro-Größe', timeBoxMinutes: 30 }), deps)
    expect(result.message).toContain('created')
    expect(calls).toEqual(['create Büro-Größe Open', 'move Büro-Größe Progress'])
    expect(deps.tasks()[0]!.timeBoxSeconds).toBe(1800)
  })
  it('does nothing for a task already in Jetzt', async () => {
    const { deps, calls } = makeDeps([task('1', 'A', TaskStatus.Progress)])
    expect((await applyRemoteCommand(cmd('start_work', { title: 'A' }), deps)).message).toContain('already')
    expect(calls).toEqual([])
  })
  it('fails when the move is refused', async () => {
    const { deps, refuse } = makeDeps([task('1', 'A')])
    refuse()
    expect((await applyRemoteCommand(cmd('start_work', { title: 'A' }), deps)).ok).toBe(false)
  })
  it('asks instead of guessing on an ambiguous title', async () => {
    const { deps, calls } = makeDeps([task('1', 'Angebot A'), task('2', 'Angebot B')])
    const result = await applyRemoteCommand(cmd('start_work', { title: 'angebot' }), deps)
    expect(result.ok).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('log_time', () => {
  it('adds to the total of an existing task without moving it', async () => {
    const { deps, calls } = makeDeps([task('1', 'Schnitt', TaskStatus.Waiting, { timeSpentSeconds: 600 })])
    const result = await applyRemoteCommand(cmd('log_time', { title: 'Schnitt', minutes: 45 }), deps)
    expect(result.ok).toBe(true)
    expect(calls).toEqual(['time 1 3300'])
  })
  it('creates a missing task as Erledigt on the given day', async () => {
    const { deps, tasks } = makeDeps([])
    await applyRemoteCommand(cmd('log_time', { title: 'Grading', minutes: 45, day: '2026-11-25' }), deps)
    expect(tasks[0]).toMatchObject({ status: TaskStatus.Done, timeSpentSeconds: 2700 })
    expect(new Date(tasks[0]!.completedAt!).getDate()).toBe(25)
  })
  it('rejects bad input', async () => {
    const { deps, calls } = makeDeps([])
    expect((await applyRemoteCommand(cmd('log_time', { title: 'X', minutes: 0 }), deps)).ok).toBe(false)
    expect((await applyRemoteCommand(cmd('log_time', { title: 'X', minutes: 5, day: 'gestern' }), deps)).ok).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('add_task, set_status, set_timebox', () => {
  it('adds a task directly into Wartet', async () => {
    const { deps, calls } = makeDeps([])
    await applyRemoteCommand(cmd('add_task', { title: 'Zahnarzt anrufen', status: 'waiting', topic: 'Privat' }), deps)
    expect(calls).toEqual(['create Zahnarzt anrufen Open', 'move Zahnarzt anrufen Waiting'])
    expect(deps.tasks()[0]!.topic).toBe('Privat')
  })
  it('does not add a duplicate of an open task', async () => {
    const { deps, calls } = makeDeps([task('1', 'Rechnung')])
    expect((await applyRemoteCommand(cmd('add_task', { title: 'rechnung' }), deps)).message).toContain('already exists')
    expect(calls).toEqual([])
  })
  it('sets a status and reports a missing task', async () => {
    const { deps, calls } = makeDeps([task('1', 'Rechnung')])
    expect((await applyRemoteCommand(cmd('set_status', { title: 'Rechnung', status: 'done' }), deps)).ok).toBe(true)
    expect(calls).toEqual(['move Rechnung Done'])
    expect((await applyRemoteCommand(cmd('set_status', { title: 'Nope', status: 'done' }), deps)).ok).toBe(false)
    expect((await applyRemoteCommand(cmd('set_status', { title: 'Rechnung', status: 'later' }), deps)).ok).toBe(false)
  })
  it('sets the time box in seconds', async () => {
    const { deps, calls } = makeDeps([task('1', 'Rechnung')])
    await applyRemoteCommand(cmd('set_timebox', { title: 'Rechnung', minutes: 25 }), deps)
    expect(calls).toEqual(['box 1 1500'])
  })
  it('turns a thrown error into a failed result', async () => {
    const { deps } = makeDeps([task('1', 'A')])
    deps.moveToStatus = async () => { throw new Error('offline') }
    expect(await applyRemoteCommand(cmd('set_status', { title: 'A', status: 'done' }), deps)).toEqual({ ok: false, message: 'offline' })
  })
})

describe('buildSnapshot', () => {
  const today = new Date('2026-11-26T00:00:00')
  it('keeps planned tasks and today\'s finished ones, drops the rest', () => {
    const rows = buildSnapshot([
      task('1', 'Open'),
      task('2', 'Parked', TaskStatus.Open, { notPlanned: true }),
      task('3', 'Done today', TaskStatus.Done, { completedAt: new Date('2026-11-26T09:00:00') }),
      task('4', 'Done before', TaskStatus.Done, { completedAt: new Date('2026-11-20T09:00:00') }),
      task('5', 'Backlog', TaskStatus.Backlog),
      task('6', 'Gone', TaskStatus.Open, { archivedAt: new Date() }),
      task('7', 'Boxed', TaskStatus.Progress, { timeBoxSeconds: 3600, timeSpentSeconds: 1500 }),
    ], today, '2026-11-26', t => t.timeSpentSeconds)
    expect(rows.tasks.map(t => t.id)).toEqual(['1', '3', '7'])
    expect(rows.tasks[2]).toMatchObject({ status: 'progress', timeBoxMinutes: 60, timeSpentMinutes: 25 })
  })
})
