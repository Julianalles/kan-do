import { describe, it, expect } from 'vitest'
import { MAX_TOPIC_ROWS, timeBoxGroupOf, timeBoxGroups, topicRows } from '~/utils/dayClose'

const MIN = 60
const done = (topic: string | null) => ({ topic })
const boxed = (box: number, spent: number) => ({ timeBoxSeconds: box, timeSpentSeconds: spent })

describe('timeBoxGroupOf: "about within" = the larger of 5 minutes and 20 % of the box', () => {
  it('a 10-minute box: 5 minutes decide (20 % would be 2)', () => {
    expect(timeBoxGroupOf(boxed(10 * MIN, 15 * MIN))).toBe('within') // exactly 5 minutes over
    expect(timeBoxGroupOf(boxed(10 * MIN, 15 * MIN + 1))).toBe('over')
    expect(timeBoxGroupOf(boxed(10 * MIN, 5 * MIN))).toBe('within') // exactly 5 minutes under
    expect(timeBoxGroupOf(boxed(10 * MIN, 5 * MIN - 1))).toBe('under')
  })

  it('a 3-hour box: 20 % decide (36 minutes)', () => {
    expect(timeBoxGroupOf(boxed(180 * MIN, 180 * MIN + 36 * MIN))).toBe('within') // exactly 20 % over
    expect(timeBoxGroupOf(boxed(180 * MIN, 180 * MIN + 36 * MIN + 1))).toBe('over')
    expect(timeBoxGroupOf(boxed(180 * MIN, 180 * MIN - 36 * MIN))).toBe('within')
    expect(timeBoxGroupOf(boxed(180 * MIN, 180 * MIN - 36 * MIN - 1))).toBe('under')
    expect(timeBoxGroupOf(boxed(180 * MIN, 180 * MIN))).toBe('within')
  })
})

describe('timeBoxGroups', () => {
  it('counts only done tasks with a timebox and tracked time', () => {
    const groups = timeBoxGroups([
      boxed(60 * MIN, 20 * MIN), // under
      boxed(60 * MIN, 65 * MIN), // within
      boxed(60 * MIN, 62 * MIN), // within
      boxed(60 * MIN, 120 * MIN), // over
      { timeBoxSeconds: 60 * MIN, timeSpentSeconds: 0 }, // no tracked time
      { timeBoxSeconds: null, timeSpentSeconds: 600 }, // no box
    ])
    expect(groups).toEqual({ under: 1, within: 2, over: 1, total: 4 })
  })

  it('has no base without such tasks: no chart', () => {
    expect(timeBoxGroups([]).total).toBe(0)
    expect(timeBoxGroups([{ timeBoxSeconds: null, timeSpentSeconds: 0 }]).total).toBe(0)
  })
})

describe('topicRows', () => {
  it('is empty without a named topic (all unnamed, or nothing done)', () => {
    expect(topicRows([])).toEqual([])
    expect(topicRows([done(null), done('  '), done('')])).toEqual([])
  })

  it('one topic: one row; the tasks without a topic are their own last row', () => {
    expect(topicRows([done('A'), done('A'), done(null)])).toEqual([
      { key: 'A', kind: 'topic', count: 2, step: 0 },
      { key: '__none__', kind: 'none', count: 1, step: MAX_TOPIC_ROWS },
    ])
  })

  it('orders by count, ties by name; the fifth topic on folds into "Sonstiges", "Ohne Thema" stays last and unfolded', () => {
    const tasks = [
      ...Array(3).fill(done('Zeta')), ...Array(3).fill(done('Alpha')), done('Beta'), done('Beta'),
      done('C'), done('D'), done('E'), done('F'), done(null),
    ]
    const rows = topicRows(tasks)
    expect(rows.map(row => [row.key, row.count])).toEqual([
      ['Alpha', 3], ['Zeta', 3], ['Beta', 2], ['C', 1], ['__other__', 3], ['__none__', 1],
    ])
    expect(rows.map(row => row.step)).toEqual([0, 1, 2, 3, 4, 4])
    expect(rows.map(row => row.kind)).toEqual(['topic', 'topic', 'topic', 'topic', 'other', 'none'])
  })

  it('exactly four topics need no "Sonstiges"', () => {
    expect(topicRows([done('A'), done('B'), done('C'), done('D')]).map(row => row.kind)).toEqual(['topic', 'topic', 'topic', 'topic'])
  })
})
