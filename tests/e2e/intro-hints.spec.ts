import { expect, test, type Page } from '@playwright/test'
import { seedLocalBoard, SEED_TASKS } from './helpers/seed'
import { callTasksStore, fullTask } from './helpers/store'
import { goToPlace } from './helpers/appNav'

/**
 * The intro hints' base (#800): the welcome setup starts them, one hint shows in the bottom overlay, doing the step
 * or "Schließen" ends it, and a user who did not come through the welcome setup sees none. The rules themselves
 * (order, three days, quiet day) are unit-tested (`tests/lib/introHints.test.ts`, `tests/composables/useIntroHints.test.ts`).
 */

const MOBILE = { width: 390, height: 844 }
/** A board with cards in Offen and nothing in Jetzt: the moment of "Start". */
const OPEN_ONLY = SEED_TASKS.filter((task) => task.status !== 1)

const hint = (page: Page) => page.getByTestId('intro-hint')
const record = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('settings-store') ?? '{}') as { introHints?: { quietDay: string | null, hints: Record<string, { answered: boolean, days: string[] }> } | null }).introHints ?? null)

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(page.locator('#column-open')).toBeVisible()
}

test('the welcome setup starts the hints: "Start" shows with the first card in Offen and ends when a card is in Jetzt', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByRole('button', { name: 'Jetzt starten' }).click()
  await page.getByRole('button', { name: 'Zum Board' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect.poll(() => record(page)).toEqual({ on: true, quietDay: null, hints: {} })
  // The empty board keeps its own empty state: no hint yet
  await expect(hint(page)).toHaveCount(0)

  await callTasksStore(page, { action: 'addTask', args: [fullTask({ id: 'first', title: 'Erste Aufgabe', status: 0 })] })
  await expect(hint(page)).toBeVisible()
  await expect(page.getByTestId('intro-hint-host')).toHaveAttribute('role', 'status')
  await expect(hint(page)).toContainText('Ziehe nach Jetzt, woran du jetzt arbeitest. In Jetzt liegt immer nur eine Aufgabe.')
  // On screen: today is stored for the hint
  await expect.poll(async () => (await record(page))?.hints.start?.days.length).toBe(1)

  await callTasksStore(page, { action: 'updateTask', args: ['first', { status: 1 }] })
  await expect(hint(page)).toHaveCount(0)
  await expect.poll(async () => (await record(page))?.hints.start?.answered).toBe(true)

  // An ended hint never returns: Jetzt empty again, after a reload too
  await callTasksStore(page, { action: 'updateTask', args: ['first', { status: 0 }] })
  await page.reload()
  await expect(page.locator('#column-open')).toBeVisible()
  await expect(page.locator('.task-wrapper')).toHaveCount(1)
  await expect(hint(page)).toHaveCount(0)
})

test('"Schließen" ends the hint, focus lands on the board, and it stays away after a reload', async ({ context, page }) => {
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true, once: true })
  await gotoBoard(page)
  await expect(hint(page)).toBeVisible()

  const close = page.getByTestId('intro-hint-close')
  await close.focus()
  await page.keyboard.press('Enter')
  await expect(hint(page)).toHaveCount(0)
  await expect(page.locator('[data-task-sheet-return]')).toBeFocused()
  await expect.poll(async () => (await record(page))?.hints.start?.answered).toBe(true)
  expect((await record(page))?.quietDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  await page.reload()
  await expect(page.locator('#column-open')).toBeVisible()
  await expect(page.locator('.task-wrapper').first()).toBeVisible()
  await expect(hint(page)).toHaveCount(0)
})

test('a user who did not come through the welcome setup (an install from before the hints) sees none, and nothing is stored', async ({ context, page }) => {
  await seedLocalBoard(context, OPEN_ONLY)
  await gotoBoard(page)
  await expect(page.locator('.task-wrapper').first()).toBeVisible()
  await expect(hint(page)).toHaveCount(0)
  await expect(page.getByTestId('intro-hint-host')).toHaveCount(0)
  expect(await record(page)).toBeNull()
})

test('the hint shows on "Heute" only: it leaves on "Alle" and under a task sheet, and is back afterwards', async ({ context, page }) => {
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true })
  await gotoBoard(page)
  await expect(hint(page)).toBeVisible()

  await goToPlace(page, 'Alle')
  await expect(hint(page)).toHaveCount(0)
  await goToPlace(page, 'Heute')
  await expect(hint(page)).toBeVisible()

  await page.goto(`/tasks/${OPEN_ONLY[0]!.id}`)
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(hint(page)).toHaveCount(0)
})

test('390px: the phone text, centred above the app bar, clear of it; "Schließen" is a 44 px target', async ({ context, page }) => {
  await page.setViewportSize(MOBILE)
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true })
  await gotoBoard(page)
  await expect(hint(page)).toBeVisible()
  await expect(hint(page)).toContainText('Halte die Karte und ziehe sie an den rechten Rand, nach Jetzt.')

  const box = (await hint(page).boundingBox())!
  const bar = (await page.locator('.app-nav-pill').boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y)
  expect(Math.abs(box.x + box.width / 2 - MOBILE.width / 2)).toBeLessThanOrEqual(1)
  const close = (await page.getByTestId('intro-hint-close').boundingBox())!
  expect(close.height).toBeGreaterThanOrEqual(44)
  expect(close.width).toBeGreaterThanOrEqual(44)
})

test('a hidden page does not use up a day: the day is stored when the page is visible again', async ({ context, page }) => {
  // A tab in the background (or a desktop window left behind) still runs the midnight timer; only a seen hint counts
  await context.addInitScript(() => {
    let state: DocumentVisibilityState = 'hidden'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    ;(window as unknown as { __setVisibility: (value: DocumentVisibilityState) => void }).__setVisibility = (value) => {
      state = value
      document.dispatchEvent(new Event('visibilitychange'))
    }
  })
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true, once: true })
  await gotoBoard(page)
  await expect(hint(page)).toBeVisible()
  // Give a wrongly stored day time to show up
  await page.waitForTimeout(500)
  expect((await record(page))?.hints.start?.days ?? []).toHaveLength(0)

  await page.evaluate(() => (window as unknown as { __setVisibility: (value: string) => void }).__setVisibility('visible'))
  await expect.poll(async () => (await record(page))?.hints.start?.days.length).toBe(1)
})

test('desktop: the column button and the end of the board rest a gap above the sheet, in a wide and a narrow window', async ({ context, page }) => {
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true })
  for (const size of [{ width: 1280, height: 720 }, { width: 800, height: 720 }]) {
    await page.setViewportSize(size)
    await gotoBoard(page)
    await expect(hint(page)).toBeVisible()
    // The fade and the guided move of the buttons have settled
    await expect.poll(async () => {
      const sheetTop = (await hint(page).boundingBox())!.y
      const footer = (await page.locator('#column-done .column-footer').first().boundingBox())
      return footer ? Math.round(sheetTop - (footer.y + footer.height)) : null
    }).toBeGreaterThanOrEqual(15)
  }
})
