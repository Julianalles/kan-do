/**
 * @module lib/remindersHint
 * @description The hint that explains why a Reminders task is where it is (#553): put back while Reminders still says today,
 * planned by the date the user chose in Reminders, or held by kan-do on another day because it repeats. Pure: the card
 * footer and the sheet read it, nothing else decides it.
 */
import type { Task } from '~/types/task'
import { isNotPlanned } from '~/lib/taskPlanning'
import { wroteOf } from '~/lib/remindersSource'

export type RemindersHintKind = 'putBack' | 'planned' | 'repeats'

export interface RemindersHint {
  kind: RemindersHintKind
  /** Locale key of the sentence */
  key: string
  /** Named values of the sentence (`rule`, already translated by the caller through `ruleOf`) */
  recurrence: string | null
}

/**
 * The hint of a Reminders task, or `null` (every other source, no date to explain). `today` is the local `YYYY-MM-DD`.
 * Put back wins over repeats, which wins over planned: the first is a state the user has to be told about.
 */
export function remindersHint(task: Pick<Task, 'source' | 'reminders' | 'status' | 'notPlanned'>, today: string): RemindersHint | null {
  const reminders = task.reminders
  if (task.source !== 'reminders' || !reminders) return null
  const dueToday = reminders.due?.date === today
  if (isNotPlanned(task as Task)) {
    return dueToday ? { kind: 'putBack', key: 'task.reminders.hint.putBack', recurrence: null } : null
  }
  // On today's board while Reminders says another day: kan-do holds the plan of a series itself
  if (reminders.recurrence && !dueToday) return { kind: 'repeats', key: 'task.reminders.hint.repeats', recurrence: reminders.recurrence }
  // The date is today and the user did not set it here: it is Reminders' plan
  if (dueToday && wroteOf(task as Task) === null) return { kind: 'planned', key: 'task.reminders.hint.planned', recurrence: null }
  return null
}

/** The locale key and count of an RRULE's common shapes (`FREQ=WEEKLY;INTERVAL=2`); `null` for anything else. */
export function ruleKeyOf(rule: string): { key: string; n: number } | null {
  const parts = new Map(rule.split(';').map(part => part.split('=') as [string, string]))
  const interval = Number(parts.get('INTERVAL') ?? 1)
  const names: Record<string, [string, string]> = {
    DAILY: ['daily', 'everyDays'], WEEKLY: ['weekly', 'everyWeeks'], MONTHLY: ['monthly', 'everyMonths'], YEARLY: ['yearly', 'everyYears'],
  }
  const pair = names[parts.get('FREQ') ?? '']
  if (!pair || !Number.isInteger(interval) || interval < 1) return null
  return { key: `task.reminders.rule.${interval === 1 ? pair[0] : pair[1]}`, n: interval }
}
