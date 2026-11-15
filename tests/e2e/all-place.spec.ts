import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { finger } from './helpers/dnd'
import { settleAnimations } from './helpers/settle'
import { appNav } from './helpers/appNav'

/**
 * #354 (epic #334): the place "Alle". `/all` is a second path of the board page: "Nicht geplant" beside Offen, the
 * two planning moves, the sideways move to Heute, and on a phone two places with their own swipe pages.
 * Local board; a task is "not planned" by its `notPlanned` marker (#353).
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

/** The strip has arrived: no move flag, no running animation */
async function atRest(page: Page) {
  await expect(board(page)).not.toHaveAttribute('data-place-moving', '')
  await settleAnimations(page)
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
    // Heute shows its three columns, "Nicht geplant" is not there for anyone
    await expect(notPlanned(page)).toBeHidden()

    await placeLink(page, 'all').click()
    await expect(page).toHaveURL(/\/all$/)
    await expect(placeLink(page, 'all')).toHaveAttribute('aria-current', 'page')
    await expect(placeLink(page, 'board')).not.toHaveAttribute('aria-current', 'page')
    await atRest(page)
    await expect(notPlanned(page).getByRole('heading', { name: 'Nicht geplant' })).toBeVisible()
    await expect(page.locator('#column-open')).toBeVisible()
    await expect(page.locator('#column-progress')).toBeHidden()
    await expect(page.locator('#column-done')).toBeHidden()
    expect(await notPlannedIds(page)).toEqual(['np-1', 'np-2'])
    expect(await openIds(page)).toEqual(['open-1', 'open-2'])
    // Every card here names its source, on a board with one source too
    await expect(item(page, 'np-1').getByTestId('task-source-icon')).toHaveCount(1)
    await expect(openCard(page, 'open-1').getByTestId('task-source-icon')).toHaveCount(0)
  })

  test('the board is one strip: Offen is the same column before and after the move, and the side out of view takes no drop, focus or reader', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await page.goto('/tasks')
    await expect(openCard(page, 'open-1')).toBeVisible()
    // Mark the live DOM node and scroll state a remount would lose
    await page.locator('#column-open').evaluate((el) => { (el as HTMLElement & { __same?: boolean }).__same = true })

    await placeLink(page, 'all').click()
    await expect(board(page)).toHaveAttribute('data-place', 'all')
    // The move is under way (motion is on in this project): both sides are painted while it travels
    await expect(board(page)).toHaveAttribute('data-place-moving', '')
    await atRest(page)
    expect(await page.locator('#column-open').evaluate(el => (el as HTMLElement & { __same?: boolean }).__same)).toBe(true)
    expect(await page.locator('.column-group-mid').evaluate(el => getComputedStyle(el).display)).toBe('none')
    await expect(page.locator('#column-done')).toHaveAttribute('inert', '')
    // No sideways scroll from the strip that is wider than the page
    expect(await page.evaluate(() => { window.scrollTo(15, 0); return window.scrollX })).toBe(0)

    await page.getByTestId('board-continue').click()
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
    const flagged = page.evaluate(() => new Promise<boolean>((resolve) => {
      const el = document.querySelector('.board')!
      let seen = false
      const observer = new MutationObserver(() => { if (el.hasAttribute('data-place-moving')) seen = true })
      observer.observe(el, { attributes: true })
      setTimeout(() => { observer.disconnect(); resolve(seen) }, 600)
    }))
    await placeLink(page, 'all').click()
    await expect(notPlanned(page)).toBeVisible()
    expect(await flagged).toBe(false)
    expect(await page.evaluate(() => document.querySelector('.board')!.getAnimations().length)).toBe(0)
  })

  test('the arrow plans a card to the end of Offen; the mirrored arrow and "Nicht heute" put it back on top; a reload keeps place and order', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD, {}, undefined, { once: true })
    await gotoAll(page)

    await item(page, 'np-1').getByRole('button', { name: 'Angebot kalkulieren: für heute einplanen' }).click()
    await expect.poll(() => openIds(page)).toEqual(['open-1', 'open-2', 'np-1'])
    expect(await notPlannedIds(page)).toEqual(['np-2'])
    await expect(page.getByTestId('plan-announcement')).toHaveText('Angebot kalkulieren ist für heute geplant.')

    // The mirrored arrow beside an Offen card shows under the pointer
    await openCard(page, 'open-1').hover()
    await openCard(page, 'open-1').getByRole('button', { name: 'Rechnung schicken: nicht heute' }).click()
    await expect.poll(() => notPlannedIds(page)).toEqual(['open-1', 'np-2'])
    await expect(page.getByTestId('plan-announcement')).toHaveText('Rechnung schicken ist nicht mehr für heute geplant.')

    // The card menu does the same
    await settleAnimations(page)
    await openCard(page, 'open-2').locator('.task').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Nicht heute' }).click()
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

  test('"Nicht heute" is in the card menu on Heute too, and the card is then found on top under "Alle"', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await page.goto('/tasks')
    await openCard(page, 'open-2').locator('.task').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Nicht heute' }).click()
    await expect(openCard(page, 'open-2')).toHaveCount(0)
    // A card outside Offen has no such entry
    await page.locator('#column-waiting .task').first().click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Als erledigt markieren' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Nicht heute' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await placeLink(page, 'all').click()
    await atRest(page)
    expect(await notPlannedIds(page)).toEqual(['open-2', 'np-1', 'np-2'])
  })

  test('a "Nicht geplant" card opens its sheet, and closing it returns to "Alle"; the keyboard does both moves', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)

    await item(page, 'np-2').locator('.task').click()
    await expect(page).toHaveURL(/\/all\/np-2$/)
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('Belege sortieren')
    await expect(placeLink(page, 'all')).toHaveAttribute('aria-current', 'page')
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

  test('a task added on "Alle" lands in Offen and the place stays "Alle"', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    await page.getByTestId('add-task-header-button').click()
    await page.keyboard.type('Neu auf Alle')
    await page.keyboard.press('Enter')
    await expect(page.locator('#column-open .task', { hasText: 'Neu auf Alle' })).toBeVisible()
    await expect(page).toHaveURL(/\/all$/)
  })

  test('the topic focus is one state for both places and filters "Nicht geplant" and Offen', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    await page.getByTestId('focus-trigger').click()
    // Counted over what this place shows: two cards each
    await expect(page.getByTestId('focus-chip')).toHaveText(['Büro2', 'Kunden2'])
    await page.getByTestId('focus-chip').filter({ hasText: 'Büro' }).click()
    await expect.poll(() => notPlannedIds(page)).toEqual(['np-2'])
    await expect.poll(() => openIds(page)).toEqual(['open-1'])

    // The same focus on Heute
    await placeLink(page, 'board').click()
    await atRest(page)
    await expect(page.getByTestId('focus-pill')).toBeVisible()
    expect(await openIds(page)).toEqual(['open-1'])

    // Planning the last matching card leaves "Keine Aufgaben gefunden."
    await placeLink(page, 'all').click()
    await atRest(page)
    await item(page, 'np-2').getByTestId('not-planned-pick').click()
    await expect(page.getByTestId('not-planned-no-match')).toHaveText('Keine Aufgaben gefunden.')
  })

  test('empty: says that everything is planned and how a task gets here; a board without tasks stays blank', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD.filter(t => !t.notPlanned))
    await gotoAll(page)
    await expect(page.getByTestId('not-planned-empty')).toContainText('Noch keine weiteren Aufgaben. Alles ist für heute geplant.')
    await expect(page.getByTestId('not-planned-empty')).toContainText('Nicht heute')
    expect(await openIds(page)).toEqual(['open-1', 'open-2'])
  })

  test('a board without any task: both columns blank, the add button works', async ({ context, page }) => {
    await seedLocalBoard(context, [])
    await gotoAll(page)
    await expect(page.getByTestId('not-planned-empty')).toHaveCount(0)
    await expect(notPlanned(page).locator('[data-not-planned-id]')).toHaveCount(0)
    await expect(page.getByTestId('add-task-header-button')).toBeEnabled()
  })

  test('many items: "Nicht geplant" scrolls inside itself; Offen and "Weiter zu Heute" stay in view', async ({ context, page }) => {
    const many = Array.from({ length: 30 }, (_, i) => held(`many-${i}`, `Vorrat ${i}`))
    await seedLocalBoard(context, [...many, open('open-1', 'Rechnung schicken')])
    await gotoAll(page)
    const body = notPlanned(page).locator('.not-planned__body')
    expect(await body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    await item(page, 'many-29').scrollIntoViewIfNeeded()
    await expect(item(page, 'many-29')).toBeInViewport()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await expect(openCard(page, 'open-1')).toBeInViewport()
    await expect(page.getByTestId('board-continue')).toBeInViewport()
  })

  test('capacity: the line shows in Offen as on Heute; its echo sits above "Weiter zu Heute" while the line is below the window, and a click shows the line', async ({ context, page }) => {
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

    // Planning past the line is never blocked; the echo counts on
    await item(page, 'np-1').getByTestId('not-planned-pick').click()
    await expect(echo).toContainText('4 Aufgaben liegen unter der Linie.')

    await echo.click()
    await expect(divider).toBeInViewport()
    await expect(echo).toBeHidden()
  })

  test('deleting a not-planned task from its sheet and undoing it returns it to "Nicht geplant", not to Offen', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    await item(page, 'np-2').locator('.task').click()
    await expect(page).toHaveURL(/\/all\/np-2$/)
    await page.getByTestId('task-sheet-actions').getByTestId('task-delete').click()
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
    // "Alle" opens on "Nicht geplant"
    expect(await pageOf(page)).toBe('0')
    await expect(dots(page)).toHaveCount(2)
    await expect(notPlanned(page).getByRole('heading', { name: 'Nicht geplant' })).toBeInViewport()

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

    // Heute: three pages, and its first page is Offen; a swipe right there never shows "Nicht geplant"
    await placeLink(page, 'board').tap()
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

  test('"Weiter zu Heute · n" and the app bar lead across; Heute opens on Offen, "Alle" on "Nicht geplant"', async ({ context, page }) => {
    await seedLocalBoard(context, BOARD)
    await gotoAll(page)
    const go = page.getByTestId('board-continue')
    await expect(go).toHaveText(/Weiter zu Heute · 2/)

    await go.tap()
    await expect(page).toHaveURL(/\/tasks$/)
    await pageAtRest(page)
    expect(await pageOf(page)).toBe('0')
    await expect(page.locator('#column-open h2')).toBeInViewport()
    await expect(page.getByTestId('board-continue-bar')).toHaveCount(0)

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
    await expect(notPlanned(page).getByRole('heading', { name: 'Nicht geplant' })).toBeInViewport()
    await expect(page.locator('#column-done')).toBeHidden()
  })

  test('a planned card leaves to the right and Offen counts it; "Nicht heute" in the card menu puts it back', async ({ context, page }) => {
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
    await expect(page.getByTestId('board-continue')).toHaveText(/Weiter zu Heute · 3/)

    await swipe(page, 'left')
    await expect.poll(() => pageOf(page)).toBe('1')
    await pageAtRest(page)
    expect(await openIds(page)).toEqual(['open-1', 'open-2', 'np-1'])
    // No arrow beside an Offen card on a phone: the card menu does it
    await expect(page.getByTestId('not-today-arrow')).toHaveCount(0)
    await openCard(page, 'open-1').getByTestId('task-menu-button').tap()
    await page.getByRole('menuitem', { name: 'Nicht heute' }).tap()
    await expect.poll(() => openIds(page)).toEqual(['open-2', 'np-1'])
    await swipe(page, 'right')
    await expect.poll(() => pageOf(page)).toBe('0')
    expect(await notPlannedIds(page)).toEqual(['open-1', 'np-2'])
  })

  test('capacity: on the "Nicht geplant" page the echo sits above the bar; a tap shows the line on the Offen page', async ({ context, page }) => {
    const cards = Array.from({ length: 7 }, (_, i) => open(`cap-${i}`, `Karte ${i}`, null, 1))
    await seedLocalBoard(context, [...cards, held('np-1', 'Angebot kalkulieren')])
    await gotoAll(page)
    const echo = page.getByTestId('capacity-echo')
    await expect(echo).toBeVisible()
    await expect(echo).toContainText('Dein Tag ist vermutlich voll. Eine Aufgabe liegt unter der Linie.')
    const echoBox = (await echo.boundingBox())!
    const goBox = (await page.getByTestId('board-continue').boundingBox())!
    expect(echoBox.y + echoBox.height).toBeLessThanOrEqual(goBox.y)

    await echo.tap()
    await expect.poll(() => pageOf(page)).toBe('1')
    await pageAtRest(page)
    await expect(page.getByTestId('capacity-divider')).toBeInViewport()
    // On the Offen page the real line speaks for itself
    await expect(echo).toBeHidden()
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
})
