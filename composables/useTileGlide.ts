import { nextTick } from 'vue'
import { MOTION } from '~/lib/motionTokens'

/**
 * The glide of the Statistik tiles (#789, a sibling of `useBoardGlide`): from `md` an opened tile moves to the first place and
 * spans the row (#689), the others drop to the row below. The change itself is instant and final (CSS `order` and `col-span`);
 * `around(root, change)` reads the boxes, runs `change`, and plays what makes it a glide over `MOTION.placeMs`:
 *
 * - a tile that only moves glides by `translate` (a FLIP); a tile that changes its width (the one that opens or closes) also
 *   animates `width` under `overflow: hidden`, so its box grows or shrinks instead of snapping;
 * - what is inside such a tile does not re-lay while its box changes: the summary (line and chart) and the detail panel
 *   are pinned to a pixel width until the glide ends (the summary to its final width, the panel to the wider of the two), so
 *   no text re-wraps line by line and `UCollapsible` measures its panel at the width it ends with (the first attempt's 43 px snap);
 * - a summary that is swapped for the other arrangement (stacked or spread, a new element: `data-stats-summary` is keyed by it,
 *   which the guard reads as a new box and not as a move) glides its height, so the tile takes the new height over the glide;
 * - the tile row's height glides from the old to the final height (read once with the panels at rest), so tile 5 and the page
 *   below follow instead of jumping. A fixed height would be wrong for the panel that grows inside it, which is why the final
 *   height is measured and not guessed.
 *
 * Purely visual, nothing waits for it. A change started while a glide runs continues from the boxes as drawn. Below `md`,
 * under reduced motion and on the server the change runs as it is. `cancelTileGlide()` ends everything at its final state.
 *
 * The markup it reads: `data-stats-grid` (the row), `data-stats-tile` (every tile), `data-stats-summary` and `data-stats-detail`
 * inside a tile (the detail's parent is the collapsible's content, which carries `data-state`).
 */

const GRID = '[data-stats-grid]'
const TILES = '[data-stats-tile]'
const SUMMARY = '[data-stats-summary]'
const DETAIL = '[data-stats-detail]'
/** `md` of the Tailwind scale: below it the tiles expand in place and nothing is re-ordered */
const MD = '(min-width: 768px)'

const running = new Set<Animation>()
const pinned = new Set<HTMLElement>()
let onEnd: (() => void) | null = null

/** Ends every running glide at its final state and lets the pinned boxes take their own width again */
export function cancelTileGlide(): void {
  for (const animation of [...running]) animation.cancel()
  running.clear()
  unpin()
  onEnd = null
}

function unpin(): void {
  for (const el of pinned) el.style.width = ''
  pinned.clear()
}

function pin(el: HTMLElement | null, width: number): void {
  if (!el) return
  el.style.width = `${width}px`
  pinned.add(el)
}

/** No glide without Web Animations (jsdom), without `matchMedia`, below `md` or when the user asks for reduced motion (scripted animations are not covered by the global CSS rule) */
const noGlide = (): boolean =>
  typeof Element.prototype.animate !== 'function'
  || typeof window.matchMedia !== 'function'
  || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  || !window.matchMedia(MD).matches

/** A box in page coordinates: the page may scroll between the read and the play (the opened toggle is scrolled into view) */
interface Box { left: number, top: number, width: number, height: number }
const rectOf = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height }
}

interface Before {
  rect: Box
  summaryHeight: number
  summary: Element | null
  /** The detail of a tile that is open now, at the width it is drawn with */
  detail: HTMLElement | null
  detailWidth: number
}

/** The content node of a collapsible (the detail's parent) carries the open state and the animation */
const contentOf = (detail: Element): HTMLElement | null => detail.parentElement

export function useTileGlide() {
  /**
   * Runs `change` and glides the tiles of `root` from their old boxes to their new ones. `done` runs when the glide has ended
   * (or at once when there is none), the moment the page may need to scroll a toggle back into view.
   */
  async function around(root: HTMLElement | null, change: () => void, done?: () => void): Promise<void> {
    if (typeof window === 'undefined' || !root || noGlide()) {
      change()
      done?.()
      return
    }
    const grid = root.querySelector<HTMLElement>(GRID)
    const tiles = [...root.querySelectorAll<HTMLElement>(TILES)]

    // Read first: a running glide is part of the box, so a repeated change continues from where the tile is drawn
    const before = new Map<Element, Before>()
    for (const tile of tiles) {
      const summary = tile.querySelector(SUMMARY)
      const detail = tile.querySelector<HTMLElement>(DETAIL)
      before.set(tile, {
        rect: rectOf(tile),
        summary,
        summaryHeight: summary ? rectOf(summary).height : 0,
        detail,
        detailWidth: detail ? rectOf(detail).width : 0,
      })
    }
    const gridHeight = grid ? rectOf(grid).height : 0
    cancelTileGlide()
    // The panel that is open now keeps its width while the tile around it shrinks (its content is measured at that width)
    for (const state of before.values()) if (state.detail) pin(state.detail, state.detailWidth)

    change()
    // `UCollapsible` mounts the panel of the tile that opens a few ticks after the change and measures it in the tick after that
    // (`--reka-collapsible-content-height` leaves 0): wait for it, never for a frame (that one would be painted unanimated), so the
    // panel is measured at the final layout and not at the first frame of the glide
    const measured = (tile: Element): boolean => {
      if (!tile.querySelector('[aria-expanded="true"]')) return true
      const content = tile.querySelector(DETAIL)?.parentElement
      return !!content && parseFloat(content.style.getPropertyValue('--reka-collapsible-content-height') || '0') > 0
    }
    await nextTick()
    for (let i = 0; i < 16 && !tiles.every(measured); i++) await nextTick()

    const animations: Animation[] = []
    const options: KeyframeAnimationOptions = { duration: MOTION.placeMs, easing: MOTION.standard, fill: 'none' }

    // The final height of the row: the panels at rest (the one that opens full, the one that closes gone), read with their animation off
    const nodes = tiles.map(tile => tile.querySelector(DETAIL)).filter((d): d is HTMLElement => !!d).map(contentOf).filter((n): n is HTMLElement => !!n)
    let gridFinal = gridHeight
    if (grid) {
      const saved = nodes.map(n => n.style.cssText)
      for (const node of nodes) {
        node.style.animation = 'none'
        if (node.getAttribute('data-state') === 'closed') node.style.display = 'none'
      }
      gridFinal = rectOf(grid).height
      nodes.forEach((n, i) => { n.style.cssText = saved[i]! })
    }

    for (const tile of tiles) {
      const was = before.get(tile)!
      const now = rectOf(tile)
      const frames: Keyframe[] = [{}, {}]
      const dx = was.rect.left - now.left
      const dy = was.rect.top - now.top
        // Tile 5 sits under the row: it follows the row's height, it is not re-laid by the grid
      const inGrid = !!grid && grid.contains(tile)
        const widthChanged = Math.abs(was.rect.width - now.width) >= 1
      if (inGrid && (dx || dy)) {
        frames[0]!.transform = `translate(${dx}px, ${dy}px)`
        frames[1]!.transform = 'none'
      }
      if (inGrid && widthChanged) {
        frames[0]!.width = `${was.rect.width}px`
        frames[1]!.width = `${now.width}px`
        frames[0]!.overflow = 'hidden'
        frames[1]!.overflow = 'hidden'
        const style = getComputedStyle(tile)
        const pad = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0')
        pin(tile.querySelector<HTMLElement>(SUMMARY), now.width - pad)
        pin(tile.querySelector<HTMLElement>(DETAIL), Math.max(was.rect.width, now.width) - pad)
      }
      if (Object.keys(frames[0]!).length) animations.push(tile.animate(frames, options))

      // The summary swaps for the other arrangement: a new box, its height takes over from the old one's (no fade: text that is half transparent fails contrast checks that run right after a toggle)
      const summary = tile.querySelector<HTMLElement>(SUMMARY)
      if (summary && summary !== was.summary && inGrid) {
        const height = rectOf(summary).height
        if (was.summary && Math.abs(was.summaryHeight - height) >= 1) {
          animations.push(summary.animate({ height: [`${was.summaryHeight}px`, `${height}px`], minHeight: [`${was.summaryHeight}px`, `${height}px`] }, options))
        }
      }
    }

    if (grid && Math.abs(gridHeight - gridFinal) >= 1) {
      animations.push(grid.animate({ height: [`${gridHeight}px`, `${gridFinal}px`] }, options))
    }

    if (!animations.length) {
      unpin()
      done?.()
      return
    }
    onEnd = done ?? null
    for (const animation of animations) {
      running.add(animation)
      const settle = () => {
        running.delete(animation)
        if (running.size) return
        unpin()
        const run = onEnd
        onEnd = null
        run?.()
      }
      animation.addEventListener('finish', settle)
      animation.addEventListener('cancel', () => { running.delete(animation) })
    }
  }
  return { around }
}
