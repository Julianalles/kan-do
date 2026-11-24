import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelTileGlide, useTileGlide } from '~/composables/useTileGlide'
import { MOTION } from '~/lib/motionTokens'

/**
 * The glide of the Statistik tiles (#789). jsdom has no layout and no Web Animations: rects are a lookup table (a function of
 * the element, so a test can change them between the read and the play), `Element.animate` is a recording stub.
 */

interface Recorded {
  target: Element
  keyframes: Array<Record<string, unknown>>
  options: KeyframeAnimationOptions
  cancel: ReturnType<typeof vi.fn>
  finish: () => void
}

type Box = { left: number, top: number, width: number, height: number }
const boxes = new Map<Element, Box>()
const recorded: Recorded[] = []

function node(attrs: Record<string, string>, parent: Element): HTMLElement {
  const el = document.createElement('div')
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  parent.append(el)
  return el
}
const place = (el: Element, left: number, top: number, width = 300, height = 200) => boxes.set(el, { left, top, width, height })

function mockMedia(matches: (query: string) => boolean) {
  window.matchMedia = vi.fn((query: string) => ({ matches: matches(query) })) as unknown as typeof window.matchMedia
}
const wide = (query: string) => query.includes('min-width') // md and up, motion on

beforeEach(() => {
  recorded.length = 0
  boxes.clear()
  document.body.innerHTML = ''
  mockMedia(wide)
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const b = boxes.get(this) ?? { left: 0, top: 0, width: 0, height: 0 }
    return { ...b, x: b.left, y: b.top, right: b.left + b.width, bottom: b.top + b.height, toJSON: () => ({}) }
  }
  Element.prototype.animate = function (this: Element, keyframes: unknown, options: unknown) {
    const listeners: Record<string, Array<() => void>> = {}
    const animation = {
      addEventListener: (name: string, fn: () => void) => { (listeners[name] ??= []).push(fn) },
      cancel: vi.fn(() => (listeners.cancel ?? []).forEach(fn => fn())),
    }
    recorded.push({ target: this, keyframes: keyframes as Array<Record<string, unknown>>, options: options as KeyframeAnimationOptions, cancel: animation.cancel, finish: () => (listeners.finish ?? []).forEach(fn => fn()) })
    return animation as unknown as Animation
  } as unknown as typeof Element.prototype.animate
  Object.defineProperty(window, 'scrollX', { value: 0, configurable: true })
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true })
})

afterEach(() => cancelTileGlide())

/** A row of two tiles (a, b) over a full-width tile c; `a` opens and takes the row */
function tiles() {
  const root = node({}, document.body)
  const grid = node({ 'data-stats-grid': '' }, root)
  const make = (parent: Element, id: string) => {
    const tile = node({ 'data-stats-tile': '', 'data-testid': `stats-tile-${id}` }, parent)
    const summary = node({ 'data-stats-summary': '' }, tile)
    return { tile, summary }
  }
  const a = make(grid, '2')
  const b = make(grid, '3')
  const c = make(root, '5')
  place(root, 0, 0, 1000, 700)
  place(grid, 0, 0, 1000, 400)
  place(a.tile, 0, 0, 300, 200)
  place(b.tile, 350, 0, 300, 200)
  place(c.tile, 0, 450, 1000, 200)
  place(a.summary, 0, 0, 300, 100)
  return { root, grid, a, b, c }
}

/** The new layout `a` opens to: `a` spans the row, `b` drops below it, the row is taller */
function open(t: ReturnType<typeof tiles>) {
  place(t.a.tile, 0, 0, 1000, 300)
  place(t.b.tile, 0, 324, 300, 200)
  place(t.grid, 0, 0, 1000, 524)
  place(t.c.tile, 0, 550, 1000, 200)
}

describe('useTileGlide.around', () => {
  it('runs the change as it is, and calls done, without a root, below md and under reduced motion', async () => {
    const t = tiles()
    const change = vi.fn(() => open(t))
    const done = vi.fn()

    await useTileGlide().around(null, change, done)
    mockMedia(() => false) // below md
    await useTileGlide().around(t.root, change, done)
    mockMedia(query => query.includes('reduce') || query.includes('min-width')) // reduced motion
    await useTileGlide().around(t.root, change, done)

    expect(change).toHaveBeenCalledTimes(3)
    expect(done).toHaveBeenCalledTimes(3)
    expect(recorded).toEqual([])
  })

  it('glides a tile that only moves by translate, and the one that changes width by width under overflow hidden', async () => {
    const t = tiles()
    await useTileGlide().around(t.root, () => open(t))

    const moved = recorded.find(r => r.target === t.b.tile)!
    expect(moved.keyframes[0]).toEqual({ transform: 'translate(350px, -324px)' })
    expect(moved.keyframes[1]).toEqual({ transform: 'none' })
    expect(moved.options).toMatchObject({ duration: MOTION.placeMs, easing: MOTION.standard, fill: 'none' })

    const grown = recorded.find(r => r.target === t.a.tile)!
    expect(grown.keyframes[0]).toMatchObject({ width: '300px', overflow: 'hidden' })
    expect(grown.keyframes[1]).toMatchObject({ width: '1000px', overflow: 'hidden' })
    // Tile 5 sits under the row: it follows the row's height, it is not re-laid by the grid
    expect(recorded.some(r => r.target === t.c.tile)).toBe(false)
    // The row's height glides from the old to the new one
    expect(recorded.find(r => r.target === t.grid)!.keyframes).toEqual({ height: ['400px', '524px'] })
  })

  // Gate of PR 809: switching from tile 2 to tile 3 moved the closing tile 1270 px in 400 ms, 145 px in its fastest frame
  it('a long travel lengthens the glide so its fastest frame stays under 120 px, at most to --duration-curtain; every part shares it', async () => {
    const t = tiles()
    const long = (dy: number) => () => {
      open(t)
      place(t.b.tile, 0, dy, 300, 200)
    }
    const durations = () => new Set(recorded.map(r => r.options.duration))

    await useTileGlide().around(t.root, long(1270))
    const [duration] = [...durations()]
    expect(durations().size).toBe(1)
    expect(duration).toBeGreaterThan(MOTION.placeMs)
    expect(duration).toBeLessThan(MOTION.curtainMs)
    // The peak speed of --ease-standard is 2.73 times the mean: 1270 px over the duration, in a 60 Hz frame
    expect(1270 * 2.74 * (1000 / 60) / (duration as number)).toBeLessThanOrEqual(120)

    cancelTileGlide()
    recorded.length = 0
    place(t.a.tile, 0, 0, 300, 200)
    place(t.b.tile, 350, 0, 300, 200)
    place(t.grid, 0, 0, 1000, 400)
    await useTileGlide().around(t.root, long(5000))
    expect([...durations()]).toEqual([MOTION.curtainMs])
  })

  it('runs the panels that open or close on the glide\'s clock, and gives them their own back when it has ended', async () => {
    const t = tiles()
    const content = node({ 'data-state': 'open' }, t.a.tile)
    node({ 'data-stats-detail': '' }, content)
    await useTileGlide().around(t.root, () => open(t))
    expect(content.style.animationDuration).toBe(`${MOTION.placeMs}ms`)
    for (const r of recorded) r.finish()
    expect(content.style.animationDuration).toBe('')
  })

  it('pins the summary of the tile that changes width, and lets go of it when the glide has ended', async () => {
    const t = tiles()
    const done = vi.fn()
    await useTileGlide().around(t.root, () => open(t), done)
    expect(t.a.summary.style.width).toBe('1000px')
    expect(done).not.toHaveBeenCalled()

    recorded.forEach(r => r.finish())
    expect(t.a.summary.style.width).toBe('')
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('reads page coordinates: a scroll between the read and the play does not move a tile', async () => {
    const t = tiles()
    await useTileGlide().around(t.root, () => {
      open(t)
      // the page scrolled by 100 px (the toggle was brought into view): every viewport top is 100 px smaller
      ;(window as unknown as { scrollY: number }).scrollY = 100
      for (const [el, b] of boxes) boxes.set(el, { ...b, top: b.top - 100 })
    })
    expect(recorded.find(r => r.target === t.b.tile)!.keyframes[0]).toEqual({ transform: 'translate(350px, -324px)' })
  })

  it('a change while a glide runs ends it first, and cancelTileGlide ends everything and unpins', async () => {
    const t = tiles()
    await useTileGlide().around(t.root, () => open(t))
    const first = [...recorded]
    await useTileGlide().around(t.root, () => place(t.b.tile, 0, 324, 300, 220))
    first.forEach(r => expect(r.cancel).toHaveBeenCalled())

    await useTileGlide().around(t.root, () => open(t))
    cancelTileGlide()
    expect(t.a.summary.style.width).toBe('')
  })
})
