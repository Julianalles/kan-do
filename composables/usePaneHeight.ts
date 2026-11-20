/**
 * @composable usePaneHeight
 * @description The height of a setup pane follows its content as one guided motion (#648, epic #607): `outer` takes the
 * height of `inner` in 300 ms (`MOTION.slowMs`, `MOTION.emphasized`) when a step changes or the content grows or
 * shrinks (a list loads, an error appears). Replaces the one-frame jump of the setup steps.
 * @responsibility
 * - `inner` is the content block (height auto, `flow-root` so child margins count), `outer` its wrapper; the composable
 *   animates `outer` from the height on screen to the new one with WAAPI (`interpolate-size` is not in WebKit, the
 *   desktop engine)
 * - A DOM change (a step swap, a list that renders, an alert) is caught by a MutationObserver, whose callback is a
 *   microtask: the animation exists before the browser's next frame, so not one frame shows the new height first (a
 *   ResizeObserver fires after the frame's layout and script, one frame too late). A ResizeObserver covers what no
 *   mutation announces (an image, a font, a width change that rewraps the text)
 * - The first measurement and an unchanged height animate nothing; under `prefers-reduced-motion` nothing animates
 * - A change during a running animation starts from the height on screen and cancels the old animation, so the pane never jumps
 * - `outer` clips (`overflow: clip`) only while it animates, so focus rings at its edge are not cut at rest
 * - Reusable: `pages/welcome.vue`'s `setup-body` swap may adopt it but keeps its own one-block swap (not changed in #648)
 */
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { MOTION } from '~/lib/motionTokens'

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function usePaneHeight(outer: Ref<HTMLElement | null>, inner: Ref<HTMLElement | null>) {
  let observer: ResizeObserver | undefined
  let mutations: MutationObserver | undefined
  let lastHeight: number | null = null
  let running: Animation | null = null

  function stopAnimation() {
    running?.cancel()
    running = null
    if (outer.value) outer.value.style.overflow = ''
  }

  function onResize(entries: ResizeObserverEntry[]) {
    const entry = entries[entries.length - 1]
    if (entry) change(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)
  }

  function onMutation() {
    const el = inner.value
    if (el) change(el.getBoundingClientRect().height)
  }

  /** `next` is the content's new height */
  function change(next: number) {
    const el = outer.value
    const previous = lastHeight
    if (!el || (previous !== null && Math.abs(previous - next) < 0.5)) return
    lastHeight = next
    if (previous === null || reducedMotion()) return
    // A running animation has the height the user sees right now; read it before the old animation is cancelled
    const from = running ? el.getBoundingClientRect().height : previous
    running?.cancel()
    el.style.overflow = 'clip'
    const animation = el.animate([{ height: `${from}px` }, { height: `${next}px` }], { duration: MOTION.slowMs, easing: MOTION.emphasized })
    running = animation
    const end = () => {
      if (running !== animation) return
      running = null
      el.style.overflow = ''
    }
    animation.finished.then(end, end)
  }

  function start() {
    stopObserving()
    lastHeight = null
    stopAnimation()
    if (!inner.value) return
    // Measure now, so a change before the observers' first report already has a height to start from
    lastHeight = inner.value.getBoundingClientRect().height
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(onResize)
      observer.observe(inner.value)
    }
    if (typeof MutationObserver !== 'undefined') {
      mutations = new MutationObserver(onMutation)
      mutations.observe(inner.value, { childList: true, subtree: true, characterData: true, attributes: true })
    }
  }

  function stopObserving() {
    observer?.disconnect()
    observer = undefined
    mutations?.disconnect()
    mutations = undefined
  }

  onMounted(start)
  watch(inner, start, { flush: 'post' })
  onBeforeUnmount(() => {
    stopObserving()
    stopAnimation()
  })
}
