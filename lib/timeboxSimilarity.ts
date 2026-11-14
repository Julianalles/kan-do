/**
 * @module lib/timeboxSimilarity
 * @description The similarity scoring behind learned time estimates (`docs/features/timebox-auto-suggestion.md`):
 * title overlap (Jaccard over words without German stop words) weighted by a matching activity (primary) and topic
 * (secondary), and the weighted median of the matches' times. Shared by the time-box suggestion in the task form
 * (`composables/useTimeboxSuggestion`) and the card estimate of the capacity divider (`lib/learnedEstimate`, #302), so
 * both always agree. Pure.
 */

/** Scoring constants shared by every consumer. */
export const SIMILARITY = {
  /** Minimum score for a finished task to count as similar. */
  MIN_SCORE: 0.3,
  /** Multiplier for a matching activity (primary factor). */
  ACTIVITY_MATCH_MULTIPLIER: 3.0,
  /** Multiplier for a matching topic (secondary factor). */
  TOPIC_MATCH_MULTIPLIER: 1.5,
  /** At most this many best matches are used. */
  MAX_SIMILAR_TASKS: 10,
} as const

/** German stop words left out of the title comparison. */
const GERMAN_STOP_WORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des',
  'ein', 'eine', 'einer', 'eines', 'einem', 'einen',
  'und', 'oder', 'aber', 'doch', 'jedoch',
  'für', 'von', 'mit', 'zu', 'an', 'auf', 'in', 'bei',
  'ist', 'sind', 'war', 'waren', 'wird', 'werden',
  'hat', 'haben', 'hatte', 'hatten',
])

/** What is compared: a title with its activity and topic. `tokens` is the title's `normalizeAndTokenize`, when already known. */
export interface Comparable {
  title: string
  activity: string | null
  topic: string | null
  tokens?: Set<string>
}

/** Lower-cased words of a text without stop words and special characters (umlauts stay). */
export function normalizeAndTokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .trim()
      .replace(/[^\wäöüß\s-]/gi, '')
      .split(/[\s-]+/)
      .filter(word => word.length > 0 && !GERMAN_STOP_WORDS.has(word)),
  )
}

/** Jaccard similarity of two word sets: 0 (nothing shared) to 1 (identical). */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared++
  return shared / (a.size + b.size - shared)
}

const same = (a: string | null, b: string | null): boolean =>
  !!a && !!b && a.toLowerCase().trim() === b.toLowerCase().trim()

/** Title similarity times 3.0 for a matching activity and 1.5 for a matching topic, capped at 1. */
export function similarityScore(input: Comparable, record: Comparable): number {
  const inputTokens = input.tokens ?? normalizeAndTokenize(input.title)
  const recordTokens = record.tokens ?? normalizeAndTokenize(record.title)
  let score = input.title.toLowerCase().trim() === record.title.toLowerCase().trim() ? 1.0 : jaccardSimilarity(inputTokens, recordTokens)
  if (same(input.activity, record.activity)) score *= SIMILARITY.ACTIVITY_MATCH_MULTIPLIER
  if (same(input.topic, record.topic)) score *= SIMILARITY.TOPIC_MATCH_MULTIPLIER
  return Math.min(score, 1.0)
}

/** The value at which half of the total weight is reached, values sorted ascending; 0 without matches. */
export function weightedMedian(matches: ReadonlyArray<{ minutes: number; weight: number }>): number {
  if (matches.length === 0) return 0
  const sorted = [...matches].sort((a, b) => a.minutes - b.minutes)
  const half = sorted.reduce((sum, m) => sum + m.weight, 0) / 2
  let cumulative = 0
  for (const match of sorted) {
    cumulative += match.weight
    if (cumulative >= half) return match.minutes
  }
  return sorted[sorted.length - 1]?.minutes ?? 0
}
