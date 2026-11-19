/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}))

// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { NotionIntegration, resetStatusTypeCache } from '~/integrations/NotionIntegration'

const mapping = { title: 'Name', status: 'Status' }
const statusMapping = { today: 'Heute', doing: 'Jetzt', waiting: 'Wartet', done: 'Erledigt' }
const sut = () => new NotionIntegration('tkn', 'db1', mapping as any, statusMapping as any, undefined, 'ds-123')

const SINCE = Date.parse('2026-11-19T10:00:00.000Z')
const page = (id: string, title: string, createdAt: string) => ({
  id, created_time: createdAt, last_edited_time: createdAt,
  properties: { Name: { title: [{ plain_text: title }] } },
})

/** Answers the data-source query proxy with `results` and returns the bodies the client sent */
const answerQuery = (results: unknown[]) => {
  const bodies: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    if (url === '/api/notion/query-data-source') {
      bodies.push(JSON.parse(init.body))
      return { ok: true, json: async () => ({ results, has_more: false }) }
    }
    throw new Error(`unexpected ${url}`)
  }))
  return bodies
}

describe('NotionIntegration.findLandedPage (#528)', () => {
  beforeEach(() => resetStatusTypeCache())
  afterEach(() => vi.unstubAllGlobals())

  it('asks for a page with the title, created since the doubtful create less the clock slack, oldest first', async () => {
    const bodies = answerQuery([])
    expect(await sut().findLandedPage('Rückruf', SINCE)).toBeNull()
    expect(bodies).toHaveLength(1)
    expect(bodies[0].filter).toEqual({
      and: [
        { property: 'Name', title: { equals: 'Rückruf' } },
        { timestamp: 'created_time', created_time: { on_or_after: new Date(SINCE - 5 * 60 * 1000).toISOString() } },
      ],
    })
    expect(bodies[0].sorts).toEqual([{ timestamp: 'created_time', direction: 'ascending' }])
  })

  it('returns the oldest matching page', async () => {
    answerQuery([
      page('later', 'Rückruf', '2026-11-19T10:00:30.000Z'),
      page('first', 'Rückruf', '2026-11-19T10:00:10.000Z'),
    ])
    expect(await sut().findLandedPage('Rückruf', SINCE)).toBe('first')
  })

  it('never returns a page another task holds', async () => {
    answerQuery([
      page('held', 'Rückruf', '2026-11-19T10:00:10.000Z'),
      page('free', 'Rückruf', '2026-11-19T10:00:30.000Z'),
    ])
    expect(await sut().findLandedPage('Rückruf', SINCE, new Set(['held']))).toBe('free')
    answerQuery([page('held', 'Rückruf', '2026-11-19T10:00:10.000Z')])
    expect(await sut().findLandedPage('Rückruf', SINCE, new Set(['held']))).toBeNull()
  })

  it('does not trust the filter: a page that is older or has another title is not the one', async () => {
    answerQuery([
      page('old', 'Rückruf', '2026-11-19T09:00:00.000Z'),
      page('other', 'Rückruf zwei', '2026-11-19T10:00:10.000Z'),
    ])
    expect(await sut().findLandedPage('Rückruf', SINCE)).toBeNull()
  })

  it('rejects when the query fails: the caller must not create then', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, statusText: 'Bad Request', json: async () => ({}) })))
    await expect(sut().findLandedPage('Rückruf', SINCE)).rejects.toMatchObject({ statusCode: 400 })
  })
})
