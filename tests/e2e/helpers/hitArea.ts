/**
 * @module hitArea
 * @description E2E helper that measures the rendered hit area of every visible control on the current page (#592,
 * sweep guard 103). The class-reading checks (`button-ladder.test.ts`) cannot see a 33 px chip, a 16 px checkbox or a
 * 17 px text link, and a pseudo-element hit area (`::after` with a negative inset) is invisible to
 * `getBoundingClientRect`. So the helper probes with `document.elementFromPoint`: from the control's centre it walks
 * outwards along both axes for as long as the point still resolves to the control, to a descendant of it, or to a label
 * that names it, and the length of that run is the hit width and height. A row made tappable through its `<label>`
 * counts as the control's hit area (DESIGN.md "Space, size and shape": the whole row is the target).
 *
 * Inline links inside a sentence are exempt from WCAG 2.5.8 and are not told apart from a link standing alone by
 * geometry, so a text link is exempt only when it is listed by the spec (`exceptions`), with its reason.
 * @usage `const small = await undersizedControls(page, { exceptions: [{ selector: '…', reason: '…' }] })`; the spec
 * asserts `small` is empty. Each entry names the control (role, accessible name or text, test id) and its hit box.
 * @responsibility Measuring only. Which screens are walked and which controls are exempt belongs to the spec.
 */

import type { Page } from '@playwright/test'

/** The 44 px floor of DESIGN.md "Space, size and shape". */
export const PHONE_FLOOR = 44

export interface HitAreaException {
  /** CSS selector of the exempt control(s) */
  selector: string
  /** Why the control is below the floor, one line (it documents the list in the spec) */
  reason: string
}

export interface UndersizedControl {
  /** Tag, role, accessible name or text, test id: enough to find the control in the source */
  control: string
  width: number
  height: number
}

export interface HitAreaOptions {
  exceptions?: readonly HitAreaException[]
  /** Smallest hit side in px (default 44) */
  floor?: number
  /** Only the controls inside this selector (a state whose neighbours the screen's other entries cover) */
  within?: string
}

const CONTROLS = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="combobox"]',
].join(',')

export async function undersizedControls(page: Page, options: HitAreaOptions = {}): Promise<UndersizedControl[]> {
  const floor = options.floor ?? PHONE_FLOOR
  const exceptions = (options.exceptions ?? []).map((entry) => entry.selector)
  return page.evaluate(
    ({ controls, floor: min, exceptions: exempt, within }) => {
      const found: { control: string, width: number, height: number }[] = []
      const viewport = { w: window.innerWidth, h: window.innerHeight }

      const visible = (el: Element): boolean => {
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false
        const style = getComputedStyle(el)
        if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false
        // Faded out (a control that shows on focus or hover only): nothing to tap
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
        // Not in the viewport (an off-screen column page, a scrolled-away row): nothing to tap right now
        if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewport.w || rect.top >= viewport.h) return false
        return !el.closest('[aria-hidden="true"], [inert], [hidden]')
      }

      const label = (el: Element): string => {
        const html = el as HTMLElement
        const name = el.getAttribute('aria-label') || (html.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)
        const role = el.getAttribute('role') || el.tagName.toLowerCase()
        const id = el.getAttribute('data-testid')
        return `${role} "${name}"${id ? ` [${id}]` : ''}`
      }

      const reaches = (el: Element, x: number, y: number): boolean => {
        const inViewport = x >= 0 && y >= 0 && x < viewport.w && y < viewport.h
        if (!inViewport) {
          // The viewport edge cuts the probe, not the control: count the point while it lies in the control's own box
          const rect = el.getBoundingClientRect()
          return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        }
        const hit = document.elementFromPoint(x, y)
        if (!hit) return false
        if (el.contains(hit)) return true
        const named = (el as HTMLInputElement).labels
        const row = hit.closest('label')
        return !!named && !!row && Array.from(named).includes(row)
      }

      const run = (el: Element, horizontal: boolean): number => {
        const rect = el.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const reach = (offset: number) => (horizontal ? reaches(el, cx + offset, cy) : reaches(el, cx, cy + offset))
        if (!reach(0)) return 0
        // From the centre outwards in whole pixels (at most 40 px beyond the box, so a far hit area cannot run on forever),
        // then 0.1 px steps inside the last pixel: a 44 px box reads 44, not 43
        const edge = (sign: 1 | -1): number => {
          const limit = (horizontal ? rect.width : rect.height) / 2 + 40
          let whole = 0
          while (whole < limit && reach(sign * (whole + 1))) whole += 1
          let fine = 0
          while (fine < 0.9 && reach(sign * (whole + fine + 0.1))) fine += 0.1
          return whole + fine
        }
        return edge(1) + edge(-1)
      }

      for (const el of Array.from(document.querySelectorAll(controls))) {
        if (!visible(el)) continue
        if (within && !el.closest(within)) continue
        if (exempt.some((selector) => el.matches(selector))) continue
        // A native input made invisible and replaced by a styled sibling (a switch's sr-only input) is measured through its label
        if ((el as HTMLInputElement).type === 'hidden' || el.matches('input.sr-only')) continue
        const width = run(el, true)
        const height = run(el, false)
        if (width < min - 0.5 || height < min - 0.5) found.push({ control: label(el), width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10 })
      }
      return found
    },
    { controls: CONTROLS, floor, exceptions, within: options.within ?? '' },
  )
}
