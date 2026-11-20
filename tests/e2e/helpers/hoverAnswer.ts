/**
 * @module hoverAnswer
 * @description E2E helper for DESIGN.md "States": a pressable shows the hand cursor and answers the pointer with a
 * changed look (#592, sweep guard 102). It hovers each visible pressable of the current page and compares a snapshot
 * of the paint-relevant style (colours, rule, shadow, outline, opacity, filter, scale) of the control, its
 * descendants, the ancestors that sit on its box (a wrapper that carries the hover fill, as `InlineEditable`'s
 * root does) and their `::before`/`::after`, at rest and with the pointer on it. A hover that only a class name
 * promises (`hover:bg-transparent` on a ghost button) shows as "no change" here.
 * @usage `const silent = await silentPressables(page, { exceptions })`; the spec asserts `silent` is empty.
 * @responsibility Measuring only. Which pages are walked and which pressables are exempt belongs to the spec.
 */

import type { Page } from '@playwright/test'

export interface HoverException {
  /** CSS selector of the exempt pressable(s) */
  selector: string
  /** Why the pressable does not answer, one line (it documents the list in the spec) */
  reason: string
}

export interface SilentPressable {
  /** Tag, role, accessible name or text, test id: enough to find the pressable in the source */
  control: string
  /** What is wrong: the cursor it shows, or "no change under the pointer" */
  problem: string
}

export const PRESSABLES = [
  'button:not(:disabled)',
  'a[href]',
  'summary',
  '[role="button"]:not([aria-disabled="true"])',
  '[role="radio"]:not([aria-disabled="true"]):not(:disabled)',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="switch"]',
].join(',')

export async function silentPressables(page: Page, options: { exceptions?: readonly HoverException[] } = {}): Promise<SilentPressable[]> {
  const exempt = (options.exceptions ?? []).map((entry) => entry.selector)
  // The helpers live in the page so the hover loop can read computed styles between two pointer moves
  await page.evaluate(
    ({ selector, exempt: skip, SELECTED }) => {
      const visible = (el: Element): boolean => {
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false
        const style = getComputedStyle(el)
        if (style.visibility === 'hidden' || style.display === 'none') return false
        if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false
        return !el.closest('[aria-hidden="true"], [inert], [hidden]')
      }
      ;(window as unknown as { __pressables: Element[] }).__pressables = Array.from(document.querySelectorAll(selector))
        // A control in its Selected state (a picked swatch, the current place, the open tab) already wears the fill; Hover is the answer of the others
        .filter((el) => visible(el) && !el.matches(SELECTED) && !skip.some((s) => el.matches(s)))
    },
    { selector: PRESSABLES, exempt, SELECTED: '[aria-selected="true"], [aria-checked="true"], [aria-current="page"], [aria-pressed="true"]' },
  )
  const total = await page.evaluate(() => (window as unknown as { __pressables: Element[] }).__pressables.length)
  const found: SilentPressable[] = []
  for (let index = 0; index < total; index++) {
    const centre = await page.evaluate((i) => {
      const el = (window as unknown as { __pressables: Element[] }).__pressables[i]!
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const rect = el.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }, index)
    // Rest: the pointer far from everything
    await page.mouse.move(1, 1)
    const rest = await snapshot(page, index)
    await page.mouse.move(centre.x, centre.y)
    let hover = rest
    // A transition runs for up to the base duration: poll for the change instead of waiting a fixed time
    for (let attempt = 0; attempt < 12 && hover.paint === rest.paint; attempt++) {
      await page.waitForTimeout(50)
      hover = await snapshot(page, index)
    }
    if (!hover.hit) continue // covered by something else at its centre (a scrim, a neighbour): not hoverable here
    if (hover.cursor !== 'pointer') found.push({ control: hover.name, problem: `cursor is ${hover.cursor}, not the hand` })
    else if (hover.paint === rest.paint) found.push({ control: hover.name, problem: 'no change under the pointer' })
  }
  return found
}

interface Snapshot { name: string, cursor: string, paint: string, hit: boolean }

function snapshot(page: Page, index: number): Promise<Snapshot> {
  return page.evaluate((i) => {
    const el = (window as unknown as { __pressables: Element[] }).__pressables[i]!
    const props = ['color', 'backgroundColor', 'backgroundImage', 'borderTopColor', 'borderBottomColor', 'boxShadow', 'textDecorationLine', 'textDecorationColor', 'outlineColor', 'outlineWidth', 'opacity', 'filter', 'scale', 'transform'] as const
    const paintOf = (node: Element): string => {
      const parts: string[] = []
      for (const pseudo of [null, '::before', '::after'] as const) {
        const style = getComputedStyle(node, pseudo)
        parts.push(props.map((p) => style[p]).join('|'))
      }
      return parts.join('||')
    }
    // The control, its descendants, and the ancestors that sit on its box (a wrapper holding the hover fill; it may hold a reserved line below, `InlineEditable`'s error row)
    const rect = el.getBoundingClientRect()
    const nodes: Element[] = [el, ...Array.from(el.querySelectorAll('*')).slice(0, 12)]
    for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const box = parent.getBoundingClientRect()
      const same = Math.abs(box.left - rect.left) <= 8 && Math.abs(box.right - rect.right) <= 8 && Math.abs(box.top - rect.top) <= 8 && box.bottom - rect.bottom <= 40 && rect.bottom - box.bottom <= 8
      if (!same) break
      nodes.push(parent)
    }
    const html = el as HTMLElement
    const name = el.getAttribute('aria-label') || (html.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    const role = el.getAttribute('role') || el.tagName.toLowerCase()
    const testid = el.getAttribute('data-testid')
    const centre = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      name: `${role} "${name}"${testid ? ` [${testid}]` : ''}`,
      cursor: getComputedStyle(el).cursor,
      paint: nodes.map(paintOf).join('###'),
      hit: !!centre && (el.contains(centre) || centre.contains(el)),
    }
  }, index)
}
