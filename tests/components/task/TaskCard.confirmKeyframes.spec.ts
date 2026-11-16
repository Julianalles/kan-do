import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CONFIRMATION_FADE_IN_MS,
  CONFIRMATION_FADE_OUT_MS,
  DONE_CONFIRMATION_MS,
  FASTER_CONFIRMATION_MS,
} from '~/store/board'

/**
 * The keyframe stops of the done confirmation (#400) are the store's lengths as percentages and cannot read them at
 * runtime, so this keeps the two in step: a change to a constant that forgets the CSS fails here.
 */
const source = readFileSync(resolve(__dirname, '../../../components/task/TaskCard.vue'), 'utf8')

function stopsOf(name: string): { fadeIn: number, fadeOut: number } {
  const block = source.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1]
  expect(block, `@keyframes ${name} in TaskCard.vue`).toBeTruthy()
  const percents = [...block!.matchAll(/^\s+(\d+(?:\.\d+)?)% \{/gm)].map(m => Number(m[1]))
  expect(percents).toHaveLength(4)
  return { fadeIn: percents[1]!, fadeOut: percents[2]! }
}

const pct = (ms: number, total: number) => (ms / total) * 100

describe('TaskCard done confirmation keyframes (#400)', () => {
  it.each([
    ['task-confirm', DONE_CONFIRMATION_MS],
    ['task-confirm-faster', FASTER_CONFIRMATION_MS],
  ])('%s: the fade stops are the store lengths as percentages', (name, total) => {
    const { fadeIn, fadeOut } = stopsOf(name)
    expect(fadeIn).toBeCloseTo(pct(CONFIRMATION_FADE_IN_MS, total), 1)
    expect(fadeOut).toBeCloseTo(pct(total - CONFIRMATION_FADE_OUT_MS, total), 1)
  })

  it('the message layer stays the longer one', () => {
    expect(FASTER_CONFIRMATION_MS).toBeGreaterThan(DONE_CONFIRMATION_MS)
  })
})
