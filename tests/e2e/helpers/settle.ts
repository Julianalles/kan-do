/**
 * @module settle
 * @description Shared E2E helper to wait until the page has stopped animating, instead of sleeping.
 */

import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Waits two frames (pending events and navigations run), then awaits every animation with finite
 * iterations. Infinite ones (the loading spinner) never finish and are skipped;
 * a cancelled animation rejects `finished` with an AbortError, which counts as settled.
 */
export async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const finite = document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    await Promise.all(finite.map(animation => animation.finished.catch(() => undefined)))
  })
}

/**
 * Waits until the desktop task sheet has finished its open morph (`TaskMorphShell`, 340 ms of Web Animations):
 * the panel is visible, its running animations are gone and `settle()` of the shell has marked it `data-settled`.
 * A shot taken earlier captures a transient: `animations: 'disabled'` fast-forwards the morph but the shell holds the
 * end frame (`fill: both`) until it cancels, so text sits on an animated layer and its antialiasing differs from the
 * resting sheet; which of the two a shot sees depends on machine load (#520). The mark is
 * what `playOpen` removes at its start (the frame's height is the same before and after the morph since #705, so it cannot tell), so a panel
 * that mounted but has not begun to animate yet does not pass.
 */
export async function settleSheet(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const panel = document.querySelector<HTMLElement>('.task-morph-panel')
    return !!panel
      && panel.style.visibility === 'visible'
      && panel.dataset.settled === 'true'
      && panel.getAnimations({ subtree: true }).length === 0
  })
}

/**
 * Settles a stack expand/collapse: the list's `data-stack-animating` flag (#197) is gone and no finite
 * animation is left. Call it after asserting the resulting state (member count, header), never mid-drag.
 */
export async function settleStack(page: Page): Promise<void> {
  // Two frames first: the flag is set in the render flush after the click, so `toHaveCount(0)` cannot pass before it exists
  await flushFrames(page)
  await expect(page.locator('[data-stack-animating]')).toHaveCount(0)
  await settleAnimations(page)
}

/**
 * Waits until the end-of-drag motion of a drop or a cancelled drag has run out (kd#181): the floating preview is gone
 * and no card carries the landing or set-down mark. dnd-kit then hands focus back to the dragged card one frame after
 * the drop animation (`restoreFocus`, only for a keyboard drag), so a focus move made earlier is overridden once the
 * motion ends: under load that was `stack-a11y` failing with a1 "inactive" after Enter (kd#231). Call it after a keyboard
 * drag, before the next focus assertion. `settleAnimations` is not enough: the set-down mark is a timer, not an animation.
 */
export async function settleDropMotion(page: Page): Promise<void> {
  await expect(page.locator('[data-dnd-dropping], .kando-dnd-landing, .kando-dnd-set-down')).toHaveCount(0)
  await flushFrames(page)
}

/**
 * The only sanctioned fixed sleep in the stack specs (ESLint bans `page.waitForTimeout` there): a
 * dwell that is the point of the test, e.g. a touch hold or the edge-zone hold, or the fixed pacing
 * between synthetic touch moves. Pass a named constant or a pacing parameter, never a bare number
 * that guesses an animation duration.
 */
export async function dwell(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms)
}

/**
 * Two animation frames, nothing more: pending pointer/keyboard events and Vue re-renders have run.
 * Safe mid-drag (unlike `settleAnimations`, which awaits animations that a held drag may pause) and
 * the lead-in for a negative assertion ("no sheet", "no ghost") so it cannot run before the event.
 */
export async function flushFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

/**
 * Focuses `target` and waits until it holds focus. A card of a just-expanded stack is in the DOM (and "visible") one
 * frame before dnd-kit gives its wrapper a `tabindex`, and a `focus()` in that frame does nothing: the next key press
 * then goes to `body` (Ctrl+K opens the palette without the card's commands, Enter opens no sheet; #572, #574). Poll
 * the focus instead of trusting one call; idempotent, so safe to repeat.
 */
export async function focusUntilActive(target: Locator): Promise<void> {
  await expect.poll(async () => {
    await target.focus()
    return target.evaluate(el => el === document.activeElement)
  }, { message: 'the element takes focus' }).toBe(true)
}
