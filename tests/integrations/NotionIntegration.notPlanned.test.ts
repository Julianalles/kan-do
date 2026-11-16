/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #357: Notion statuses that mean "not planned". Without the mapping nothing changes; with it the pages in those
 * statuses load in a query of their own (sorted, capped) as tasks the source holds as not planned, and a task is
 * written with the "not planned" status it is held in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}))

// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { NotionIntegration, resetStatusTypeCache } from '~/integrations/NotionIntegration'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { NOT_PLANNED_PAGE_LIMIT } from '~/lib/notionLimits'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { TaskStatus } from '~/types/taskStatus'

const propertyMapping = { title: 'Name', status: 'Status' }
const baseStatus = { today: 'Heute', doing: 'Jetzt', waiting: 'Wartet', done: 'Erledigt' }
const makeSut = (notPlanned?: string[] | null) =>
  new NotionIntegration('tkn', 'db1', propertyMapping as any, { ...baseStatus, notPlanned } as any, undefined, 'ds-1')

const page = (id: string, status: string) => ({
  id,
  last_edited_time: '2026-11-01T10:00:00.000Z',
  properties: { Name: { title: [{ plain_text: id }] }, Status: { select: { name: status } } },
})

type QueryBody = { filter?: any; sorts?: any; page_size?: number; start_cursor?: string }
/** Answers the proxy: `board` for the board query, `held(body)` for the sorted "not planned" query. */
const mockProxy = (board: any[], held: (body: QueryBody) => { results: any[]; has_more?: boolean; next_cursor?: string | null } = () => ({ results: [] })) => {
  const queries: QueryBody[] = []
  const writes: Array<{ url: string; body: any }> = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {}
    if (url === '/api/notion/query-data-source') {
      queries.push(body)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body.sorts ? held(body) : { results: board }) })
    }
    if (init?.method === 'PATCH' || url === '/api/notion/create-task') writes.push({ url, body })
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'p1', properties: { Status: { type: 'select', select: { name: 'Heute' } } } }) })
  }))
  return { queries, writes }
}

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1', source: 'notion', externalId: 'p1', title: 'T', notes: null, status: TaskStatus.Open, priority: 2,
  timeBoxSeconds: null, timeSpentSeconds: 0, topic: null, topicColorCode: null, activity: null, timerId: null,
  ...overrides,
}) as any

beforeEach(() => resetStatusTypeCache())
afterEach(() => vi.unstubAllGlobals())

describe('fetch', () => {
  it.each([[undefined], [null], [[]]])('no "not planned" status mapped (%j): one query, as before', async (mapped) => {
    const { queries } = mockProxy([page('a', 'Heute'), page('b', 'Backlog')])
    const sut = makeSut(mapped as any)
    const tasks = await sut.fetchActiveBoardTasks()
    expect(queries).toHaveLength(1)
    expect(queries[0]!.sorts).toBeUndefined()
    expect(tasks.map(t => t.sourceNotPlanned)).toEqual([undefined, undefined])
    expect(sut.notPlannedLimited).toBe(false)
  })

  it('mapped statuses load in a second query, newest edit first, as Open tasks the source holds as not planned', async () => {
    const { queries } = mockProxy([page('a', 'Heute')], () => ({ results: [page('b', 'Backlog'), page('c', 'Irgendwann')] }))
    const sut = makeSut(['Backlog', 'Irgendwann'])
    const tasks = await sut.fetchActiveBoardTasks()
    expect(queries).toHaveLength(2)
    expect(queries[0]!.filter.or).toHaveLength(4)
    expect(queries[1]!.filter.or).toEqual([
      { property: 'Status', select: { equals: 'Backlog' } },
      { property: 'Status', select: { equals: 'Irgendwann' } },
    ])
    expect(queries[1]!.sorts).toEqual([{ timestamp: 'last_edited_time', direction: 'descending' }])
    expect(tasks.map(t => [t.id, t.status, t.sourceNotPlanned])).toEqual([
      ['a', TaskStatus.Open, undefined], ['b', TaskStatus.Open, 'Backlog'], ['c', TaskStatus.Open, 'Irgendwann'],
    ])
    expect(sut.notPlannedLimited).toBe(false)
  })

  it('a page both queries return is taken once, and a row the filter did not ask for is left out', async () => {
    mockProxy([page('a', 'Heute'), page('b', 'Backlog')], () => ({ results: [page('b', 'Backlog'), page('a', 'Heute'), page('x', 'Sonstwas')] }))
    const tasks = await makeSut(['Backlog']).fetchActiveBoardTasks()
    expect(tasks.map(t => [t.id, t.sourceNotPlanned])).toEqual([['a', undefined], ['b', 'Backlog']])
  })

  it(`loads at most ${NOT_PLANNED_PAGE_LIMIT} "not planned" pages and says that Notion has more`, async () => {
    let served = 0
    const { queries } = mockProxy([], (body) => {
      const size = body.page_size ?? 100
      const results = Array.from({ length: size }, (_, index) => page(`h${served + index}`, 'Backlog'))
      served += size
      return { results, has_more: true, next_cursor: `c${served}` }
    })
    const sut = makeSut(['Backlog'])
    const tasks = await sut.fetchActiveBoardTasks()
    expect(tasks).toHaveLength(NOT_PLANNED_PAGE_LIMIT)
    expect(sut.notPlannedLimited).toBe(true)
    // the board query plus exactly the pages the limit needs
    expect(queries.length - 1).toBe(Math.ceil(NOT_PLANNED_PAGE_LIMIT / 100))
  })

  it('exactly the limit without more in Notion is not reported as limited', async () => {
    let calls = 0
    mockProxy([], (body) => {
      calls++
      const last = calls === NOT_PLANNED_PAGE_LIMIT / 100
      return { results: Array.from({ length: body.page_size ?? 100 }, (_, index) => page(`h${calls}-${index}`, 'Backlog')), has_more: !last, next_cursor: last ? null : `c${calls}` }
    })
    const sut = makeSut(['Backlog'])
    expect(await sut.fetchActiveBoardTasks()).toHaveLength(NOT_PLANNED_PAGE_LIMIT)
    expect(sut.notPlannedLimited).toBe(false)
  })
})

describe('status writes', () => {
  const writtenStatus = (writes: Array<{ body: any }>) => writes.at(-1)!.body.properties.Status.select.name

  it('a task put back is written as the "not planned" status it is held in, the second mapped one included', async () => {
    const { writes } = mockProxy([])
    const sut = makeSut(['Backlog', 'Irgendwann'])
    await sut.updateTask(task({ notPlanned: true, sourceNotPlanned: 'Backlog' }))
    expect(writtenStatus(writes)).toBe('Backlog')
    await sut.updateTask(task({ notPlanned: true, sourceNotPlanned: 'Irgendwann' }))
    expect(writtenStatus(writes)).toBe('Irgendwann')
  })

  it('a task kan-do holds as not planned by itself (no source value) keeps the today status', async () => {
    const { writes } = mockProxy([])
    await makeSut(['Backlog']).updateTask(task({ notPlanned: true }))
    expect(writtenStatus(writes)).toBe('Heute')
  })

  it('a planned task with a stale source value, a status no longer mapped and every other column are written as before', async () => {
    const { writes } = mockProxy([])
    const sut = makeSut(['Backlog'])
    await sut.updateTask(task({ sourceNotPlanned: 'Backlog' }))
    expect(writtenStatus(writes)).toBe('Heute')
    await sut.updateTask(task({ notPlanned: true, sourceNotPlanned: 'Entfernt' }))
    expect(writtenStatus(writes)).toBe('Heute')
    await sut.updateTask(task({ status: TaskStatus.Progress, notPlanned: true, sourceNotPlanned: 'Backlog' }))
    expect(writtenStatus(writes)).toBe('Jetzt')
    await makeSut().updateTask(task({ notPlanned: true, sourceNotPlanned: 'Backlog' }))
    expect(writtenStatus(writes)).toBe('Heute')
  })

  it('a task made as not planned is created with the first mapped status', async () => {
    const { writes } = mockProxy([])
    await makeSut(['Backlog', 'Irgendwann']).createTask({ title: 'Neu', status: TaskStatus.Open, notPlanned: true, sourceNotPlanned: 'Backlog' })
    expect(writes.find(write => write.url === '/api/notion/create-task')!.body.properties.Status.select.name).toBe('Backlog')
    await makeSut(['Backlog']).createTask({ title: 'Neu', status: TaskStatus.Open })
    expect(writes.filter(write => write.url === '/api/notion/create-task').at(-1)!.body.properties.Status.select.name).toBe('Heute')
  })
})
