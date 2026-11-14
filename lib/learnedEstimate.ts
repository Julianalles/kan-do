/**
 * @module lib/learnedEstimate
 * @description What a card without a time box usually takes, learned from finished tasks (#302): the weighted median of
 * the actual time of the best similar records (title similarity, activity and topic, `lib/timeboxSimilarity`), rounded
 * to 5 minutes and clamped to 5-240. Needs `LEARNED.MIN_MATCHES` similar records, else there is no estimate (null) and
 * the caller keeps its fixed default. Reads the existing `completionRecords` as they are: a record that is not an
 * object, has no title or no usable time is skipped, never thrown on (old or hand-edited data). Pure: `createEstimator`
 * tokenizes the records once; the returned function is cheap per card and caches per card.
 */
import { SIMILARITY, normalizeAndTokenize, similarityScore, weightedMedian, type Comparable } from '~/lib/timeboxSimilarity'

export const LEARNED = {
  /** Similar finished tasks needed before a learned value is used (below: no estimate). */
  MIN_MATCHES: 3,
  /** A record with less time than this (seconds) says nothing about how long a task takes. */
  MIN_RECORD_SECONDS: 60,
  /** The learned value is rounded to this many minutes. */
  ROUND_MINUTES: 5,
  MIN_MINUTES: 5,
  MAX_MINUTES: 240,
} as const

/** The fields of a card the estimate reads; a card without a usable title has no estimate. */
export interface EstimateInput {
  id?: string
  title?: string | null
  activity?: string | null
  topic?: string | null
}

/** Minutes a card of this kind usually takes, or null when there is too little to learn from. */
export type Estimator = (task: EstimateInput) => number | null

interface Learnt extends Comparable {
  taskId: string | null
  minutes: number
  tokens: Set<string>
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

function usableRecord(raw: unknown): Learnt | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const title = text(record.title)
  const seconds = record.actualTimeSpentSeconds
  if (!title || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < LEARNED.MIN_RECORD_SECONDS) return null
  return {
    taskId: typeof record.taskId === 'string' ? record.taskId : null,
    title,
    activity: text(record.activity),
    topic: text(record.topic),
    minutes: seconds / 60,
    tokens: normalizeAndTokenize(title),
  }
}

/** Builds the estimator over the given `completionRecords` (anything but a list reads as no history). */
export function createEstimator(records: unknown): Estimator {
  const history = (Array.isArray(records) ? records : []).map(usableRecord).filter((r): r is Learnt => r !== null)
  const cache = new Map<string, number | null>()

  return (task) => {
    const title = text(task.title)
    if (!title || history.length < LEARNED.MIN_MATCHES) return null
    const input: Comparable = { title, activity: text(task.activity), topic: text(task.topic), tokens: normalizeAndTokenize(title) }
    const key = [task.id ?? '', title, input.activity ?? '', input.topic ?? ''].join('\u0000')
    const known = cache.get(key)
    if (known !== undefined) return known

    const similar = history
      .filter(record => task.id === undefined || record.taskId !== task.id)
      .map(record => ({ record, score: similarityScore(input, record) }))
      .filter(match => match.score >= SIMILARITY.MIN_SCORE)
      .sort((a, b) => b.score - a.score)
    let estimate: number | null = null
    if (similar.length >= LEARNED.MIN_MATCHES) {
      const median = weightedMedian(similar.slice(0, SIMILARITY.MAX_SIMILAR_TASKS).map(m => ({ minutes: m.record.minutes, weight: m.score })))
      const rounded = Math.round(median / LEARNED.ROUND_MINUTES) * LEARNED.ROUND_MINUTES
      estimate = Math.min(Math.max(rounded, LEARNED.MIN_MINUTES), LEARNED.MAX_MINUTES)
    }
    cache.set(key, estimate)
    return estimate
  }
}
