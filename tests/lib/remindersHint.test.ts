/** #553: the hint that explains why a Reminders task is where it is: put back, planned by Reminders' date, a series held here. */
import { describe, it, expect } from 'vitest'
import { remindersHint, ruleKeyOf } from '~/lib/remindersHint'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'

const TODAY = '2026-11-19'
const task = (over: Partial<Pick<Task, 'source' | 'reminders' | 'notPlanned' | 'status'>> = {}) => ({
  source: 'reminders' as const, status: TaskStatus.Open,
  reminders: { due: { date: TODAY, time: null }, recurrence: null, listId: 'L' }, ...over,
})

describe('remindersHint (#553)', () => {
  it('a task put back while Reminders still says today', () => {
    expect(remindersHint(task({ notPlanned: true }), TODAY)?.kind).toBe('putBack')
  })
  it('a put-back task whose date is another day has nothing to explain', () => {
    expect(remindersHint(task({ notPlanned: true, reminders: { due: { date: '2026-12-01', time: null }, recurrence: null, listId: 'L' } }), TODAY)).toBeNull()
  })
  it('a planned task dated today by Reminders: the date is the plan; one kan-do wrote has none', () => {
    expect(remindersHint(task(), TODAY)?.kind).toBe('planned')
    expect(remindersHint(task({ reminders: { due: { date: TODAY, time: null }, recurrence: null, listId: 'L', wrote: { from: null, to: TODAY, at: 1 } } }), TODAY)).toBeNull()
  })
  it('a series held on today\'s board on another day repeats; the rule is passed on', () => {
    const hint = remindersHint(task({ reminders: { due: { date: '2026-11-25', time: null }, recurrence: 'FREQ=WEEKLY;INTERVAL=2', listId: 'L' } }), TODAY)
    expect(hint).toMatchObject({ kind: 'repeats', recurrence: 'FREQ=WEEKLY;INTERVAL=2' })
  })
  it('other sources and tasks without the Reminders side have none', () => {
    expect(remindersHint(task({ source: 'notion' as never }), TODAY)).toBeNull()
    expect(remindersHint({ source: 'reminders', status: TaskStatus.Open, reminders: undefined }, TODAY)).toBeNull()
  })
  it('ruleKeyOf names the common rules and gives up on the rest', () => {
    expect(ruleKeyOf('FREQ=DAILY')).toEqual({ key: 'task.reminders.rule.daily', n: 1 })
    expect(ruleKeyOf('FREQ=WEEKLY;INTERVAL=2')).toEqual({ key: 'task.reminders.rule.everyWeeks', n: 2 })
    expect(ruleKeyOf('FREQ=SECONDLY')).toBeNull()
    expect(ruleKeyOf('')).toBeNull()
  })
})
