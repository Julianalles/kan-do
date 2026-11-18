/**
 * @module dayClose
 * @description Pure helpers for the day-close stage (#98, #480): how the done tasks compare with their timebox (three groups)
 * and how they spread over topics. No store, no i18n runtime: the stage turns the keys into labels.
 */
import type { Task } from '~/types/task'

/** The least spent and planned time may differ and still count as "about within the timebox" (5 min). */
export const TIMEBOX_TOLERANCE_SECONDS = 300

/** The share of the timebox that may differ and still count as "about within the timebox" (20 %). */
export const TIMEBOX_TOLERANCE_SHARE = 0.2

/** The topic rows the topic chart names before it folds the rest into "Sonstiges". */
export const MAX_TOPIC_ROWS = 4

type Boxed = Pick<Task, 'timeSpentSeconds' | 'timeBoxSeconds'>

/** A task has a timebox that counts for the day close only when time was tracked against it. */
export function hasTimeBoxFact<T extends Boxed>(task: T): task is T & { timeBoxSeconds: number } {
  return !!task.timeBoxSeconds && task.timeBoxSeconds > 0 && task.timeSpentSeconds > 0
}

export type TimeBoxGroup = 'under' | 'within' | 'over'

/**
 * How a task with a timebox fact compares with its box: "within" while the difference is at most the larger of 5 minutes and
 * 20 % of the box (the one definition of "about in the timebox"), else "under" (shorter) or "over" (longer).
 */
export function timeBoxGroupOf(task: Boxed & { timeBoxSeconds: number }): TimeBoxGroup {
  const tolerance = Math.max(TIMEBOX_TOLERANCE_SECONDS, task.timeBoxSeconds * TIMEBOX_TOLERANCE_SHARE)
  const diff = task.timeSpentSeconds - task.timeBoxSeconds
  if (Math.abs(diff) <= tolerance) return 'within'
  return diff > 0 ? 'over' : 'under'
}

export interface TimeBoxGroups {
  /** Tasks well under their box. */
  under: number
  /** Tasks about within it. */
  within: number
  /** Tasks well over it. */
  over: number
  /** The tasks counted: done tasks with a timebox and tracked time (the chart's base). */
  total: number
}

/** The Timebox chart's three counts for the done tasks; `total` is 0 when no task has a timebox and tracked time (no chart). */
export function timeBoxGroups(done: readonly Boxed[]): TimeBoxGroups {
  const groups: TimeBoxGroups = { under: 0, within: 0, over: 0, total: 0 }
  for (const task of done) {
    if (!hasTimeBoxFact(task)) continue
    groups[timeBoxGroupOf(task)] += 1
    groups.total += 1
  }
  return groups
}

export type TopicRowKind = 'topic' | 'other' | 'none'

export interface TopicRow {
  /** The topic name for a `topic` row; stable key otherwise. */
  key: string
  kind: TopicRowKind
  /** Done tasks in the row. */
  count: number
  /** Step of the ink ramp (0 = darkest): named topics by rank, "Sonstiges" and "Ohne Thema" the lightest used step (18 %: the next one, 10 %, is below 3:1 on the white sheet). */
  step: number
}

/**
 * The Themen chart's rows for the done tasks, by number of tasks (a task without tracked time still counts): the named topics
 * by count (ties: name order), the first four shown and the rest folded into "Sonstiges"; "Ohne Thema" is its own row, always
 * last and never folded. Empty when no done task has a topic (no chart).
 */
export function topicRows(done: readonly Pick<Task, 'topic'>[]): TopicRow[] {
  const named = new Map<string, number>()
  let none = 0
  for (const task of done) {
    const topic = task.topic?.trim()
    if (topic) named.set(topic, (named.get(topic) ?? 0) + 1)
    else none += 1
  }
  if (named.size === 0) return []
  const ranked = [...named.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const rows: TopicRow[] = ranked.slice(0, MAX_TOPIC_ROWS).map(([key, count], index) => ({ key, kind: 'topic', count, step: index }))
  const rest = ranked.slice(MAX_TOPIC_ROWS).reduce((sum, [, count]) => sum + count, 0)
  if (rest > 0) rows.push({ key: '__other__', kind: 'other', count: rest, step: MAX_TOPIC_ROWS })
  if (none > 0) rows.push({ key: '__none__', kind: 'none', count: none, step: MAX_TOPIC_ROWS })
  return rows
}
