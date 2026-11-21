import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Helpers for the recap and day-close stage (`assets/css/recap-stage.css`, #707): the one paper sheet whose scroller shrinks on a short
 * window and, below about 30 rem of height, hands the scrolling to the stage's column.
 */

/**
 * A window too short for the head, the buttons and a readable scroller: the content area is never squeezed to nothing, and with the
 * column scrolled to its end both buttons lie whole inside the column, so neither is cut off by the stage nor sits under the phone's tab bar.
 */
export async function expectStageFits(page: Page, stage: Locator, buttons: Locator[]) {
  const column = stage.locator('.recap-stage__column')
  const scroller = stage.locator('.recap-stage__scroll')
  expect(await scroller.evaluate(el => el.clientHeight), 'the content area keeps its height').toBeGreaterThanOrEqual(80)
  await column.evaluate(el => { el.scrollTop = el.scrollHeight })
  const columnBox = (await column.boundingBox())!
  const bar = await page.getByTestId('app-nav').boundingBox()
  for (const button of buttons) {
    await expect(button).toBeInViewport({ ratio: 1 })
    const box = (await button.boundingBox())!
    expect(box.y, 'inside the column, top').toBeGreaterThanOrEqual(columnBox.y - 1)
    expect(box.y + box.height, 'inside the column, bottom').toBeLessThanOrEqual(columnBox.y + columnBox.height + 1)
    if (bar) {
      const apart = box.y + box.height <= bar.y + 1 || box.y >= bar.y + bar.height - 1
      expect(apart, 'not under the app bar').toBe(true)
    }
  }
}

/**
 * The clip boxes (ancestors that clip) a box reaches beyond, by the pixels it is cut: `[]` when nothing cuts it. A dragged or flying deck
 * card must not be sliced by the sheet's scroller (#707), and a scroller must not become scrollable sideways under it.
 */
export function clippedBy(locator: Locator) {
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const cuts: Array<[string, number]> = []
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
      const clip = node.getBoundingClientRect()
      const cut = Math.max(0, clip.left - box.left) + Math.max(0, box.right - clip.right) + Math.max(0, clip.top - box.top) + Math.max(0, box.bottom - clip.bottom)
      if (cut > 1) cuts.push([node.className.toString().split(' ')[0] ?? node.tagName, Math.round(cut)])
    }
    return cuts
  })
}
