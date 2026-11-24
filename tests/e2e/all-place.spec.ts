import { test, expect, type Locator, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { dropSettled, edgeDwell, finger, hover, pickUp } from './helpers/dnd'
import { dwell, settleAnimations } from './helpers/settle'
import { EDGE_HOLD_DWELL_MS } from './helpers/constants'
import { appNav } from './helpers/appNav'
import { openTaskMenu } from './helpers/taskMenu'

/**
 * #354 (epic #334): the place "Alle". `/all` is a second path of the board page: "Alle Aufgaben" beside Offen, the
 * two planning moves, the sideways move to Heute, and on a phone two places with their own swipe pages.
 * Local board; a task is "not planned" by its `notPlanned` marker (#353).
 * #355: the drag between "Alle Aufgaben" and Offen, with the board's own drag (page.mouse, keyboard, 390 edge scroll).
 */

const NOW = new Date().toISOString()
const task = (o: Partial<SeedTask> & Pick<SeedTask, 'id' | 'title' | 'status'>): SeedTask => ({
  priority: 1,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  topic: null,
  custom: {},
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
})
const held = (id: string, title: string, topic: string | null = null): SeedTask =>
  task({ id, title, status: 0, topic, notPlanned: true })
const open = (id: string, title: string, topic: string | null = null, hours: number | null = null): SeedTask =>
  task({ id, title, status: 0, topic, timeBoxSeconds: hours === null ? null : hours * 3600 })

/** Two tasks held off the board, two in Offen, one each in Wartet and Erledigt; Jetzt is empty */
const BOARD: SeedTask[] = [
  held('np-1', 'Angebot kalkulieren', 'Kunden'),
  held('np-2', 'Belege sortieren', 'Büro'),
  open('open-1', 'Rechnung schicken', 'Büro'),
  open('open-2', 'Pflanzplan zeichnen', 'Kunden'),
  task({ id: 'wait-1', title: 'Rückruf abwarten', status: 2 }),
  task({ id: 'done-1', title: 'Werkzeug prüfen', status: 3, completedAt: NOW }),
]

const board = (page: Page) => page.locator('.board')
const notPlanned = (page: Page) => page.getByTestId('not-planned')
const notPlannedIds = (page: Page) =>
  notPlanned(page).locator('[data-not-planned-id]').evaluateAll(els => els.map(el => el.getAttribute('data-not-planned-id')))
const openIds = (page: Page) =>
  page.locator('#column-open-list > .task-wrapper').evaluateAll(els => els.map(el => el.getAttribute('data-task-id')))
const item = (page: Page, id: string) => notPlanned(page).locator(`[data-not-planned-id="${id}"]`)
const openCard = (page: Page, id: string) => page.locator(`#column-open .task-wrapper[data-task-id="${id}"]`)
const placeLink = (page: Page, place: 'all' | 'board') => page.getByTestId(`app-nav-place-${place}`)
/** The app bar's Heute segment: on a "Alle" opened by hand the pill keeps its three places */
const toHeute = (page: Page) => page.getByTestId('app-nav-place-board')

/** The strip has arrived: no move flag, no running animation */
async function atRest(page: Page) {
  await expect(board(page)).not.toHaveAttribute('data-place-moving', '')
  await settleAnimations(page)
}

/**
 * Whether `.board` carries `data-place-moving` at any time from now until the place has changed and the flag is
 * down again. Start it before the click: the flag is a 420 ms window, too short to poll for under load.
 */
function sawMoveFlag(page: Page): Promise<boolean> {
  return page.evaluate(() => new Promise<boolean>((resolve) => {
    const el = document.querySelector('.board')!
    const from = el.getAttribute('data-place')
    let seen = false
    const done = () => { observer.disconnect(); resolve(seen) }
    const observer = new MutationObserver(() => {
      if (el.hasAttribute('data-place-moving')) seen = true
      // Settled on the other place: with motion the flag has come and gone, without it it never came
      else if (el.getAttribute('data-place') !== from) requestAnimationFrame(() => requestAnimationFrame(() => { if (!el.hasAttribute('data-place-moving')) done() }))
    })
    observer.observe(el, { attributes: true })
    setTimeout(done, 5000)
  }))
}

/**
 * The title that fades out in Offen's header during a place change (#375), or null when none showed within `ms`.
 * Started before the click, like `sawMoveFlag`: the outgoing title is in the DOM for the 420 ms of the move only.
 */
function sawOutgoingTitle(page: Page, ms = 3000): Promise<string | null> {
  return page.evaluate(wait => new Promise<string | null>((resolve) => {
    const header = document.querySelector('#column-open .column-header')!
    const done = (text: string | null) => { observer.disconnect(); resolve(text) }
    const observer = new MutationObserver(() => {
      const outgoing = header.querySelector('.column-header__outgoing')
      if (outgoing) done(outgoing.textContent)
    })
    observer.observe(header, { childList: true, subtree: true })
    setTimeout(() => done(null), wait)
  }), ms)
}

/** The in-card flow of #567 ends in a save: the title, then Enter through the steps until the card is gone (a slide of 140 ms lies between two steps) */
async function saveInCard(page: Page, text: string) {
  const flow = page.getByTestId('new-card-flow')
  await expect(page.getByTestId('new-card-title')).toBeFocused()
  await page.getByTestId('new-card-title').fill(text)
  await page.keyboard.press('Enter')
  for (let i = 0; i < 8 && await flow.count() > 0; i++) {
    await expect(page.locator('.ncf-fwd-enter-active, .ncf-fwd-leave-active')).toHaveCount(0)
    await page.keyboard.press('Enter')
  }
  await expect(flow).toHaveCount(0)
}

async function gotoAll(page: Page) {
  await page.goto('/all')
  await expect(board(page)).toHaveAttribute('data-place', 'all')
  await expect(page.locator('#column-open')).toBeVisible()
  await atRest(page)
}

test.describe('The place "Alle" (#354), desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('is the first place of the app bar; the start page stays Heute', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await page.goto('/')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(appNav(page).locator('.app-nav-place')).toHaveText(['Alle', 'Heute', 'Statistik'])
    await expect(placeLink(page, 'board')).toHaveAttribute('aria-current', 'page')
    // Heute shows its three columns, "Alle Aufgaben" is not there for anyone
    await expect(notPlanned(page)).toBeHidden()

    await placeLink(page, 'all').click()
    await expect(page).toHaveURL(/\/all$/)
    // #416: opened by hand, the pill keeps its three places and Alle is the current one
    await expect(appNav(page).locator('.app-nav-place')).toHaveText(['Alle', 'Heute', 'Statistik'])
    await expect(toHeute(page)).toHaveAttribute('href', '/tasks')
    await expect(placeLink(page, 'all')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('app-nav-continue')).toHaveCount(0)
    await atRest(page)
    await expect(notPlanned(page).getByRole('heading', { name: 'Alle Aufgaben' })).toBeVisible()
    await expect(page.locator('#column-open')).toBeVisible()
    await expect(page.locator('#column-progress')).toBeHidden()
    await expect(page.locator('#column-done')).toBeHidden()
    expect(await notPlannedIds(page)).toEqual(['np-1', 'np-2'])
    expect(await openIds(page)).toEqual(['open-1', 'open-2'])
    // One rule for both columns (#609): a board with one source shows no source icon on any card
    await expect(item(page, 'np-1').getByTestId('task-source-icon')).toHaveCount(0)
    await expect(openCard(page, 'open-1').getByTestId('task-source-icon')).toHaveCount(0)
  })

  test('the board is one strip: Offen is the same column before and after the move, and the side out of view takes no drop, focus or reader', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await page.goto('/tasks')
    await expect(openCard(page, 'open-1')).toBeVisible()
    // Mark the live DOM node and scroll state a remount would lose
    await page.locator('#column-open').evaluate((el) => { (el as HTMLElement & { __same?: boolean }).__same = true })

    // The move flag is up for 420 ms only: record it from before the click instead of racing it
    const travelled = sawMoveFlag(page)
    await placeLink(page, 'all').click()
    await expect(board(page)).toHaveAttribute('data-place', 'all')
    // Motion is on in this project: both sides were painted while the strip travelled
    expect(await travelled).toBe(true)
    await atRest(page)
    expect(await page.locator('#column-open').evaluate(el => (el as HTMLElement & { __same?: boolean }).__same)).toBe(true)
    expect(await page.locator('.column-group-mid').evaluate(el => getComputedStyle(el).display)).toBe('none')
    await expect(page.locator('#column-done')).toHaveAttribute('inert', '')
    // No sideways scroll from the strip that is wider than the page
    expect(await page.evaluate(() => { window.scrollTo(15, 0); return window.scrollX })).toBe(0)

    await toHeute(page).click()
    await expect(page).toHaveURL(/\/tasks$/)
    await atRest(page)
    expect(await page.locator('#column-open').evaluate(el => (el as HTMLElement & { __same?: boolean }).__same)).toBe(true)
    expect(await notPlanned(page).evaluate(el => getComputedStyle(el).display)).toBe('none')
    await expect(notPlanned(page)).toHaveAttribute('inert', '')
    await expect(page.locator('#column-done')).toBeVisible()
    // The three columns of Heute sit where a direct load puts them
    const moved = await page.locator('#column-open').boundingBox()
    await page.reload()
    await expect(openCard(page, 'open-1')).toBeVisible()
    expect((await page.locator('#column-open').boundingBox())!.x).toBeCloseTo(moved!.x, 0)
  })

  test('reduced motion: the place changes at once', async ({ context, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await seedLocalBoard(context, BOARD)
    await page.goto('/tasks')
    await expect(openCard(page, 'open-1')).toBeVisible()
    const flagged = sawMoveFlag(page)
    await placeLink(page, 'all').click()
    await expect(notPlanned(page)).toBeVisible()
    expect(await flagged).toBe(false)
    expect(await page.evaluate(() => document.querySelector('.board')!.getAnimations().length)).toBe(0)
  })

  test('#375: the column beside "Alle Aufgaben" is headed "Heute" on "Alle" and "Offen" on Heute; the title fades with the move and one title is left', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await page.goto('/tasks')
    const heading = page.locator('#column-open').getByRole('heading', { level: 2 })
    await expect(heading).toHaveText('Offen')

    let outgoing = sawOutgoingTitle(page)
    await placeLink(page, 'all').click()
    // The heading has one name from the first frame on: the title that fades out is not read
    await expect(heading).toHaveAccessibleName('Heute')
    expect(await outgoing).toBe('Offen')
    await atRest(page)
    await expect(page.locator('.column-header__outgoing')).toHaveCount(0)
    await expect(heading).toHaveText('Heute')
    await expect(notPlanned(page).getByRole('heading', { level: 2 })).toHaveText('Alle Aufgaben')

    outgoing = sawOutgoingTitle(page)
    await toHeute(page).click()
    await expect(heading).toHaveAccessibleName('Offen')
    expect(await outgoing).toBe('Heute')
    await atRest(page)
    await expect(page.locator('.column-header__outgoing')).toHaveCount(0)
    await expect(heading).toHaveText('Offen')

    // Two changes in a row: the title of the place that shows is left, alone
    await placeLink(page, 'all').click()
    await toHeute(page).click()
    await placeLink(page, 'all').click()
    await atRest(page)
    await expect(page.locator('.column-header__outgoing')).toHaveCount(0)
    await expect(heading).toHaveText('Heute')
  })

  test('#375: with reduced motion the title changes at once, without a fade', async ({ context, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await seedLocalBoard(context, BOARD)
    await page.goto('/tasks')
    const heading = page.locator('#column-open').getByRole('heading', { level: 2 })
    await expect(heading).toHaveText('Offen')
    const outgoing = sawOutgoingTitle(page, 800)
    await placeLink(page, 'all').click()
    await expect(heading).toHaveText('Heute')
    expect(await outgoing).toBeNull()
  })

  test('the arrow plans a card to the end of Offen; the mirrored arrow and "Nicht für heute planen" put it back on top; a reload keeps place and order', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD, {}, undefined, { once: true })
    await gotoAll(page)

    await item(page, 'np-1').getByRole('button', { name: 'Angebot kalkulieren: für heute einplanen' }).click()
    await expect.poll(() => openIds(page)).toEqual(['open-1', 'open-2', 'np-1'])
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-2'])
    await expect(page.getByTestId('plan-announcement')).toHaveText('Angebot kalkulieren ist für heute geplant.')

    // The mirrored arrow beside an Offen card shows under the pointer
    await openCard(page, 'open-1').hover()
    await openCard(page, 'open-1').getByRole('button', { name: 'Rechnung schicken: nicht für heute planen' }).click()
    await expect.poll(() => notPlannedIds(page)).toEqual(['open-1', 'np-2'])
    await expect(page.getByTestId('plan-announcement')).toHaveText('Rechnung schicken ist nicht mehr für heute geplant.')

    // The card menu does the same
    await settleAnimations(page)
    await openCard(page, 'open-2').locator('.task').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Nicht für heute planen' }).click()
    await expect.poll(() => notPlannedIds(page)).toEqual(['open-2', 'open-1', 'np-2'])
    await expect.poll(() => openIds(page)).toEqual(['np-1'])

    // Nothing else about the task changed, and the order is stored
    const stored = await page.evaluate(() => {
      const tasks = JSON.parse(localStorage.getItem('tasks-store') ?? '{}').tasks as Array<Record<string, unknown>>
      const boardStore = JSON.parse(localStorage.getItem('board-store') ?? '{}') as { notPlannedOrder: string[] }
      return { moved: tasks.find(t => t.id === 'open-2'), order: boardStore.notPlannedOrder }
    })
    expect(stored.moved).toMatchObject({ title: 'Pflanzplan zeichnen', topic: 'Kunden', status: 0, notPlanned: true, source: 'local' })
    expect(stored.order).toEqual(['open-2', 'open-1'])

    await page.reload()
    await expect(board(page)).toHaveAttribute('data-place', 'all')
    await expect.poll(() => notPlannedIds(page)).toEqual(['open-2', 'open-1', 'np-2'])
    expect(await openIds(page)).toEqual(['np-1'])
  })

  test('"Nicht für heute planen" is in the card menu on Heute too, and the card is then found on top under "Alle"', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await page.goto('/tasks')
    await openCard(page, 'open-2').locator('.task').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Nicht für heute planen' }).click()
    await expect(openCard(page, 'open-2')).toHaveCount(0)
    // A card outside Offen has no such entry
    await page.locator('#column-waiting .task').first().click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Als erledigt markieren' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Nicht für heute planen' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await placeLink(page, 'all').click()
    await atRest(page)
    expect(await notPlannedIds(page)).toEqual(['open-2', 'np-1', 'np-2'])
  })

  test('a "Alle Aufgaben" card opens its sheet, and closing it returns to "Alle"; the keyboard does both moves', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)

    await item(page, 'np-2').locator('.task').click()
    await expect(page).toHaveURL(/\/all\/np-2$/)
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('Belege sortieren')
    await expect(toHeute(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/all$/)
    await expect(sheet).toBeHidden()
    await expect(board(page)).toHaveAttribute('data-place', 'all')
    expect(await notPlannedIds(page)).toEqual(['np-1', 'np-2'])

    // Enter on the focused card opens it as well
    await item(page, 'np-1').getByRole('group', { name: 'Angebot kalkulieren' }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/all\/np-1$/)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/all$/)

    // The arrow is a button in the tab order; after the move focus is on the next card's arrow, not lost
    const pick = item(page, 'np-1').getByTestId('not-planned-pick')
    await pick.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => openIds(page)).toEqual(['open-1', 'open-2', 'np-1'])
    await expect(item(page, 'np-2').getByTestId('not-planned-pick')).toBeFocused()
  })

  test('planning the last held card by keyboard hands focus to "Aufgabe erstellen", not to the void (#658)', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD.filter(t => !t.notPlanned || t.id === 'np-1'))
    await gotoAll(page)
    expect(await notPlannedIds(page)).toEqual(['np-1'])
    await item(page, 'np-1').getByTestId('not-planned-pick').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('not-planned-create')).toBeFocused()
  })

  test('the topic focus is one state for both places and filters "Alle Aufgaben" and Offen', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    await page.getByTestId('focus-trigger').click()
    // Counted over what this place shows: two cards each
    await expect(page.getByTestId('focus-chip')).toHaveText(['Büro2', 'Kunden2'])
    await page.getByTestId('focus-chip').filter({ hasText: 'Büro' }).click()
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-2'])
    await expect.poll(() => openIds(page)).toEqual(['open-1'])

    // The same focus on Heute
    await toHeute(page).click()
    await atRest(page)
    await expect(page.getByTestId('focus-pill')).toBeVisible()
    expect(await openIds(page)).toEqual(['open-1'])

    // Planning the last matching card leaves "Keine Aufgaben gefunden."
    await placeLink(page, 'all').click()
    await atRest(page)
    await item(page, 'np-2').getByTestId('not-planned-pick').click()
    await expect(page.getByTestId('not-planned-no-match')).toHaveText('Keine Aufgaben gefunden.')
  })

  test('empty (#367, #567): one sentence and "Aufgabe erstellen" open the card in the list; the task made there lands under "Alle Aufgaben", not in Offen', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD.filter(t => !t.notPlanned))
    await gotoAll(page)
    await expect(page.getByTestId('not-planned-empty')).toHaveText('Keine weiteren Aufgaben vorhanden.')
    expect(await openIds(page)).toEqual(['open-1', 'open-2'])

    await page.getByTestId('not-planned-create').click()
    // The Heute flow: a card in the list, no sheet and no route change; the note gives way while it is open
    await expect(page).toHaveURL(/\/all$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(notPlanned(page).getByTestId('new-card-flow')).toBeVisible()
    await expect(page.locator('#column-open [data-testid="new-card-flow"]')).toHaveCount(0)
    await expect(page.getByTestId('not-planned-empty')).toHaveCount(0)
    await expect(page.getByTestId('not-planned-create')).toHaveCount(0)

    await saveInCard(page, 'Fenster ausmessen')
    await expect(notPlanned(page).locator('[data-not-planned-id]')).toHaveCount(1)
    await expect(notPlanned(page).locator('[data-not-planned-id] .task')).toContainText('Fenster ausmessen')
    await expect(page.getByTestId('not-planned-empty')).toHaveCount(0)
    await expect(page.getByTestId('not-planned-create')).toHaveCount(0)
    expect(await openIds(page)).toEqual(['open-1', 'open-2'])
    // Focus goes to the new card, where it now is
    await expect(notPlanned(page).locator('.not-planned__card')).toBeFocused()
  })

  test('#567: the add button of "Alle Aufgaben" opens the Heute card at the top of its list; the task is made not planned, the button is off meanwhile', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    const titles = () => notPlanned(page).locator('[data-not-planned-id] .task-title-text').allTextContents()

    // #380: the add button is in the header of "Alle Aufgaben", where the task lands; Offen's header has none here
    await expect(page.locator('#column-open [data-testid="add-task-header-button"]')).toHaveCount(0)
    const add = page.getByTestId('not-planned-add')
    await add.click()
    await expect(page).toHaveURL(/\/all$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const flow = notPlanned(page).getByTestId('new-card-flow')
    await expect(flow).toBeVisible()
    // The card stands above the first card of the list, and a second click opens no second card
    await settleAnimations(page)
    expect((await flow.boundingBox())!.y).toBeLessThan((await item(page, 'np-1').boundingBox())!.y)
    await expect(add).toBeDisabled()

    await saveInCard(page, 'Aus der Karte')
    await expect(add).toBeEnabled()
    await expect.poll(async () => (await titles())[0]).toContain('Aus der Karte')
    expect(await openIds(page)).toEqual(['open-1', 'open-2'])
    await expect(page.getByText('Aufgabe hinzugefügt', { exact: true })).toBeVisible()
    await expect(notPlanned(page).locator('.not-planned__card').first()).toBeFocused()
    await expect.poll(() => page.evaluate(() => {
      const tasks = JSON.parse(localStorage.getItem('tasks-store') ?? '{}').tasks as { title: string, status: number, notPlanned?: boolean }[]
      const found = tasks.find(t => t.title === 'Aus der Karte')
      return found ? [found.status, found.notPlanned] : null
    })).toEqual([0, true])
  })

  test('#758: a task confirmed in the card on "Alle" is stored at once, shows once while the card asks, and is under "Alle Aufgaben" after a reload', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD, {}, undefined, { once: true })
    await gotoAll(page)
    const flow = notPlanned(page).getByTestId('new-card-flow')
    const stored = () => page.evaluate(() => {
      const tasks = JSON.parse(localStorage.getItem('tasks-store') ?? '{}').tasks as { id: string, title: string, status: number, notPlanned?: boolean }[]
      return tasks.find(t => t.title === 'Vor dem Reload') ?? null
    })

    await page.getByTestId('not-planned-add').click()
    await expect(page.getByTestId('new-card-title')).toBeFocused()
    await page.getByTestId('new-card-title').fill('Vor dem Reload')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('new-card-step')).toBeVisible()
    await expect.poll(async () => (await stored())?.notPlanned).toBe(true)
    // one card: the flow, not also the task's own card in the list
    expect(await notPlannedIds(page)).toEqual(['np-1', 'np-2'])

    await page.reload()
    await expect(flow).toHaveCount(0)
    const id = (await stored())!.id
    await expect.poll(() => notPlannedIds(page)).toContain(id)
    expect(await openIds(page)).toEqual(['open-1', 'open-2'])
    expect(await stored()).toMatchObject({ status: 0, notPlanned: true })
  })

  test('#567: Esc and back out of the card; a typed title is given back with "Rückgängig"; a blank card closes on a press outside', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    const add = page.getByTestId('not-planned-add')
    const flow = notPlanned(page).getByTestId('new-card-flow')
    const titleField = page.getByTestId('new-card-title')

    await add.click()
    await expect(titleField).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(flow).toHaveCount(0)
    await expect(add).toBeFocused()
    expect(await notPlannedIds(page)).toEqual(['np-1', 'np-2'])

    await add.click()
    await titleField.fill('Fenster ausmessen')
    await page.keyboard.press('Escape')
    await expect(flow).toHaveCount(0)
    await page.getByRole('button', { name: 'Rückgängig' }).click()
    await expect(flow).toBeVisible()
    await expect(titleField).toHaveValue('Fenster ausmessen')
    await page.keyboard.press('Escape')
    await expect(flow).toHaveCount(0)

    // A blank card goes with a press beside it
    await add.click()
    await expect(flow).toBeVisible()
    await page.locator('#column-open h2').click()
    await expect(flow).toHaveCount(0)
  })

  test('#567: the sheet is still the way of the other entries; its task lands under "Alle Aufgaben" too, and opening it closes the card', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    await page.getByTestId('not-planned-add').click()
    await expect(notPlanned(page).getByTestId('new-card-flow')).toBeVisible()
    // The palette, the nav and the card menu navigate to `/all/add`: the same route change
    await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push('/all/add'))
    await expect(page).toHaveURL(/\/all\/add$/)
    await expect(notPlanned(page).getByTestId('new-card-flow')).toHaveCount(0)
    const sheet = page.getByRole('dialog')
    await sheet.getByPlaceholder('Aufgabe benennen…').fill('Aus dem Blatt')
    await sheet.getByRole('button', { name: 'Aufgabe erstellen' }).click()
    await expect(page).toHaveURL(/\/all$/)
    await expect(notPlanned(page).locator('[data-not-planned-id] .task-title-text', { hasText: 'Aus dem Blatt' })).toHaveCount(1)
    expect(await openIds(page)).toEqual(['open-1', 'open-2'])
  })

  test('the sheet of a not-planned task reads "Nicht geplant"; the picker plans it and puts it back (#359)', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    const storedNp1 = (from: Page) => from.evaluate(() => {
      const tasks = JSON.parse(localStorage.getItem('tasks-store') ?? '{}').tasks as { id: string, status: number, notPlanned?: boolean }[]
      const found = tasks.find(t => t.id === 'np-1')
      return found ? [found.status, found.notPlanned] : null
    })
    const status = page.getByTestId('task-status-select')
    const choose = async (name: string) => {
      await status.click()
      await page.getByRole('option', { name, exact: true }).click()
    }

    await item(page, 'np-1').locator('.task').click()
    await expect(page).toHaveURL(/\/all\/np-1$/)
    await expect(status).toHaveAccessibleName('Status: Nicht geplant')
    // Five choices, in the order of the places
    await status.click()
    await expect(page.getByRole('option')).toHaveText(['Nicht geplant', 'Offen', 'Jetzt', 'Wartet', 'Erledigt'])
    await page.getByRole('option', { name: 'Offen', exact: true }).click()

    // Planned: at the end of Offen, and the sheet stays on the task
    await expect(status).toHaveAccessibleName('Status: Offen')
    await expect(page).toHaveURL(/\/all\/np-1$/)
    await expect.poll(() => openIds(page)).toEqual(['open-1', 'open-2', 'np-1'])
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-2'])

    // Back: on top of "Alle Aufgaben"
    await choose('Nicht geplant')
    await expect(status).toHaveAccessibleName('Status: Nicht geplant')
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-1', 'np-2'])
    await expect.poll(() => openIds(page)).toEqual(['open-1', 'open-2'])

    // Wartet keeps it off today (#793): the picker reads the status, the card stays under "Alle Aufgaben"
    await choose('Wartet')
    await expect(status).toHaveAccessibleName('Status: Wartet')
    await expect.poll(() => storedNp1(page)).toEqual([2, true])
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-1', 'np-2'])

    // Jetzt always belongs to today: starting it plans it, and it stays planned in Wartet afterwards
    await choose('Jetzt')
    await expect(status).toHaveAccessibleName('Status: Jetzt')
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-2'])
    await choose('Wartet')
    await expect.poll(() => storedNp1(page)).toEqual([2, undefined])

    // And from there straight back: to Offen first, then off today's board
    await choose('Nicht geplant')
    await expect(status).toHaveAccessibleName('Status: Nicht geplant')
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-1', 'np-2'])
    await expect.poll(() => openIds(page)).toEqual(['open-1', 'open-2'])
    await expect.poll(() => storedNp1(page)).toEqual([0, true])
  })

  test('#567: Offen\'s card opened on Heute gives way on the move to "Alle"; its typed title comes back, one card at a time', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await page.goto('/tasks')
    await expect(page.locator('#column-open')).toBeVisible()
    await page.locator('#column-open').getByTestId('add-task-header-button').click()
    await page.getByTestId('new-card-title').fill('Von Heute')
    await placeLink(page, 'all').click()
    await expect(board(page)).toHaveAttribute('data-place', 'all')
    await atRest(page)
    await expect(page.getByTestId('new-card-flow')).toHaveCount(0)
    const add = page.getByTestId('not-planned-add')
    await expect(add).toBeEnabled()
    await add.click()
    await expect(page.getByTestId('new-card-flow')).toHaveCount(1)
    await expect(notPlanned(page).getByTestId('new-card-flow')).toBeVisible()
    await expect(add).toBeDisabled()
    await page.keyboard.press('Escape')
    // "Rückgängig" of the card that gave way reopens it with its title (one card only)
    await page.getByRole('button', { name: 'Rückgängig' }).first().click()
    await expect(page.getByTestId('new-card-flow')).toHaveCount(1)
  })

  test('a board without any task: both columns blank, the add button works', async ({ context, page }) => {
    await seedLocalBoard(context, [])
    await gotoAll(page)
    await expect(page.getByTestId('not-planned-empty')).toHaveCount(0)
    await expect(notPlanned(page).locator('[data-not-planned-id]')).toHaveCount(0)
    await expect(page.getByTestId('not-planned-add')).toBeEnabled()
  })

  test('#373: the arrow beside a "Alle Aufgaben" card shows on hover and keyboard focus only', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    const pick = item(page, 'np-1').getByTestId('not-planned-pick')
    const opacity = () => pick.evaluate(el => getComputedStyle(el).opacity)
    await settleAnimations(page)
    expect(await opacity()).toBe('0')
    await item(page, 'np-1').locator('.task').hover()
    await expect.poll(opacity).toBe('1')
    await page.mouse.move(5, 400)
    await expect.poll(opacity).toBe('0')
    // The keyboard finds it too: focus on the card, or on the arrow itself
    await page.keyboard.press('Tab')
    await item(page, 'np-1').getByRole('group', { name: 'Angebot kalkulieren' }).focus()
    await expect.poll(opacity).toBe('1')
    await item(page, 'np-2').getByRole('group', { name: 'Belege sortieren' }).focus()
    await expect.poll(opacity).toBe('0')
    await pick.focus()
    await expect.poll(opacity).toBe('1')
    await page.getByTestId('app-nav-place-statistics').click()
    await expect(page).toHaveURL(/\/statistics$/)
    await expect(page.getByTestId('app-nav-place-statistics')).toHaveAttribute('aria-current', 'page')
  })

  test('many items (#609): the page is the one scroll area; "Alle Aufgaben" grows with its cards and no column scrolls inside itself', async ({ context, page }) => {
    const many = Array.from({ length: 30 }, (_, i) => held(`many-${i}`, `Vorrat ${i}`))
    await seedLocalBoard(context, [...many, open('open-1', 'Rechnung schicken')])
    await gotoAll(page)
    // Nothing inside the board has a scroll box of its own: the side and Offen both grow the page
    const inner = await page.locator('.board').evaluate(board => [board, ...board.querySelectorAll('*')]
      .filter(el => el instanceof HTMLElement && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)
      .map(el => (el as HTMLElement).id || el.className))
    expect(inner).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true)
    await item(page, 'many-29').scrollIntoViewIfNeeded()
    await expect(item(page, 'many-29')).toBeInViewport()
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    // The app bar's way on stays in view while the page scrolls
    await expect(toHeute(page)).toBeInViewport()
  })

  test('the headline is the place name "Alle" at the Display step; the region keeps the name "Alle Aufgaben" (#609)', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    const heading = notPlanned(page).getByRole('heading', { level: 2 })
    await expect(heading).toHaveText('Alle Aufgaben')
    await expect(notPlanned(page)).toHaveAttribute('aria-label', 'Alle Aufgaben')
    const size = (el: Locator) => el.evaluate(node => getComputedStyle(node).fontSize)
    expect(await size(heading)).toBe(await size(page.locator('#column-open h2')))
    expect(await size(heading)).toBe('36px')
  })

  test('the round add button steps aside while the empty note offers the same add, and comes back with the first held task (#609, #581)', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD.filter(t => !t.notPlanned))
    await gotoAll(page)
    const add = page.getByTestId('not-planned-add')
    await expect(page.getByTestId('not-planned-empty')).toBeVisible()
    // Away: invisible, out of the tab order and the reader's tree, but its box stays (nothing jumps)
    await expect(add).toHaveCSS('opacity', '0')
    await expect(add).toHaveJSProperty('inert', true)
    expect((await add.boundingBox())!.width).toBeGreaterThan(0)
    await page.getByTestId('not-planned-create').click()
    // The add card is open: the button stays away (disabled must not dim it back to 50 %)
    await expect(add).toHaveCSS('opacity', '0')
    await saveInCard(page, 'Fenster ausmessen')
    await expect(add).toHaveCSS('opacity', '1')
    await expect(add).toHaveJSProperty('inert', false)
  })

  test('desktop: a place change keeps the window scroll (Offen survives the move)', async ({ context, page }) => {
    const cards = Array.from({ length: 30 }, (_, i) => open(`scr-${i}`, `Karte ${i}`))
    await seedLocalBoard(context, cards)
    await gotoAll(page)
    await page.evaluate(() => window.scrollTo(0, 600))
    const before = await page.evaluate(() => window.scrollY)
    test.skip(before === 0, 'the page does not scroll in this viewport')
    await toHeute(page).click()
    await expect(page).toHaveURL(/\/tasks$/)
    expect(await page.evaluate(() => window.scrollY)).toBe(before)
    await appNav(page).locator('.app-nav-place', { hasText: 'Alle' }).click()
    await expect(page).toHaveURL(/\/all$/)
    expect(await page.evaluate(() => window.scrollY)).toBe(before)
  })

  test('capacity: the line shows in Offen as on Heute; its echo sits at the foot of Offen while the line is below the window, and a click shows the line', async ({ context, page }) => {
    // 6 h day (no history): nine 1 h cards put the line behind the sixth, below an 800 px window
    const cards = Array.from({ length: 9 }, (_, i) => open(`cap-${i}`, `Karte ${i}`, null, 1))
    await seedLocalBoard(context, [...cards, held('np-1', 'Angebot kalkulieren')])
    await gotoAll(page)
    const divider = page.getByTestId('capacity-divider')
    const echo = page.getByTestId('capacity-echo')
    await expect(divider).toHaveCount(1)
    await expect(divider).not.toBeInViewport()
    await expect(echo).toBeVisible()
    await expect(echo).toContainText('Dein Tag ist vermutlich voll. 3 Aufgaben liegen unter der Linie.')
    // #566: the echo is Offen's, at the foot of the Today column; nothing of it lies in or over "Alle Aufgaben"
    await expect(notPlanned(page).getByTestId('capacity-echo')).toHaveCount(0)
    expect((await echo.boundingBox())!.x).toBeGreaterThanOrEqual((await page.locator('#column-open').boundingBox())!.x)

    // Planning past the line is never blocked; the echo counts on
    await item(page, 'np-1').getByTestId('not-planned-pick').click()
    await expect(echo).toContainText('4 Aufgaben liegen unter der Linie.')

    await echo.click()
    await expect(divider).toBeInViewport()
    await expect(echo).toBeHidden()
  })

  test('capacity: with the line above the window the echo docks at the top under the app bar, caret up, and a click shows the line (#573)', async ({ context, page }) => {
    const cards = Array.from({ length: 30 }, (_, i) => open(`up-${i}`, `Karte ${i}`, null, 1))
    await seedLocalBoard(context, [...cards, held('np-1', 'Angebot kalkulieren')])
    await gotoAll(page)
    const divider = page.getByTestId('capacity-divider')
    const echo = page.getByTestId('capacity-echo')
    await expect(echo).toHaveAttribute('data-placement', 'bottom')
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(divider).not.toBeInViewport()
    await expect(echo).toHaveCount(1)
    await expect(echo).toHaveAttribute('data-placement', 'top')
    const box = (await echo.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual((await page.getByTestId('app-nav-pill').boundingBox())!.y)
    expect(box.y).toBeLessThan(200)
    const column = (await page.locator('#column-open').boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(column.x)
    await echo.click()
    await expect(divider).toBeInViewport()
    await expect(echo).toBeHidden()
  })

  test('deleting a not-planned task from its sheet and undoing it returns it to "Alle Aufgaben", not to Offen', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    await item(page, 'np-2').locator('.task').click()
    await expect(page).toHaveURL(/\/all\/np-2$/)
    await (await openTaskMenu(page, /^Löschen/)).click()
    await expect(page).toHaveURL(/\/all$/)
    await expect(item(page, 'np-2')).toHaveCount(0)
    // No gap for it in Offen: it never stood there
    await expect(page.locator('#column-open .task-gap')).toHaveCount(0)
    // The shortcut belongs to the board once the sheet is gone (inside a dialog the key is the dialog's)
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.keyboard.press('Control+z')
    await expect(item(page, 'np-2')).toBeVisible()
    expect(await openIds(page)).toEqual(['open-1', 'open-2'])
  })
})

test.describe('The place "Alle" (#354), phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  const dots = (page: Page) => page.locator('[data-testid="page-dots"] .page-dot')
  const pageOf = (page: Page) => board(page).getAttribute('data-mobile-page')
  /** The strip rests on the page it reports (a tap aimed before that lands on the sliding page) */
  async function pageAtRest(page: Page) {
    await atRest(page)
    await expect.poll(() => board(page).evaluate((el) => {
      const transform = getComputedStyle(el).transform
      const x = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41
      return Math.abs(Math.round(x)) % window.innerWidth
    })).toBe(0)
  }
  async function swipe(page: Page, direction: 'left' | 'right') {
    const touch = finger(await page.context().newCDPSession(page), page)
    // Below the cards: a touch that starts on a card's corner button is the button's, never a swipe
    await touch.start(direction === 'left' ? 300 : 90, 560)
    await touch.moveTo(direction === 'left' ? 80 : 310, 570, 12)
    await touch.end()
  }

  test('"Alle" has two swipe pages and two dots, "Heute" three; a swipe at an edge never leads to the other place', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    // "Alle" opens on "Alle Aufgaben"
    expect(await pageOf(page)).toBe('0')
    await expect(dots(page)).toHaveCount(2)
    await expect(notPlanned(page).getByRole('heading', { name: 'Alle Aufgaben' })).toBeInViewport()

    await swipe(page, 'left')
    await expect.poll(() => pageOf(page)).toBe('1')
    await pageAtRest(page)
    await expect(page.locator('#column-open h2')).toBeInViewport()
    // The last page of "Alle": a further swipe meets the edge
    await swipe(page, 'left')
    await pageAtRest(page)
    expect(await pageOf(page)).toBe('1')
    await expect(page).toHaveURL(/\/all$/)
    await expect(page.locator('#column-open h2')).toBeInViewport()

    await swipe(page, 'right')
    await expect.poll(() => pageOf(page)).toBe('0')
    await pageAtRest(page)
    await swipe(page, 'right')
    await pageAtRest(page)
    expect(await pageOf(page)).toBe('0')

    // Heute: three pages, and its first page is Offen; a swipe right there never shows "Alle Aufgaben"
    await toHeute(page).tap()
    await expect(page).toHaveURL(/\/tasks$/)
    await pageAtRest(page)
    await expect(dots(page)).toHaveCount(3)
    expect(await pageOf(page)).toBe('0')
    await expect(page.locator('#column-open h2')).toBeInViewport()
    await swipe(page, 'right')
    await pageAtRest(page)
    expect(await pageOf(page)).toBe('0')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(notPlanned(page)).toBeHidden()
  })

  test('the app bar\'s places lead across; Heute opens on Offen, "Alle" on "Alle Aufgaben"; no footer bar', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    const go = toHeute(page)
    await expect(go).toHaveText('Heute')
    await expect(page.getByTestId('board-continue')).toHaveCount(0)

    await go.tap()
    await expect(page).toHaveURL(/\/tasks$/)
    await pageAtRest(page)
    expect(await pageOf(page)).toBe('0')
    await expect(page.locator('#column-open h2')).toBeInViewport()
    await expect(toHeute(page)).toHaveAttribute('aria-current', 'page')

    // From Erledigt (Heute's last page) back to "Alle": one move, however many pages lie between
    await swipe(page, 'left')
    await expect.poll(() => pageOf(page)).toBe('1')
    await pageAtRest(page)
    await swipe(page, 'left')
    await expect.poll(() => pageOf(page)).toBe('2')
    await pageAtRest(page)
    await placeLink(page, 'all').tap()
    await expect(page).toHaveURL(/\/all$/)
    await pageAtRest(page)
    expect(await pageOf(page)).toBe('0')
    await expect(notPlanned(page).getByRole('heading', { name: 'Alle Aufgaben' })).toBeInViewport()
    await expect(page.locator('#column-done')).toBeHidden()
  })

  test('#365/#378: scrolled to the end, the last card of both pages lies fully above the app bar', async ({ context, page }) => {
    // Nine 1 h cards fill the 6 h day: the day is full, and nothing but the app bar lies over the pages (#566)
    const cards = Array.from({ length: 9 }, (_, i) => open(`cap-${i}`, `Karte ${i}`, null, 1))
    const many = Array.from({ length: 12 }, (_, i) => held(`many-${i}`, `Vorrat ${i}`))
    await seedLocalBoard(context, [...cards, ...many])
    await gotoAll(page)
    const barTop = async () => (await page.getByTestId('app-nav-pill').boundingBox())!.y
    await expect(page.getByTestId('capacity-echo')).toHaveCount(0)
    await notPlanned(page).evaluate((el) => { el.scrollTop = el.scrollHeight })
    const lastHeld = item(page, 'many-11').locator('.task')
    await expect(lastHeld).toBeInViewport()
    const lastHeldBox = (await lastHeld.boundingBox())!
    expect(lastHeldBox.y + lastHeldBox.height).toBeLessThanOrEqual(await barTop())

    await swipe(page, 'left')
    await expect.poll(() => pageOf(page)).toBe('1')
    await pageAtRest(page)
    await page.locator('#column-open').evaluate((el) => { el.scrollTop = el.scrollHeight })
    const lastOpen = openCard(page, 'cap-8')
    await expect(lastOpen).toBeInViewport()
    const opened = (await lastOpen.boundingBox())!
    expect(opened.y + opened.height).toBeLessThanOrEqual(await barTop())
  })

  test('a planned card leaves to the right and Offen counts it; "Nicht für heute planen" in the card menu puts it back', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    // The arrow sits in the card's corner with a 44 px target
    const pick = item(page, 'np-1').getByTestId('not-planned-pick')
    const box = (await pick.boundingBox())!
    const card = (await item(page, 'np-1').locator('.task').boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width)
    expect(box.y).toBeGreaterThanOrEqual(card.y)

    await pick.tap()
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-2'])

    await swipe(page, 'left')
    await expect.poll(() => pageOf(page)).toBe('1')
    await pageAtRest(page)
    expect(await openIds(page)).toEqual(['open-1', 'open-2', 'np-1'])
    // No arrow beside an Offen card on a phone: the card menu does it
    await expect(page.getByTestId('not-today-arrow')).toHaveCount(0)
    await openCard(page, 'open-1').getByTestId('task-menu-button').tap()
    await page.getByRole('menuitem', { name: 'Nicht für heute planen' }).tap()
    await expect.poll(() => openIds(page)).toEqual(['open-2', 'np-1'])
    await swipe(page, 'right')
    await expect.poll(() => pageOf(page)).toBe('0')
    expect(await notPlannedIds(page)).toEqual(['open-1', 'np-2'])
  })

  test('#566: with a full day the "Alle Aufgaben" page has no capacity element; Offen shows its own line in the list', async ({ context, page }) => {
    const cards = Array.from({ length: 7 }, (_, i) => open(`cap-${i}`, `Karte ${i}`, null, 1))
    await seedLocalBoard(context, [...cards, held('np-1', 'Angebot kalkulieren')])
    await gotoAll(page)
    await pageAtRest(page)
    expect(await pageOf(page)).toBe('0')
    await expect(page.getByTestId('capacity-divider')).toHaveCount(1)
    // The bar over the unplanned tasks is gone: no echo and no dock, on either page of "Alle"
    await expect(page.getByTestId('capacity-echo')).toHaveCount(0)
    await expect(page.getByTestId('capacity-dock-bar')).toHaveCount(0)

    await swipe(page, 'left')
    await expect.poll(() => pageOf(page)).toBe('1')
    await pageAtRest(page)
    await page.getByTestId('capacity-divider').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('capacity-divider')).toBeInViewport()
    await expect(page.getByTestId('capacity-echo')).toHaveCount(0)
  })

  test('#355: press-and-hold on a "Alle Aufgaben" card carries it over the right edge into Offen; a tap still opens its sheet', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    await pageAtRest(page)
    const touch = finger(await context.newCDPSession(page), page)
    const from = (await item(page, 'np-1').locator('.not-planned__card').boundingBox())!

    await touch.start(from.x + 40, from.y + from.height / 2)
    await expect(page.locator('.board.dragging')).toHaveCount(1)
    await touch.moveTo(385, from.y + from.height / 2, 10, 20)
    await dwell(page, EDGE_HOLD_DWELL_MS) // past EDGE_HOLD_MS in the edge zone
    await expect.poll(() => pageOf(page)).toBe('1')
    const target = (await openCard(page, 'open-1').boundingBox())!
    await touch.moveTo(195, target.y + 12, 12, 20)
    await expect(page.locator('#column-open-list > .not-planned__item.kando-dnd-dragged')).toHaveCount(1)
    // The slot has no side room of its own (Offen's list pads it): a padded slot is 1.5rem narrower than its
    // neighbours wherever the card is not capped at its max width, and the "usual gap" is lost
    const slotItem = page.locator('#column-open-list > .not-planned__item.kando-dnd-dragged')
    expect(await slotItem.evaluate(el => getComputedStyle(el).paddingInlineStart)).toBe('0px')
    const slot = (await slotItem.locator('.task').boundingBox())!
    const neighbour = (await openCard(page, 'open-1').locator('.task').boundingBox())!
    expect(slot.width).toBeCloseTo(neighbour.width, 0)
    await touch.end()
    await dropSettled(page)
    await expect.poll(async () => (await openIds(page)).includes('np-1')).toBe(true)
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-2'])

    // A short tap is no drag
    await swipe(page, 'right')
    await expect.poll(() => pageOf(page)).toBe('0')
    await pageAtRest(page)
    await item(page, 'np-2').locator('.not-planned__card').tap()
    await expect(page).toHaveURL(/\/all\/np-2$/)
  })
})

/** Offen's list as the drag shows it: the cards, and the "Alle Aufgaben" item dnd-kit sorted in as the gap */
const openListIds = (page: Page) =>
  page.locator('#column-open-list > :is(.task-wrapper, .not-planned__item)').evaluateAll(els =>
    els.map(el => el.getAttribute('data-task-id') ?? el.getAttribute('data-not-planned-id')))
const side = (page: Page) => page.locator('#column-not-planned')
const card = (page: Page, id: string) => item(page, id).locator('.not-planned__card')

/** Moves the held card onto the middle of "Alle Aufgaben" and waits until that side is the drop target */
async function hoverSide(page: Page) {
  const box = (await side(page).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 })
  await expect(board(page)).toHaveAttribute('data-over-not-planned', '')
}

test.describe('Drag between "Alle Aufgaben" and Offen (#355), desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('a "Alle Aufgaben" card dropped on Offen is planned and lands in the slot the gap showed', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)

    await pickUp(page, card(page, 'np-2'))
    // The upper part of the first Offen card: the gap opens among the cards, not at the end (where the arrow puts a card)
    await hover(page, openCard(page, 'open-1'), { fromTop: 12 })
    const preview = await openListIds(page)
    expect(preview).toHaveLength(3)
    expect(preview.indexOf('np-2')).toBeLessThan(2)
    await expect(side(page)).not.toHaveClass(/is-drop-target/)

    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(() => openIds(page)).toEqual(preview)
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-1'])
    await expect(page.locator('#column-open-list .not-planned__item')).toHaveCount(0)

    // The last slot too: below the last card
    await pickUp(page, card(page, 'np-1'))
    const last = (await page.locator('#column-open-list > .task-wrapper').last().boundingBox())!
    await page.mouse.move(last.x + last.width / 2, last.y + last.height + 60, { steps: 25 })
    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(async () => (await openIds(page)).at(-1)).toBe('np-1')
    await expect(page.getByTestId('not-planned-empty')).toBeVisible()
  })

  test('an Offen card held over "Alle Aufgaben" gets the wash and the line; dropped, it lies on top there', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)

    await pickUp(page, openCard(page, 'open-2'))
    await hoverSide(page)
    await expect(side(page)).toHaveClass(/is-drop-target/)
    // #609, #581: no note names the drop, the wash is the whole answer
    await expect(page.getByText('Hier ablegen')).toHaveCount(0)
    // The side names itself like a hovered column: its headline is at full ink, Offen's steps back
    await expect(side(page).locator('h2')).toHaveCSS('opacity', '1')
    await expect(page.locator('#column-open h2')).toHaveCSS('opacity', '0.5')
    // No slot is promised in Offen meanwhile: the placeholder is out of its layout
    await expect.poll(() => page.locator('#column-open-list > .kando-dnd-dragged').evaluate(el => el.getBoundingClientRect().height)).toBe(0)

    // Leaving ends the answer, coming back shows it again
    await hover(page, openCard(page, 'open-1'))
    await expect(side(page)).not.toHaveClass(/is-drop-target/)
    await hoverSide(page)
    await expect(side(page)).toHaveClass(/is-drop-target/)

    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(() => notPlannedIds(page)).toEqual(['open-2', 'np-1', 'np-2'])
    await expect.poll(() => openIds(page)).toEqual(['open-1'])
    await expect(side(page)).not.toHaveClass(/is-drop-target/)
  })

  test('a drop on "Alle Aufgaben" with the page scrolled down shows the card where it landed, on top (#609: the page scrolls to it)', async ({ context, page }) => {
    const many = Array.from({ length: 14 }, (_, i) => held(`fill-${i}`, `Aufgabe ${i + 1}`))
    await seedLocalBoard(context, [...many, ...BOARD])
    await gotoAll(page)

    // Held in Offen's first card while the page is scrolled down: the side's top is out of view
    await pickUp(page, openCard(page, 'open-1'))
    await page.mouse.wheel(0, 4000)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
    await hoverSide(page)
    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(async () => (await notPlannedIds(page))[0]).toBe('open-1')
    await expect(item(page, 'open-1')).toBeInViewport()
    // ... and clear of the app bar and its veil (3.5 rem + 1.75 rem), not under them
    expect((await item(page, 'open-1').boundingBox())!.y).toBeGreaterThanOrEqual(84)
  })

  test('"Nicht für heute planen" on a card deep in Offen keeps the page where it is (#609)', async ({ context, page }) => {
    const many = Array.from({ length: 30 }, (_, i) => open(`deep-${i}`, `Karte ${i}`))
    await seedLocalBoard(context, [...many, held('np-1', 'Angebot kalkulieren')])
    await gotoAll(page)
    await page.mouse.wheel(0, 2500)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500)
    const before = await page.evaluate(() => window.scrollY)
    const card = openCard(page, 'deep-10')
    await card.scrollIntoViewIfNeeded()
    const at = await page.evaluate(() => window.scrollY)
    await card.locator('.task').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Nicht für heute planen' }).click()
    await expect.poll(async () => (await notPlannedIds(page))[0]).toBe('deep-10')
    await settleAnimations(page)
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - at)).toBeLessThan(2)
    expect(before).toBeGreaterThan(0)
  })

  test('a drop back on its own side, Escape, and a hover over a neighbour change nothing', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)

    // Over a neighbour of its own side: the cards never make room for one another
    await pickUp(page, card(page, 'np-1'))
    const neighbour = (await item(page, 'np-2').boundingBox())!
    await page.mouse.move(neighbour.x + neighbour.width / 2, neighbour.y + neighbour.height / 2, { steps: 25 })
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-1', 'np-2'])
    await expect(side(page)).not.toHaveClass(/is-drop-target/)

    // Into Offen and back over the side: the gap in Offen closes, the side shows no wash for its own card
    await hover(page, openCard(page, 'open-1'))
    expect(await openListIds(page)).toContain('np-1')
    await hoverSide(page)
    await expect(side(page)).not.toHaveClass(/is-drop-target/)
    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-1', 'np-2'])
    await expect.poll(() => openIds(page)).toEqual(['open-1', 'open-2'])

    // Escape in mid-drag over Offen
    await pickUp(page, card(page, 'np-2'))
    await hover(page, openCard(page, 'open-2'))
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-1', 'np-2'])
    await expect.poll(() => openIds(page)).toEqual(['open-1', 'open-2'])

    // The card is still a card: a click opens its sheet
    await card(page, 'np-1').click()
    await expect(page).toHaveURL(/\/all\/np-1$/)
  })

  test('#380: the add button beside "Alle Aufgaben" steps out while a card is held and is back after the drop', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)

    const add = page.getByTestId('not-planned-add')
    await expect(add).toBeVisible()
    await pickUp(page, openCard(page, 'open-2'))
    await expect(add).toBeHidden()
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await dropSettled(page)
    await expect(add).toBeVisible()
  })

  test('keyboard: Space picks a "Alle Aufgaben" card up, the arrows carry it into Offen and back; both results are said', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    const live = page.locator('body > [aria-live]')

    await card(page, 'np-1').focus()
    await page.keyboard.press('Space')
    await expect(page.locator('.board.dragging')).toHaveCount(1)
    await expect(live).toContainText('Alle Aufgaben')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => openListIds(page)).toContain('np-1')
    await page.keyboard.press('Space')
    await expect(live).toContainText('Angebot kalkulieren ist für heute geplant.')
    await dropSettled(page)
    await expect.poll(() => openIds(page)).toContain('np-1')
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-2'])

    await openCard(page, 'np-1').focus()
    await page.keyboard.press('Space')
    await expect(page.locator('.board.dragging')).toHaveCount(1)
    await page.keyboard.press('ArrowLeft')
    await expect(side(page)).toHaveClass(/is-drop-target/)
    await expect(live).toContainText('über „Alle Aufgaben“')
    await page.keyboard.press('Space')
    await expect(live).toContainText('Angebot kalkulieren ist nicht mehr für heute geplant.')
    await dropSettled(page)
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-1', 'np-2'])
    await expect.poll(() => openIds(page)).toEqual(['open-1', 'open-2'])
  })
})

test.describe('Drag between "Alle Aufgaben" and Offen (#355), 390', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the edge scroll carries a card from "Alle Aufgaben" to a slot in Offen, and an Offen card back', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    await expect(board(page)).toHaveAttribute('data-mobile-page', '0')
    await expect.poll(async () => (await card(page, 'np-1').boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0)

    await pickUp(page, card(page, 'np-1'))
    await expect(page.locator('.edge-indicator--right')).toBeVisible()
    await expect(page.locator('.edge-indicator--left')).toHaveCount(0)
    await edgeDwell(page, 'right')
    await hover(page, openCard(page, 'open-1'), { fromTop: 12 })
    const preview = await openListIds(page)
    expect(preview).toContain('np-1')
    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(() => openIds(page)).toEqual(preview)

    await pickUp(page, openCard(page, 'open-2'))
    await expect(page.locator('.edge-indicator--left')).toBeVisible()
    await expect(page.locator('.edge-indicator--right')).toHaveCount(0)
    await edgeDwell(page, 'left')
    await expect(side(page)).toHaveClass(/is-drop-target/)
    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(() => notPlannedIds(page)).toEqual(['open-2', 'np-2'])
    await expect.poll(async () => (await openIds(page)).includes('open-2')).toBe(false)
  })
})

test.describe('The app bar with "Alle" on a small phone (#354)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 360, height: 740 } })

  test('four segments and ⋯ stay inside a 360 px screen', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await page.goto('/settings')
    await expect(page.getByTestId('app-nav-place-more')).toBeVisible()
    await expect(appNav(page)).not.toHaveAttribute('data-moving', 'true')
    await settleAnimations(page)
    for (const id of ['app-nav-place-all', 'app-nav-place-board', 'app-nav-place-statistics', 'app-nav-place-more', 'app-nav-more']) {
      const box = (await page.getByTestId(id).boundingBox())!
      expect(box.x, id).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width, id).toBeLessThanOrEqual(360)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360)
  })

  // #381: the funnel hung off the group's right edge and was cut off by the screen at 360 px
  for (const path of ['/tasks', '/all']) {
    test(`the topic focus funnel lies inside the screen on ${path}, clear of ⋯, with its 44 px target`, async ({ context, page }) => {
      await seedLocalBoard(context, BOARD)
      await page.goto(path)
      const funnel = page.getByTestId('focus-trigger')
      await expect(funnel).toBeVisible()
      await expect(appNav(page)).not.toHaveAttribute('data-moving', 'true')
      await settleAnimations(page)
      const box = (await funnel.boundingBox())!
      const more = (await page.getByTestId('app-nav-more').boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(360 - 12)
      expect(box.x).toBeGreaterThanOrEqual(more.x + more.width)
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
    })
  }
})

/**
 * #469: the layout of "Alle Aufgaben" (one card gap between the two columns, the pick arrow in the card's corner)
 * and the marker under "Heute" on "Alle". The panel for yesterday's tasks is in new-day-recap.spec.ts.
 */
test.describe('"Alle Aufgaben" layout and the marker (#469)', () => {
  const MANY: SeedTask[] = [
    held('np-1', 'Angebot kalkulieren'),
    held('np-2', 'Belege sortieren'),
    held('np-3', 'Fenster ausmessen'),
    held('np-4', 'Werkstatt anrufen'),
  ]
  const card = (page: Page, id: string) => item(page, id).locator('.not-planned__card')
  /** The ink of the stroke under a headline: `::before` of its h2 */
  const markerOpacity = (page: Page, column: 'open' | 'progress') =>
    page.locator(`#column-${column} h2`).evaluate(el => Number(getComputedStyle(el, '::before').opacity))

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 800 } })

    test('the two columns sit one card gap (12 px) apart, and the pick arrow stays in its card\'s top right corner, never over the neighbour', async ({ context, page }) => {
      await seedLocalBoard(context, MANY)
      await gotoAll(page)
      const [first, second, third] = [await card(page, 'np-1').boundingBox(), await card(page, 'np-2').boundingBox(), await card(page, 'np-3').boundingBox()]
      expect(Math.round(second!.x - (first!.x + first!.width))).toBe(12)
      expect(Math.round(third!.y - (first!.y + first!.height))).toBe(12)
      // the left card's arrow (the one #467's edge placement would have pushed onto its neighbour)
      await item(page, 'np-1').hover()
      const arrow = item(page, 'np-1').getByTestId('not-planned-pick')
      await expect(arrow).toHaveCSS('opacity', '1')
      const box = (await arrow.boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(first!.x + first!.width)
      expect(box.x + box.width).toBeGreaterThan(first!.x + first!.width - 24)
      expect(box.y).toBeGreaterThanOrEqual(first!.y)
      expect(box.y + box.height).toBeLessThan(first!.y + 48)
      // and the keyboard reveals it too
      await page.mouse.move(0, 0)
      await item(page, 'np-2').getByTestId('not-planned-pick').focus()
      await expect(item(page, 'np-2').getByTestId('not-planned-pick')).toHaveCSS('opacity', '1')
    })

    test('the marker is under "Heute" on "Alle" and goes when the user moves to "Heute", where "Jetzt" keeps it: one marker per view', async ({ context, page }) => {
      await seedLocalBoard(context, MANY)
      await gotoAll(page)
      await expect(page.locator('#column-open h2')).toHaveText('Heute')
      await expect.poll(() => markerOpacity(page, 'open')).toBe(1)
      await toHeute(page).click()
      await expect(board(page)).toHaveAttribute('data-place', 'today')
      await atRest(page)
      await expect(page.locator('#column-open h2')).toHaveText('Offen')
      await expect.poll(() => markerOpacity(page, 'open')).toBe(0)
      await expect.poll(() => markerOpacity(page, 'progress')).toBe(1)
      // and back: it returns
      await placeLink(page, 'all').click()
      await expect(board(page)).toHaveAttribute('data-place', 'all')
      await atRest(page)
      await expect.poll(() => markerOpacity(page, 'open')).toBe(1)
    })
  })

  test.describe('390', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

    test('one column; the pick arrow is always there, in the card\'s top right corner, and nothing scrolls sideways', async ({ context, page }) => {
      await seedLocalBoard(context, MANY)
      await gotoAll(page)
      const cardBox = (await card(page, 'np-1').boundingBox())!
      const arrow = item(page, 'np-1').getByTestId('not-planned-pick')
      await expect(arrow).toHaveCSS('opacity', '1')
      const box = (await arrow.boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 8)
      expect(box.x).toBeGreaterThan(cardBox.x + cardBox.width / 2)
      expect(box.y).toBeLessThan(cardBox.y + 24)
      const next = (await card(page, 'np-2').boundingBox())!
      expect(Math.round(next.x)).toBe(Math.round(cardBox.x))
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  })
})
