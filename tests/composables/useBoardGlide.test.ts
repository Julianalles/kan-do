import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelBoardGlide, glideHeight, useBoardGlide } from '~/composables/useBoardGlide'
import { MOTION } from '~/lib/motionTokens'

/**
 * The board's glide (#610, #642). jsdom has no layout and no Web Animations: rects are a lookup table (a function of the
 * element, so a test can change them between the read and the play), `Element.animate` is a recording stub.
 */

interface Recorded {
  target: Element
  keyframes: Record<string, unknown[]>
  options: KeyframeAnimationOptions
  cancel: ReturnType<typeof vi.fn>
  finish: () => void
}

const rects = new Map<Element, { top: number, left: number, height: number }>()
const recorded: Recorded[] = []

function node(attrs: Record<string, string>, parent: Element = document.body): HTMLElement {
  const el = document.createElement('div')
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  parent.append(el)
  return el
}
const place = (el: Element, top: number, height = 100, left = 0) => rects.set(el, { top, left, height })

function mockMedia(reduced: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduced }) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  recorded.length = 0
  rects.clear()
  document.body.innerHTML = ''
  mockMedia(false)
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const r = rects.get(this) ?? { top: 0, left: 0, height: 0 }
    return { top: r.top, left: r.left, bottom: r.top + r.height, right: r.left + 300, width: 300, height: r.height, x: r.left, y: r.top, toJSON: () => ({}) }
  }
  Element.prototype.animate = function (this: Element, keyframes: unknown, options: unknown) {
    const listeners: Record<string, Array<() => void>> = {}
    const animation = {
      addEventListener: (name: string, fn: () => void) => { (listeners[name] ??= []).push(fn) },
      cancel: vi.fn(() => (listeners.cancel ?? []).forEach(fn => fn())),
    }
    recorded.push({ target: this, keyframes: keyframes as Record<string, unknown[]>, options: options as KeyframeAnimationOptions, cancel: animation.cancel, finish: () => (listeners.finish ?? []).forEach(fn => fn()) })
    return animation as unknown as Animation
  } as unknown as typeof Element.prototype.animate
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
})

afterEach(() => cancelBoardGlide())

/** A column: one list with two cards */
function column() {
  const list = node({ class: 'task-list' })
  const a = node({ class: 'task-wrapper', 'data-task-id': 'a' }, list)
  const b = node({ class: 'task-wrapper', 'data-task-id': 'b' }, list)
  place(list, 100, 300)
  place(a, 100)
  place(b, 212)
  return { list, a, b }
}

describe('useBoardGlide.around', () => {
  it('runs the change at once and glides a moved card from its old place over --duration-slow', async () => {
    const { b } = column()
    const change = vi.fn(() => place(b, 100))
    await useBoardGlide().around(change)
    expect(change).toHaveBeenCalledTimes(1)
    const glide = recorded.find(r => r.target === b)!
    expect(glide.keyframes.transform).toEqual(['translate(0px, 112px)', 'none'])
    expect(glide.options).toMatchObject({ duration: MOTION.slowMs, easing: MOTION.standard, fill: 'none' })
  })

  it('does not animate a card that stays where it was', async () => {
    const { a } = column()
    await useBoardGlide().around(() => undefined)
    expect(recorded.find(r => r.target === a)).toBeUndefined()
  })

  it('fades a card in that was not there before, and animates a list whose height changed', async () => {
    const { list } = column()
    let c!: HTMLElement
    await useBoardGlide().around(() => {
      c = node({ class: 'task-wrapper', 'data-task-id': 'c' }, list)
      place(c, 324)
      place(list, 100, 336)
    })
    expect(recorded.find(r => r.target === c)!.keyframes.opacity).toEqual([0, 1])
    const listGlide = recorded.find(r => r.target === list)!
    expect(listGlide.keyframes.height).toEqual(['300px', '336px'])
    // a list that fills its column ignores `height`: the basis carries it, with the flex factors held off
    expect(listGlide.keyframes.flexBasis).toEqual(['300px', '336px'])
    expect(listGlide.keyframes.flexGrow).toEqual([0, 0])
  })

  it('grows a column footer in from nothing when it arrives, so the board takes its height over the glide (#671)', async () => {
    column()
    let footer!: HTMLElement
    await useBoardGlide().around(() => {
      footer = node({ class: 'column-footer' })
      place(footer, 700, 68)
    })
    const glide = recorded.find(r => r.target === footer)!
    expect(glide.keyframes.height).toEqual(['0px', '68px'])
    expect(glide.keyframes.paddingTop?.[0]).toBe('0px')
    expect(glide.keyframes.paddingBottom?.[0]).toBe('0px')
    expect(glide.keyframes.opacity).toEqual([0, 1])
    expect(glide.options).toMatchObject({ duration: MOTION.slowMs, easing: MOTION.standard })
    // played before the lists are measured: a list that stretches with the board then starts from the footer's first keyframe
    expect(recorded.indexOf(glide)).toBe(0)
  })

  it('leaves a column footer that was there before alone', async () => {
    const footer = node({ class: 'column-footer' })
    place(footer, 700, 68)
    await useBoardGlide().around(() => undefined)
    expect(recorded.find(r => r.target === footer)).toBeUndefined()
  })

  it('follows a card by its task id when its element was replaced (a card turning into a stack)', async () => {
    const { list, a } = column()
    let stack!: HTMLElement
    await useBoardGlide().around(() => {
      a.remove()
      stack = node({ class: 'task-stack', 'data-task-id': 'a' }, list)
      place(stack, 140)
    })
    expect(recorded.find(r => r.target === stack)!.keyframes.transform).toEqual(['translate(0px, -40px)', 'none'])
  })

  it('leaves out cards that are off screen before and after (only what is on screen animates)', async () => {
    const { b } = column()
    place(b, 5000)
    await useBoardGlide().around(() => place(b, 6000))
    expect(recorded.find(r => r.target === b)).toBeUndefined()
  })

  it('runs the change as it is under reduced motion', async () => {
    mockMedia(true)
    const { b } = column()
    const change = vi.fn(() => place(b, 100))
    await useBoardGlide().around(change)
    expect(change).toHaveBeenCalledTimes(1)
    expect(recorded).toHaveLength(0)
  })

  it('ends every glide at its final state on a pointerdown (the start of a drag) and stops listening', async () => {
    const { b } = column()
    await useBoardGlide().around(() => place(b, 100))
    const glide = recorded.find(r => r.target === b)!
    window.dispatchEvent(new Event('pointerdown'))
    expect(glide.cancel).toHaveBeenCalled()
    glide.cancel.mockClear()
    window.dispatchEvent(new Event('pointerdown'))
    expect(glide.cancel).not.toHaveBeenCalled()
  })

  it('a second change while a glide runs reads the rects as drawn and ends the first glide', async () => {
    const { b } = column()
    await useBoardGlide().around(() => place(b, 100))
    const first = recorded.find(r => r.target === b)!
    // the card is drawn 60 px below its final place right now
    place(b, 160)
    await useBoardGlide().around(() => place(b, 100))
    expect(first.cancel).toHaveBeenCalled()
    expect(recorded.filter(r => r.target === b).at(-1)!.keyframes.transform).toEqual(['translate(0px, 60px)', 'none'])
  })

  it('stops listening for a drag once every glide has finished', async () => {
    const { b } = column()
    await useBoardGlide().around(() => place(b, 100))
    const spy = vi.spyOn(window, 'removeEventListener')
    recorded.forEach(r => r.finish())
    expect(spy).toHaveBeenCalledWith('pointerdown', expect.any(Function), true)
  })
})

describe('glideHeight', () => {
  it('animates height and min-height from the old to the new value', async () => {
    const card = node({ class: 'task' })
    place(card, 0, 132)
    await glideHeight(card, () => place(card, 0, 154))
    expect(recorded[0]!.keyframes.height).toEqual(['132px', '154px'])
    expect(recorded[0]!.keyframes.minHeight).toEqual(['132px', '154px'])
  })

  it('runs the change as it is under reduced motion, and without a box', async () => {
    mockMedia(true)
    const card = node({ class: 'task' })
    const change = vi.fn()
    await glideHeight(card, change)
    await glideHeight(null, change)
    expect(change).toHaveBeenCalledTimes(2)
    expect(recorded).toHaveLength(0)
  })
})
