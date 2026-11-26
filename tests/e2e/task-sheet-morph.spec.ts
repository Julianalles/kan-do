/**
 * E2E: the desktop task sheet grows out of its card and folds back into it (#468).
 * Placement around the card, the clamp to the window, the grow and the fold (sampled per frame), no origin card,
 * reduced motion. The layout inside the sheet is asserted in task-detail.spec.ts; the ARIA shape in state-structure.spec.ts.
 */
import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'
import { settleAnimations } from './helpers/settle'

const card = (page: Page, id: string) => page.locator(`.task[data-task-id="${id}"]`).first()

/** Records the dialog's box on every frame from now on, until the dialog is gone. */
const sampleDialog = (page: Page) =>
  page.evaluate(() => {
    const win = window as unknown as { __samples: { w: number, h: number, x: number, y: number }[] }
    win.__samples = []
    const tick = () => {
      const el = document.querySelector('[role="dialog"]')
      if (el) {
        const r = el.getBoundingClientRect()
        win.__samples.push({ w: r.width, h: r.height, x: r.x, y: r.y })
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

const samples = (page: Page) =>
  page.evaluate(() => (window as unknown as { __samples: { w: number, h: number, x: number, y: number }[] }).__samples)

test.beforeEach(async ({ context }) => {
  await seedLocalBoard(context)
})

test.describe('card to sheet morph (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('the sheet is centred on its card, 720 px wide, and grows out of the card', async ({ page }) => {
    await page.goto('/tasks')
    const origin = card(page, 'seed-progress-1')
    await expect(origin).toBeVisible()
    const cardBox = (await origin.boundingBox())!
    await sampleDialog(page)
    await origin.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await settleAnimations(page)

    const box = (await dialog.boundingBox())!
    expect(box.width).toBeCloseTo(720, 0)
    expect(box.x + box.width / 2).toBeCloseTo(cardBox.x + cardBox.width / 2, 0)
    // centred vertically too, unless that would reach into the app bar row (#518): then it starts right below it
    const bar = (await page.getByTestId('app-nav').boundingBox())!
    const barBottom = bar.y + bar.height
    expect(box.y).toBeCloseTo(Math.max(cardBox.y + cardBox.height / 2 - box.height / 2, barBottom), 0)

    // The first frames are card-sized and the box widens frame by frame: a grow, not a pop
    const frames = await samples(page)
    expect(frames[0]!.w).toBeLessThan(500)
    expect(frames.some(frame => frame.w > 500 && frame.w < 719)).toBe(true)
    expect(frames.at(-1)!.w).toBeCloseTo(720, 0)
  })

  test('the content holds its final size while the sheet grows: its last line stays in its place in the panel (#659)', async ({ page }) => {
    await page.goto('/tasks')
    const origin = card(page, 'seed-open-1')
    await expect(origin).toBeVisible()
    await page.evaluate(() => {
      const win = window as unknown as { __lines: number[] }
      win.__lines = []
      const tick = () => {
        const panel = document.querySelector('[role="dialog"]')
        const line = document.querySelector('[data-testid="task-metadata"]')
        if (panel && line) win.__lines.push(Math.round(line.getBoundingClientRect().y - panel.getBoundingClientRect().y))
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await origin.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await settleAnimations(page)
    const lines = await page.evaluate(() => (window as unknown as { __lines: number[] }).__lines)
    expect(lines.length).toBeGreaterThan(5)
    // Clipped by the growing panel, never re-laid out inside it (it used to follow the panel's height: 172 px of travel in a few frames).
    // What is left is the few px between the height measured while the panel was hidden and the settled one.
    expect(Math.max(...lines) - Math.min(...lines), `offsets ${lines.join(',')}`).toBeLessThan(16)
  })

  test('a card at the window edge gives a sheet that keeps 16 px to the edges', async ({ page }) => {
    await page.goto('/tasks')
    await expect(card(page, 'seed-done-1')).toBeVisible()
    await card(page, 'seed-done-1').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await settleAnimations(page)
    const box = (await dialog.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(15)
    expect(box.y).toBeGreaterThanOrEqual(15)
    expect(box.x + box.width).toBeLessThanOrEqual(1280 - 15)
    expect(box.y + box.height).toBeLessThanOrEqual(800 - 15)
  })

  test('a card high in the left column leaves the whole app bar uncovered (#518)', async ({ page }) => {
    await page.goto('/tasks')
    const origin = card(page, 'seed-open-1')
    await expect(origin).toBeVisible()
    await origin.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await settleAnimations(page)
    const sheet = (await dialog.boundingBox())!
    const bar = (await page.getByTestId('app-nav').boundingBox())!
    // the sheet starts at or below the bar row, and no part of the centred group (wordmark, pill, Mehr) lies under it
    expect(sheet.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1)
    for (const id of ['app-nav-brand', 'app-nav-pill', 'app-nav-more']) {
      const part = (await page.getByTestId(id).boundingBox())!
      expect(part.y + part.height, id).toBeLessThanOrEqual(sheet.y)
    }
    expect(sheet.x).toBeGreaterThanOrEqual(15)
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(800 - 15)
  })

  test('closing folds the sheet back into its card and returns focus to it', async ({ page }) => {
    await page.goto('/tasks')
    const origin = card(page, 'seed-progress-1')
    await expect(origin).toBeVisible()
    await origin.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await settleAnimations(page)

    await sampleDialog(page)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/tasks$/)
    const frames = await samples(page)
    // The box shrinks toward the card's size while it folds
    expect(Math.min(...frames.map(frame => frame.w))).toBeLessThan(500)
    expect(frames.at(-1)!.w).toBeLessThan(frames[0]!.w)
    await expect(page.locator('.task-wrapper[data-task-id="seed-progress-1"]')).toBeFocused()
  })

  test('a click outside folds it and the scrim covers the whole window', async ({ page }) => {
    await page.goto('/tasks')
    await card(page, 'seed-open-2').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await settleAnimations(page)
    const scrim = await page.evaluate(() => {
      const el = [...document.querySelectorAll('body > div')].find(node => getComputedStyle(node).position === 'fixed' && node.getBoundingClientRect().width === window.innerWidth)
      return el ? { w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height } : null
    })
    expect(scrim).toEqual({ w: 1280, h: 800 })
    // An outside press in the first 600 ms is the second click of a double-click and is swallowed (kd#25): press until it counts
    await expect(async () => {
      await page.mouse.click(1250, 780)
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 1000 })
    }).toPass()
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test('a task without a card on the page opens centred', async ({ page }) => {
    await page.goto('/tasks/no-such-card')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await settleAnimations(page)
    await expect(page.getByTestId('task-not-found')).toBeVisible()
    const box = (await dialog.boundingBox())!
    expect(box.x + box.width / 2).toBeCloseTo(640, 0)
    // The frame's height is odd (403 px) and it stands on a whole pixel: the centre is within half a pixel
    expect(Math.abs(box.y + box.height / 2 - 400)).toBeLessThanOrEqual(0.5)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' })

    test('opens at the same place and never passes through a card-sized box', async ({ page }) => {
      await page.goto('/tasks')
      const origin = card(page, 'seed-progress-1')
      await expect(origin).toBeVisible()
      const cardBox = (await origin.boundingBox())!
      await sampleDialog(page)
      await origin.click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await settleAnimations(page)
      const frames = await samples(page)
      expect(Math.min(...frames.map(frame => frame.w))).toBeCloseTo(720, 0)
      const box = (await page.getByRole('dialog').boundingBox())!
      expect(box.x + box.width / 2).toBeCloseTo(cardBox.x + cardBox.width / 2, 0)

      await sampleDialog(page)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const closing = await samples(page)
      expect(Math.min(...closing.map(frame => frame.w))).toBeCloseTo(720, 0)
    })
  })
})
