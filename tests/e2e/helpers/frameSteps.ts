/**
 * @module frameSteps
 * @description The guard behind "a view arrives as one piece" (rule 82, kd#600): per animation frame, every box of the page is
 * measured, and a box that jumps (moves in one or two frames instead of gliding over many) fails the flow, unless the helper's
 * caller allow-lists it with the issue that will fix it. A second sampler lists every animation and transition longer than 1 ms,
 * for the "reduced motion is instant" assertion (DESIGN.md "Motion").
 *
 * Why a per-frame step separates the two: in the sweep's recordings (docs/design/ui-sweep-2026-11/findings-motion.md, motion-17)
 * a guided motion never exceeded 131 px per frame and came in 9 or more frames; every defect was one or two frames of 22 to
 * 912 px. So a box fails when it (a) moves more than `MAX_STEP` px in one frame, or (b) moves at least `JUMP_MIN` px in total
 * but within `MAX_JUMP_FRAMES` frames. Boxes that appear or disappear are not measured (a new view is not a move), and a
 * frame pair more than `MAX_FRAME_MS` apart is skipped: a loaded machine drops frames, and a dropped frame would turn a glide
 * into a jump. The count of skipped pairs is part of the report so a run that mostly skipped can be seen.
 *
 * Usage: `const frames = await startFrames(page)`, run the flow, `const report = await frames.stop()`, then
 * `expectNoJumps(report, ALLOW)`. A child that moves with a jumping parent is not listed on its own.
 */
import { expect, type Page } from '@playwright/test'

/** The largest step of a guided motion in the recordings was 131 px (1280 px wide). */
export const MAX_STEP = 140
/** A move of at least this many px in total... */
export const JUMP_MIN = 8
/** ...that took this many frames or fewer is a jump (a guided motion came in 9 or more). */
export const MAX_JUMP_FRAMES = 2
/** A frame pair further apart than this is a dropped frame on a loaded machine and not measured. */
export const MAX_FRAME_MS = 40

export interface Jump {
  /** `tag[testid]#id.class` plus a text start, enough to find the box. */
  label: string
  /** Largest single-frame step in px. */
  step: number
  /** Total distance travelled in px, over this many frames of movement. */
  total: number
  frames: number
}

export interface FrameReport {
  jumps: Jump[]
  /** Frame pairs measured and frame pairs skipped as dropped. */
  measured: number
  skipped: number
}

/** A box that is allowed to jump in this step: `match` against the label, `issue` is the open issue that will fix it (`indicator` for a named progress indicator). */
export interface AllowedJump {
  match: RegExp
  issue: string
  why: string
}

export interface FrameSampler {
  stop: () => Promise<FrameReport>
}

/** Starts sampling boxes every frame. `selector` limits what is measured (default: everything in `body`). Call `stop()` after the flow. */
export async function startFrames(page: Page, selector = 'body *'): Promise<FrameSampler> {
  await page.evaluate(([sel, maxFrameMs]) => {
    type Track = { x: number, y: number, w: number, h: number, steps: number[], el: Element }
    const tracks = new Map<Element, Track>()
    let last = performance.now()
    let measured = 0
    let skipped = 0
    let running = true
    const sample = (now: number) => {
      if (!running) return
      const dropped = now - last > maxFrameMs
      last = now
      const seen = new Set<Element>()
      for (const el of Array.from(document.querySelectorAll(sel))) {
        if (el.closest('.nuxt-loading-indicator, [data-frame-ignore]')) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        seen.add(el)
        const x = r.x + window.scrollX
        const y = r.y + window.scrollY
        const t = tracks.get(el)
        if (!t) {
          tracks.set(el, { x, y, w: r.width, h: r.height, steps: [], el })
          continue
        }
        if (Number.isNaN(t.x)) {
          // Back on the page after leaving: a new start, not a move
          t.x = x
          t.y = y
          t.w = r.width
          t.h = r.height
          continue
        }
        if (!dropped) {
          const step = Math.max(Math.abs(x - t.x), Math.abs(y - t.y), Math.abs(r.width - t.w), Math.abs(r.height - t.h))
          t.steps.push(step < 0.5 ? 0 : step)
        }
        t.x = x
        t.y = y
        t.w = r.width
        t.h = r.height
      }
      // A box that left the page is finished: its record stays, but it is no longer updated
      for (const [el, t] of tracks) {
        if (seen.has(el) || Number.isNaN(t.x)) continue
        t.x = Number.NaN
        t.steps.push(0)
      }
      if (dropped) skipped++
      else measured++
      requestAnimationFrame(sample)
    }
    const label = (el: Element) => {
      const h = el as HTMLElement
      const cls = String(h.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
      const tid = h.getAttribute('data-testid')
      const text = (h.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)
      return `${el.tagName.toLowerCase()}${tid ? `[${tid}]` : ''}${h.id ? `#${h.id}` : ''}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`
    }
    ;(window as unknown as { __frameSteps: unknown }).__frameSteps = {
      stop: (maxStep: number, jumpMin: number, maxJumpFrames: number) => {
        running = false
        const bad = new Map<Element, { step: number, total: number, frames: number }>()
        for (const t of tracks.values()) {
          // One movement = a run of moving frames (a single still frame inside it does not split it); each run is judged alone,
          // so a box that also glides elsewhere in the flow cannot hide a snap
          const runs: number[][] = []
          let gap = 0
          for (const s of t.steps) {
            if (s > 0) {
              if (!runs.length || gap > 1) runs.push([])
              runs[runs.length - 1]!.push(s)
              gap = 0
            }
            else gap++
          }
          for (const run of runs) {
            const step = Math.max(...run)
            const total = run.reduce((a, b) => a + b, 0)
            if (step > maxStep || (total >= jumpMin && run.length <= maxJumpFrames && step >= jumpMin)) {
              const prev = bad.get(t.el)
              if (!prev || step > prev.step) bad.set(t.el, { step, total, frames: run.length })
            }
          }
        }
        // A child moves with its jumping parent: list the parent only
        const jumps = [...bad].filter(([el]) => {
          for (let p = el.parentElement; p; p = p.parentElement) if (bad.has(p)) return false
          return true
        }).map(([el, v]) => ({ label: label(el), step: Math.round(v.step), total: Math.round(v.total), frames: v.frames }))
        return { jumps, measured, skipped }
      },
    }
    requestAnimationFrame(sample)
  }, [selector, MAX_FRAME_MS] as const)
  return {
    stop: () => page.evaluate(([a, b, c]) => (window as unknown as { __frameSteps: { stop: (...n: number[]) => FrameReport } }).__frameSteps.stop(a, b, c), [MAX_STEP, JUMP_MIN, MAX_JUMP_FRAMES] as const),
  }
}

/** Fails on every jump that is not allow-listed; an allow-list entry that matched nothing is not an error (the fix may have landed: remove it then). */
export function expectNoJumps(report: FrameReport, allow: AllowedJump[] = []): void {
  const open = report.jumps.filter(j => !allow.some(a => a.match.test(j.label)))
  expect(open, `boxes that jumped instead of gliding (more than ${MAX_STEP} px in one frame, or ${JUMP_MIN}+ px within ${MAX_JUMP_FRAMES} frames); measured ${report.measured} frame pairs, skipped ${report.skipped}`).toEqual([])
}

export interface LongAnimation {
  /** What runs: the animation name or the transitioned property, on which element. */
  label: string
  durationMs: number
}

/** Names that stay timed under reduced motion: progress indicators that show elapsed time (DESIGN.md "Motion"). */
export const REDUCED_MOTION_INDICATORS: AllowedJump[] = [
  { match: /^spin on |animate-spin|\bspinner\b|loading-indicator/, issue: 'indicator', why: 'a spinner shows that work is running' },
  { match: /task-gap-drain|task-gap__drain|data-motion-progress/, issue: 'indicator', why: 'the gap\'s undo drain shows the time left' },
  { match: /has-focus|focus-overlay|^opacity on nav\[app-nav\]/, issue: 'indicator', why: 'the focus overlay keeps a 150 ms tint fade, a named exception of the global rule (main.css, #593)' },
  { match: /timebox|nudge/i, issue: 'indicator', why: 'the nudge countdown shows the time left' },
]

/** Records every animation and transition longer than 1 ms from now until `stop()` (events plus a per-frame poll of `document.getAnimations()`). */
export async function startAnimationLog(page: Page): Promise<{ stop: () => Promise<LongAnimation[]> }> {
  await page.evaluate(() => {
    const found = new Map<string, number>()
    const label = (el: Element | null) => {
      if (!el) return '?'
      const h = el as HTMLElement
      const cls = String(h.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
      const tid = h.getAttribute('data-testid')
      return `${el.tagName.toLowerCase()}${tid ? `[${tid}]` : ''}${cls ? `.${cls}` : ''}`
    }
    const note = (a: Animation) => {
      const effect = a.effect as KeyframeEffect | null
      const timing = effect?.getComputedTiming()
      if (!timing) return
      const total = Number(timing.duration) * (timing.iterations === Infinity ? 2 : Number(timing.iterations))
      if (!(total > 1)) return
      const name = (a as CSSTransition).transitionProperty ?? (a as CSSAnimation).animationName ?? 'script'
      const key = `${name} on ${label(effect?.target ?? null)}`
      found.set(key, Math.max(found.get(key) ?? 0, Math.round(Number(timing.duration))))
    }
    let running = true
    const poll = () => {
      if (!running) return
      document.getAnimations().forEach(note)
      requestAnimationFrame(poll)
    }
    for (const type of ['transitionrun', 'animationstart']) {
      document.addEventListener(type, (e) => {
        const target = e.target as Element
        target.getAnimations().forEach(note)
      }, true)
    }
    ;(window as unknown as { __animLog: unknown }).__animLog = { stop: () => { running = false; return [...found].map(([label, durationMs]) => ({ label, durationMs })) } }
    requestAnimationFrame(poll)
  })
  return { stop: () => page.evaluate(() => (window as unknown as { __animLog: { stop: () => LongAnimation[] } }).__animLog.stop()) }
}

/** Fails on every animation longer than 1 ms that is not a named indicator or allow-listed with its open issue. */
export function expectInstant(log: LongAnimation[], allow: AllowedJump[] = []): void {
  const open = log.filter(a => ![...REDUCED_MOTION_INDICATORS, ...allow].some(x => x.match.test(a.label)))
  expect(open, 'animations or transitions longer than 1 ms under reduced motion').toEqual([])
}
