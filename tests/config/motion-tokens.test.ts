import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MOTION } from '../../lib/motionTokens'

// The motion tokens exist twice: as custom properties in assets/css/main.css and as numbers and curve strings in
// lib/motionTokens.ts, for the scripted animations (#593). They must not drift, and DESIGN.md "Motion" names the same values.

const root = resolve(__dirname, '../..')
const css = readFileSync(resolve(root, 'assets/css/main.css'), 'utf8')
const design = readFileSync(resolve(root, 'DESIGN.md'), 'utf8')
const token = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim()

describe('motion tokens (#593)', () => {
  const durations = { '--duration-fast': MOTION.fastMs, '--duration-base': MOTION.baseMs, '--duration-slow': MOTION.slowMs, '--duration-place': MOTION.placeMs, '--duration-curtain': MOTION.curtainMs, '--duration-stage': MOTION.stageMs }
  for (const [name, ms] of Object.entries(durations)) {
    it(`${name} is ${ms} ms in the stylesheet, the script mirror and DESIGN.md`, () => {
      expect(token(name)).toBe(`${ms}ms`)
      expect(design).toMatch(new RegExp(`\`${name}\` \\| ${ms} ms`))
    })
  }

  it('the two curves match', () => {
    expect(token('--ease-standard')).toBe(MOTION.standard)
    expect(token('--ease-emphasized')).toBe(MOTION.emphasized)
  })

  it('reduced motion is one global rule: durations zeroed, with named progress exceptions', () => {
    const rule = /@layer utilities\s*\{\s*@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\}\s*\}\s*\}/.exec(css)?.[0] ?? ''
    expect(rule).toContain('transition-duration: 0s !important')
    expect(rule).toContain('animation-duration: 0.01ms !important')
    expect(rule).toContain('.animate-spin')
    expect(rule).toContain('[data-motion-progress]')
  })

  it('the closing gap unmounts when its glide (--duration-slow) ends', () => {
    const source = readFileSync(resolve(root, 'lib/deleteGapState.ts'), 'utf8')
    expect(Number(/const GAP_CLOSE_MS = (\d+)/.exec(source)?.[1])).toBe(MOTION.slowMs)
  })
})
