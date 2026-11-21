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
 * into a jump. The count of skipped pairs is part of the report so a run that mostly skipped can be seen. A box with a width or height
 * of 0 in two frames in a row (an empty toast viewport, #672) has nothing to see move and is not measured; one that gains or loses its area in a frame is.
 * Neither is a `position: fixed` box that paints nothing itself (transparent, no border, shadow or filter), holds elements only and
 * no text of its own (#675: the toast viewport grows from 0 to its toast's height in one frame, the toast glides in and is measured):
 * its children are the boxes that show. An absolute or in-flow box, one with a background or with text of its own, is measured.
 *
 * The thresholds are about a frame at 60 Hz, and a loaded CI runner (2 vCPUs, a video recording) has frames of 30 to 40 ms, so
 * every rule reads the frame's own duration (#666): the step limit is per 17 ms (a frame twice as long may move twice as far),
 * "within 2 frames" also needs the run to be shorter than `MAX_JUMP_MS` (a 100 ms exit seen in 2 slow frames is not a snap), and
 * a skipped (dropped) frame in which a box moved makes that movement "uncertain": it was probably a glide whose frames were
 * lost (a spring, like the nav indicator's, catches up in the frame after a stall, and a transition that began inside the stall
 * shows its first step there: that frame counts as uncertain too), so the run is not judged at all. A snap or a leap in frames
 * that were all measured is still caught.
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
/** One frame at 60 Hz: the step limit and the jump window are read per frame of this length. */
export const FRAME_MS = 17
/** A jump (see `MAX_JUMP_FRAMES`) also happens in this many ms at most: a 100 ms motion that a slow runner shows in 2 frames lasts longer. */
export const MAX_JUMP_MS = 45

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
  await page.evaluate(([sel, maxFrameMs, frameMs]) => {
    // steps[i] = px moved in frame i (0 = still, -1 = moved in a dropped frame: how far and how fast is not known); times[i] = that frame's ms
    type Track = { x: number, y: number, w: number, h: number, steps: number[], times: number[], el: Element, bare?: boolean }
    const tracks = new Map<Element, Track>()
    let last = performance.now()
    let measured = 0
    let skipped = 0
    let afterDrop = false
    let running = true
    // A fixed box that paints nothing itself and holds only elements: its children are the boxes to see (#675)
    const isBareFixed = (el: Element) => {
      if (el.childElementCount === 0) return false
      for (const n of Array.from(el.childNodes)) if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim()) return false
      const cs = getComputedStyle(el)
      return cs.position === 'fixed'
        && (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent')
        && cs.backgroundImage === 'none'
        && [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].every(w => parseFloat(w) === 0)
        && cs.boxShadow === 'none'
        && (cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0)
        && cs.filter === 'none'
        && (cs.backdropFilter === 'none' || cs.backdropFilter === '')
    }
    const sample = (now: number) => {
      if (!running) return
      const frameDt = now - last
      const dropped = frameDt > maxFrameMs
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
          tracks.set(el, { x, y, w: r.width, h: r.height, steps: [], times: [], el })
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
        // A box without area in this frame and the one before has nothing to see move (#672: the toast viewport is a fixed, empty,
        // 0-high `ol` that shifted 400 px once under load). A box that gains or loses its area in one frame is still measured.
        if ((r.width === 0 || r.height === 0) && (t.w === 0 || t.h === 0)) {
          t.x = x
          t.y = y
          t.w = r.width
          t.h = r.height
          t.steps.push(0)
          t.times.push(frameDt)
          continue
        }
        const step = Math.max(Math.abs(x - t.x), Math.abs(y - t.y), Math.abs(r.width - t.w), Math.abs(r.height - t.h))
        // The toaster viewport is a transparent, bottom-anchored `ol` that grows by its toast in one frame while the toast
        // glides in: nothing to see move (#675). Judged once, when the box first moves.
        if (step >= 0.5 && (t.bare ??= isBareFixed(el))) {
          t.x = x
          t.y = y
          t.w = r.width
          t.h = r.height
          t.steps.push(0)
          t.times.push(frameDt)
          continue
        }
        // The frame after a stall shows what the stall held back: a transition that began inside it, a spring that catches up
        if (!dropped && !afterDrop) {
          t.steps.push(step < 0.5 ? 0 : step)
          t.times.push(frameDt)
        }
        else {
          // A still box counts as a gap too, so two movements around a stall stay two runs
          t.steps.push(step >= 0.5 ? -1 : 0)
          t.times.push(frameDt)
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
        t.times.push(0)
      }
      if (dropped) skipped++
      else measured++
      afterDrop = dropped
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
      stop: (maxStep: number, jumpMin: number, maxJumpFrames: number, maxJumpMs: number) => {
        running = false
        const bad = new Map<Element, { step: number, total: number, frames: number }>()
        for (const t of tracks.values()) {
          // One movement = a run of moving frames (a single still frame inside it does not split it); each run is judged alone,
          // so a box that also glides elsewhere in the flow cannot hide a snap
          const runs: { steps: number[], times: number[], ms: number }[] = []
          let gap = 0
          t.steps.forEach((s, i) => {
            if (s !== 0) {
              if (!runs.length || gap > 1) runs.push({ steps: [], times: [], ms: 0 })
              const run = runs[runs.length - 1]!
              run.steps.push(s)
              run.times.push(t.times[i] ?? frameMs)
              run.ms += t.times[i] ?? 0
              gap = 0
            }
            else gap++
          })
          for (const run of runs) {
            const known = run.steps.filter(s => s > 0)
            if (!known.length) continue
            const uncertain = run.steps.length > known.length
            const step = Math.max(...known)
            const total = known.reduce((a, b) => a + b, 0)
            // A frame of 34 ms may move twice as far as one of 17 ms
            const worst = Math.max(...run.steps.map((s, i) => s > 0 ? s / Math.max(1, run.times[i]! / frameMs) : 0))
            const snap = !uncertain && total >= jumpMin && run.steps.length <= maxJumpFrames && step >= jumpMin && run.ms <= maxJumpMs
            // The unknown frames are already left out of `worst` (a spring catches up in the frame after a stall, by design);
            // a leap in a measured frame of the same run still counts
            if (worst > maxStep || snap) {
              const prev = bad.get(t.el)
              if (!prev || step > prev.step) bad.set(t.el, { step, total, frames: run.steps.length })
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
  }, [selector, MAX_FRAME_MS, FRAME_MS] as const)
  return {
    stop: () => page.evaluate(([a, b, c, d]) => (window as unknown as { __frameSteps: { stop: (...n: number[]) => FrameReport } }).__frameSteps.stop(a, b, c, d), [MAX_STEP, JUMP_MIN, MAX_JUMP_FRAMES, MAX_JUMP_MS] as const),
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
