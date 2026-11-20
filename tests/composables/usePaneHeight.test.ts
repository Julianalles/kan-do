/**
 * usePaneHeight (#648, epic #607): the pane of a setup follows its content's height as one 300 ms guided motion.
 * jsdom has no layout, no ResizeObserver and no Web Animations: the test stubs all three and reads what the
 * composable asks of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { usePaneHeight } from '~/composables/usePaneHeight'
import { MOTION } from '~/lib/motionTokens'

type Observed = { target: Element, callback: ResizeObserverCallback }
let observers: Observed[] = []
let disconnected = 0

class FakeResizeObserver {
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) { this.callback = callback }
  observe(target: Element) { observers.push({ target, callback: this.callback }) }
  unobserve() {}
  disconnect() { disconnected += 1 }
}

interface FakeAnimation { keyframes: Keyframe[], options: KeyframeAnimationOptions, cancel: ReturnType<typeof vi.fn>, finish: () => void, finished: Promise<unknown> }
let animations: FakeAnimation[] = []
/** The height the outer element reports (what the user sees right now) */
let renderedHeight = 0
let reduced = false

function stubEnvironment() {
  observers = []
  disconnected = 0
  animations = []
  reduced = false
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced && query.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
  HTMLElement.prototype.animate = function (keyframes: Keyframe[] | PropertyIndexedKeyframes, options?: number | KeyframeAnimationOptions) {
    let finish!: () => void
    const finished = new Promise<unknown>((resolve) => { finish = () => resolve(undefined) })
    const animation: FakeAnimation = { keyframes: keyframes as Keyframe[], options: options as KeyframeAnimationOptions, cancel: vi.fn(), finish, finished }
    animations.push(animation)
    return animation as unknown as Animation
  }
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { height: renderedHeight, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect
  }
}

/** The inner element reported a new content height */
function resize(height: number) {
  const inner = observers[observers.length - 1]!
  inner.callback([{ contentRect: { height }, borderBoxSize: [{ blockSize: height, inlineSize: 0 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver)
}

function mountHarness() {
  const showInner = ref(true)
  const Harness = defineComponent({
    setup() {
      const outer = ref<HTMLElement | null>(null)
      const inner = ref<HTMLElement | null>(null)
      usePaneHeight(outer, inner)
      return () => h('div', { ref: outer, 'data-outer': '' }, showInner.value ? [h('div', { ref: inner, 'data-inner': '' })] : [])
    },
  })
  const wrapper = mount(Harness, { attachTo: document.body })
  return { wrapper, showInner }
}

describe('usePaneHeight', () => {
  let wrapper: VueWrapper | undefined
  beforeEach(stubEnvironment)
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
  })

  it('does not animate the first measurement (first mount)', async () => {
    renderedHeight = 120
    wrapper = mountHarness().wrapper
    await nextTick()
    resize(120) // the observer's first report repeats what the mount measured
    expect(animations).toHaveLength(0)
  })

  it('animates a growing pane from the old to the new height in 300 ms on the emphasized curve', async () => {
    renderedHeight = 120
    wrapper = mountHarness().wrapper
    await nextTick()
    resize(120)
    renderedHeight = 240 // layout already follows the new content when the observer fires
    resize(240)
    expect(animations).toHaveLength(1)
    expect(animations[0]!.keyframes).toEqual([{ height: '120px' }, { height: '240px' }])
    expect(animations[0]!.options).toMatchObject({ duration: MOTION.slowMs, easing: MOTION.emphasized })
  })

  it('animates a shrinking pane from the old to the new height', async () => {
    renderedHeight = 300
    wrapper = mountHarness().wrapper
    await nextTick()
    resize(300)
    renderedHeight = 180
    resize(180)
    expect(animations).toHaveLength(1)
    expect(animations[0]!.keyframes).toEqual([{ height: '300px' }, { height: '180px' }])
  })

  it('clips the pane only while it animates', async () => {
    renderedHeight = 100
    wrapper = mountHarness().wrapper
    await nextTick()
    const outer = wrapper.get('[data-outer]').element as HTMLElement
    resize(100)
    renderedHeight = 160
    resize(160)
    expect(outer.style.overflow).toBe('clip')
    animations[0]!.finish()
    await animations[0]!.finished
    await nextTick()
    expect(outer.style.overflow).toBe('')
  })

  it('starts a change during a running animation from the height on screen and cancels the old one', async () => {
    renderedHeight = 100
    wrapper = mountHarness().wrapper
    await nextTick()
    resize(100)
    renderedHeight = 200
    resize(200) // animation 1: 100 -> 200
    renderedHeight = 150 // the user sees 150 now; the content grows again
    resize(260)
    expect(animations).toHaveLength(2)
    expect(animations[0]!.cancel).toHaveBeenCalled()
    expect(animations[1]!.keyframes).toEqual([{ height: '150px' }, { height: '260px' }])
  })

  it('does not animate an unchanged height', async () => {
    renderedHeight = 100
    wrapper = mountHarness().wrapper
    await nextTick()
    resize(100)
    resize(100)
    expect(animations).toHaveLength(0)
  })

  it('is instant under prefers-reduced-motion', async () => {
    reduced = true
    renderedHeight = 100
    wrapper = mountHarness().wrapper
    await nextTick()
    resize(100)
    renderedHeight = 220
    resize(220)
    expect(animations).toHaveLength(0)
    expect((wrapper.get('[data-outer]').element as HTMLElement).style.overflow).toBe('')
  })

  it('starts the animation in the microtask after a DOM change, before the next frame (not one frame late, in a ResizeObserver)', async () => {
    renderedHeight = 100
    const { wrapper: mounted } = mountHarness()
    wrapper = mounted
    await nextTick()
    renderedHeight = 220 // the content grew with the patch
    mounted.get('[data-inner]').element.appendChild(document.createElement('p'))
    await Promise.resolve()
    await Promise.resolve()
    expect(animations).toHaveLength(1)
    expect(animations[0]!.keyframes).toEqual([{ height: '100px' }, { height: '220px' }])
    resize(220) // the ResizeObserver's later report of the same height adds nothing
    expect(animations).toHaveLength(1)
  })

  it('stops observing when the host unmounts, and cancels a running animation', async () => {
    renderedHeight = 100
    const { wrapper: mounted } = mountHarness()
    await nextTick()
    resize(100)
    renderedHeight = 200
    resize(200)
    mounted.unmount()
    expect(disconnected).toBeGreaterThan(0)
    expect(animations[0]!.cancel).toHaveBeenCalled()
  })

  it('measures afresh when the inner element is replaced (the pane remounts)', async () => {
    renderedHeight = 100
    const { wrapper: mounted, showInner } = mountHarness()
    wrapper = mounted
    await nextTick()
    resize(100)
    showInner.value = false
    await nextTick()
    renderedHeight = 40
    showInner.value = true
    await nextTick()
    // the new inner element is a first measurement again: no animation from a stale height
    resize(40)
    expect(animations).toHaveLength(0)
  })
})
