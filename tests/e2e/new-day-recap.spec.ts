import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { settleAnimations } from './helpers/settle'
import { appNav, goToPlace, openSettings } from './helpers/appNav'
import { expectContrast } from './helpers/contrast'
import {
  MIXED_SEED_TASKS, atDaysAgo, dayKeyDaysAgo, newDayBackTasks, newDayTasks, seedDayRecapStore, seedMixedBoard, seedNewDayBoard,
  type SeedTask,
} from './helpers/seed'

/** Issue #385: "Kurzer Rückblick" on the first start of a new day. Local tasks unless a test says otherwise. */

const recap = (page: Page) => page.getByTestId('new-day-recap')
const summary = (page: Page) => page.getByTestId('recap-summary')
/** "Direkt zu Heute": leaves to the board, as the single button did before #356 */
const continueButton = (page: Page) => page.getByTestId('recap-continue')
/** "Tag planen" (#356): the primary way out, leads to "Alle" */
const planButton = (page: Page) => page.getByTestId('recap-plan')
const archiveSwitch = (page: Page) => page.getByTestId('recap-archive-toggle')
/** The footer panel (container) that holds the switch and the button. */
const panelOf = (page: Page) => archiveSwitch(page).locator('xpath=ancestor::div[contains(@class,"@container")][1]')
const switcher = (page: Page, kind: 'done' | 'undone') => page.getByTestId('recap-switcher').getByRole('tab').nth(kind === 'undone' ? 0 : 1)
const board = (page: Page) => page.locator('main[data-task-sheet-return]')
const doneColumn = (page: Page) => page.locator('#column-done')
const marker = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('day-recap-store') ?? 'null') as { lastShownDay: string, archiveDone: boolean } | null)
const archived = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { archivedTaskIds?: string[] }).archivedTaskIds ?? [])

/** The former "Schön gemacht" / "{n} erledigte Aufgaben abgelegt" toast with "Rückgängig" is gone (#463). */
async function expectNoArchiveToast(page: Page) {
  await expect(page.getByText('Schön gemacht')).toHaveCount(0)
  await expect(page.getByText(/erledigte Aufgaben? abgelegt/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Rückgängig' })).toHaveCount(0)
}

const deck = (page: Page, kind: 'done' | 'undone') => page.getByTestId(`recap-deck-${kind}`)
const counter = (page: Page, kind: 'done' | 'undone') => deck(page, kind).locator('xpath=ancestor::section[1]').getByTestId('recap-deck-counter')
const nextChevron = (page: Page, kind: 'done' | 'undone') => page.getByTestId(`recap-next-${kind}`)
const prevChevron = (page: Page, kind: 'done' | 'undone') => page.getByTestId(`recap-prev-${kind}`)
/** Title of the front card of a deck (the one on top of the layers). */
const frontTitle = (page: Page, kind: 'done' | 'undone') => deck(page, kind).locator('.recap-deck__card[style*="z-index: 10"] .task-title-text')

/** Everything that must not move while a deck is looked at (#451): boxes of the page parts and the overlay's scroll size. */
async function layoutSnapshot(page: Page) {
  const box = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())
  const parts = {
    headline: recap(page).getByRole('heading', { name: 'Kurzer Rückblick' }),
    summary: summary(page),
    headingUndone: page.getByTestId('recap-deck-label').first(),
    headingDone: page.getByTestId('recap-deck-label').last(),
    deckUndone: deck(page, 'undone'),
    deckDone: deck(page, 'done'),
    barUndone: deck(page, 'undone').locator('xpath=following-sibling::div[1]'),
    barDone: deck(page, 'done').locator('xpath=following-sibling::div[1]'),
    panel: panelOf(page),
  }
  const boxes: Record<string, unknown> = {}
  for (const [name, locator] of Object.entries(parts)) boxes[name] = await box(locator.first())
  const scroll = await recap(page).evaluate(el => ({ scrollHeight: el.scrollHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollTop: el.scrollTop }))
  return { boxes, scroll }
}

/** Boxes that must not move on a phone while the shown deck advances. */
async function layoutSnapshot2(page: Page) {
  const box = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())
  return {
    deck: await box(deck(page, 'done')),
    panel: await box(panelOf(page)),
    drawer: await box(recap(page)),
    page: await page.evaluate(() => [document.documentElement.scrollHeight, document.documentElement.scrollWidth]),
  }
}

/** A done task with a long title, notes and topic: the deck height must not depend on it (#451). */
const recapLongTask = (): SeedTask => ({
  id: 'nd-long', title: 'Sehr langer Aufgabentitel, der sauber umbrechen muss, ohne die Zeile zu sprengen und ohne die Höhe des Stapels zu ändern',
  status: 3, priority: 3, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, notes: 'Lange Notizen '.repeat(30), completedAt: atDaysAgo(1, 8),
})

test.describe('New-day recap (#385)', () => {
  test('opens over a board that mounted behind it, with headline, sentence and two decks', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')

    await expect(recap(page)).toBeVisible()
    // A stage, not a dialog (#245): a named region on the welcome photo, the board is not visible behind it
    await expect(recap(page)).toHaveAttribute('role', 'region')
    await expect(page.getByRole('region', { name: 'Kurzer Rückblick' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('recap-photo')).toBeVisible()
    await expect(summary(page)).toHaveText('Du hast gestern 4 von 6 Aufgaben erledigt.')
    await expect(deck(page, 'done')).toHaveAccessibleName('4 erledigt, mit Pfeiltasten wechseln')
    await expect(deck(page, 'undone')).toHaveAccessibleName('2 noch offen, mit Pfeiltasten wechseln')
    // The board is mounted behind and inert (which also hides it from assistive tech; no aria-hidden besides)
    await expect(board(page)).toHaveAttribute('inert', '')
    await expect(board(page)).not.toHaveAttribute('aria-hidden')
    // The new day already sent the Offen card back (#356): the Wartet card is what the board holds behind the stage
    await expect(board(page).locator('[data-task-id="nd-waiting-1"]').first()).toBeAttached()
    await expect(board(page).locator('#column-open [data-task-id="nd-open-1"]')).toHaveCount(0)
    await expect(planButton(page)).toBeFocused()
  })

  test('opens on the first return of a new day without a click or navigation, not while the window stays focused (#242)', async ({ page, context }) => {
    // Done today, the marker is today: nothing is due. The page clock is then moved a day on, as after a night.
    await seedNewDayBoard(context, { daysAgo: 0, lastShownDay: dayKeyDaysAgo(0) })
    await context.addInitScript(() => {
      const RealDate = Date
      const w = window as unknown as { __shiftMs: number }
      w.__shiftMs = 0
      class ShiftedDate extends RealDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(RealDate.now() + w.__shiftMs)
          else super(...(args as [number]))
        }
        static now() { return RealDate.now() + w.__shiftMs }
      }
      window.Date = ShiftedDate as unknown as DateConstructor
    })
    await page.goto('/tasks')
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toBeHidden()

    // 09:00 of the next local day, whatever the hour the test runs at (a fixed 26h lands on D+2 after 22:00)
    await page.evaluate(() => {
      const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(9, 0, 0, 0)
      ;(window as unknown as { __shiftMs: number }).__shiftMs = next.getTime() - Date.now()
    })
    await page.waitForTimeout(300)
    await expect(recap(page)).toBeHidden() // still focused: the user is working, nothing opens by itself

    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(recap(page)).toBeVisible()
    await expect(summary(page)).toHaveText('Du hast gestern 4 von 6 Aufgaben erledigt.')
  })

  test('deck headings are centred and a Wartet card keeps the regular style (#242)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await settleAnimations(page)
    for (const kind of ['done', 'undone'] as const) {
      const section = deck(page, kind).locator('xpath=ancestor::section[1]')
      const heading = section.getByTestId('recap-deck-label')
      expect(await heading.evaluate(el => getComputedStyle(el).textAlign)).toBe('center')
      const h = (await heading.boundingBox())!
      const d = (await deck(page, kind).boundingBox())!
      expect(Math.abs(h.x + h.width / 2 - (d.x + d.width / 2))).toBeLessThan(2)
    }
    // the Wartet card is the second undone card: the deck's second layer holds it
    await nextChevron(page, 'undone').click()
    await expect(counter(page, 'undone')).toHaveText('2 / 2')
    await settleAnimations(page)
    const waiting = deck(page, 'undone').locator('.task-waiting')
    await expect(waiting).toHaveCount(1)
    expect(await waiting.evaluate(el => getComputedStyle(el).filter)).toBe('none')
  })

  test('switch on: "Weiter zum Board" archives without a toast and does not reopen', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(archiveSwitch(page)).toBeChecked()

    await continueButton(page).click()
    await expect(recap(page)).toBeHidden()
    await expect.poll(() => archived(page)).toHaveLength(4)
    await expectNoArchiveToast(page)
    await expect(doneColumn(page).getByTestId('yesterday-ack')).toHaveCount(0)
    await expect.poll(async () => (await marker(page))?.lastShownDay).toBe(dayKeyDaysAgo(0))

    // Sequence: a reload the same day neither reopens the recap nor brings the tasks back
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toHaveCount(0)
    await expect(board(page)).not.toHaveAttribute('inert', '')
    expect(await archived(page)).toHaveLength(4)
  })

  test('switch off: the board stays as it is, no toast; the choice survives a reload and the next recap', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')

    await archiveSwitch(page).uncheck()
    await expect.poll(async () => (await marker(page))?.archiveDone).toBe(false)
    await continueButton(page).click()
    await expect(recap(page)).toBeHidden()
    await expectNoArchiveToast(page)
    expect(await archived(page)).toEqual([])
    await expect(doneColumn(page).getByTestId('yesterday-ack')).toBeVisible()

    // Sequence: reload the same day (no recap), then a later day (recap again, switch still off)
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toHaveCount(0)

    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem('day-recap-store') as string)
      localStorage.setItem('day-recap-store', JSON.stringify({ ...state, lastShownDay: key }))
    }, dayKeyDaysAgo(1))
    // Reload on purpose (#512): a later day is a persisted marker change, the recap must open on the next load
    await page.reload()
    await expect(recap(page)).toBeVisible()
    await expect(archiveSwitch(page)).not.toBeChecked()
  })

  test('Escape follows the switch: archives when on, does nothing when off', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(recap(page)).toBeHidden()
    await expect.poll(() => archived(page)).toHaveLength(4)
    await expectNoArchiveToast(page)
    // Focus goes to the board region, never <body>
    await expect(board(page)).toBeFocused()
  })

  test('Escape with the switch off leaves the board unchanged', async ({ page, context }) => {
    await seedNewDayBoard(context, { archiveDone: false })
    await page.goto('/tasks')
    await expect(archiveSwitch(page)).not.toBeChecked()
    await page.keyboard.press('Escape')
    await expect(recap(page)).toBeHidden()
    expect(await archived(page)).toEqual([])
    await expectNoArchiveToast(page)
  })

  test('a reload the same day does not open it again', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await continueButton(page).click()
    await expect(recap(page)).toBeHidden()
    // Reload on purpose (#512): the reload itself is the behaviour under test (the recap must not reopen the same day)
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toHaveCount(0)
  })

  test('everything done: "alle Aufgaben" and only the Erledigt deck', async ({ page, context }) => {
    await seedNewDayBoard(context, { allDone: true })
    await page.goto('/tasks')
    await expect(summary(page)).toHaveText('Du hast gestern alle Aufgaben erledigt.')
    await expect(deck(page, 'done')).toHaveAccessibleName('4 erledigt, mit Pfeiltasten wechseln')
    await expect(deck(page, 'undone')).toHaveCount(0)
    // alone, the Erledigt deck is centred
    const alone = (await deck(page, 'done').boundingBox())!
    const viewport = page.viewportSize()!
    expect(Math.abs(alone.x + alone.width / 2 - viewport.width / 2)).toBeLessThan(2)
  })

  test('the seed URL opens it too: ?seed=newday', async ({ page }) => {
    await page.goto('/tasks?seed=newday')
    await expect(recap(page)).toBeVisible()
    await expect(summary(page)).toHaveText('Du hast gestern 4 von 6 Aufgaben erledigt.')
  })

  test('a task title on a card carries data-private', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(deck(page, 'done').locator('.task-title-text[data-private]')).toHaveCount(4)
    await expect(deck(page, 'undone').locator('.task-title-text[data-private]')).toHaveCount(2)
  })

  test('the recap has no accessibility violations at rest and after one advance', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    const violations = async () => (await new AxeBuilder({ page }).include('[data-testid="new-day-recap"]').analyze())
      .violations.map(v => `${v.id}: ${v.help} ${JSON.stringify(v.nodes.map(n => n.html.slice(0, 200)))}`)
    await expect(deck(page, 'done')).toBeVisible()
    await settleAnimations(page) // the modal scales and fades in: axe samples contrast at rest
    expect(await violations()).toEqual([])
    await nextChevron(page, 'done').click()
    await expect(counter(page, 'done')).toHaveText('2 / 4')
    await settleAnimations(page)
    expect(await violations()).toEqual([])
  })

  test('Offen sits left of Erledigt with each heading above its cards, on one baseline', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    const [undone, done] = [(await deck(page, 'undone').boundingBox())!, (await deck(page, 'done').boundingBox())!]
    expect(undone.x + undone.width).toBeLessThanOrEqual(done.x)
    expect(Math.abs(undone.y - done.y)).toBeLessThan(1)
    const headings = page.getByTestId('recap-deck-label')
    await expect(headings).toHaveText(['2 noch offen', '4 erledigt'])
    const [hUndone, hDone] = [(await headings.first().boundingBox())!, (await headings.last().boundingBox())!]
    expect(hUndone.y + hUndone.height).toBeLessThanOrEqual(undone.y)
    expect(hDone.y + hDone.height).toBeLessThanOrEqual(done.y)
    expect(Math.abs(hUndone.y - hDone.y)).toBeLessThan(1)
    // headline and sentence above both, the submit panel below both
    const head = (await summary(page).boundingBox())!
    const panel = (await archiveSwitch(page).boundingBox())!
    expect(head.y + head.height).toBeLessThanOrEqual(hUndone.y)
    expect(panel.y).toBeGreaterThanOrEqual(Math.max(undone.y + undone.height, done.y + done.height))
  })

  test('the submit panel groups switch and button: side by side when wide, the arrow icon after the label', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    const panel = panelOf(page)
    await expect(panel).toBeVisible()
    await settleAnimations(page) // the modal scales in: boxes are measured at rest
    const panelBox = (await panel.boundingBox())!
    const toggle = (await archiveSwitch(page).boundingBox())!
    const button = (await planButton(page).boundingBox())!
    const skip = (await continueButton(page).boundingBox())!
    // "Direkt zu Heute" left of "Tag planen" (#356), on one line
    expect(toggle.x + toggle.width).toBeLessThan(skip.x)
    expect(skip.x + skip.width).toBeLessThanOrEqual(button.x)
    expect(Math.abs(skip.y + skip.height / 2 - (button.y + button.height / 2))).toBeLessThan(2)
    // one row, both vertically centred in the panel
    expect(Math.abs(toggle.y + toggle.height / 2 - (button.y + button.height / 2))).toBeLessThan(6)
    expect(Math.abs(panelBox.y + panelBox.height / 2 - (button.y + button.height / 2))).toBeLessThan(2)
    await expect(continueButton(page)).toHaveAccessibleName('Direkt zu Heute')
    await expect(planButton(page)).toHaveAccessibleName('Tag planen')
    // trailing: the icon is the last child of the button, after the label, and decorative
    const icon = planButton(page).locator('svg[data-slot="trailingIcon"]')
    await expect(icon).toHaveAttribute('aria-hidden', 'true')
    const iconBox = (await icon.boundingBox())!
    const buttonBox = (await planButton(page).boundingBox())!
    expect(iconBox.x + iconBox.width).toBeGreaterThan(buttonBox.x + buttonBox.width / 2)
  })

  test('a drag past 80px advances, 60px snaps back; the next card is the new front and the counter wraps', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    const front = frontTitle(page, 'done')
    await expect(front).toHaveText('Retrospektive nachbereiten')
    await expect(counter(page, 'done')).toHaveText('1 / 4')
    const box = (await deck(page, 'done').boundingBox())!
    const y = box.y + 60
    const drag = async (from: number, to: number) => {
      await page.mouse.move(box.x + from, y)
      await page.mouse.down()
      await page.mouse.move(box.x + (from + to) / 2, y, { steps: 3 })
      await page.mouse.move(box.x + to, y, { steps: 3 })
      await page.mouse.up()
    }
    await drag(140, 80) // 60px left: snaps back
    await page.waitForTimeout(450)
    await expect(counter(page, 'done')).toHaveText('1 / 4')
    await expect(front).toHaveText('Retrospektive nachbereiten')

    await drag(100, 200) // 100px right: advances
    await expect(counter(page, 'done')).toHaveText('2 / 4')
    await expect(front).toHaveText('Steuerunterlagen sortieren')
    await drag(200, 100) // either direction
    await expect(counter(page, 'done')).toHaveText('3 / 4')
    await page.mouse.click(box.x + 140, y) // a tap goes next too
    await expect(counter(page, 'done')).toHaveText('4 / 4')
    await page.mouse.click(box.x + 140, y)
    await expect(counter(page, 'done')).toHaveText('1 / 4')
    await expect(front).toHaveText('Retrospektive nachbereiten')
    // cards are view-only: no task sheet, URL unchanged
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('keyboard and chevrons: ArrowRight x5 advances five, then back with ArrowLeft, only while the deck has focus', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    const done = deck(page, 'done')
    await done.focus()
    await expect(done).toBeFocused()
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    await expect(counter(page, 'done')).toHaveText('2 / 4') // 5 nexts on 4 cards wrap to the second
    await expect(counter(page, 'undone')).toHaveText('1 / 2')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')
    await expect(counter(page, 'done')).toHaveText('2 / 4') // quick right then left ends where it started
    await page.keyboard.press('ArrowLeft')
    await expect(counter(page, 'done')).toHaveText('1 / 4')
    // a modifier keeps browser shortcuts
    await page.keyboard.press('Alt+ArrowRight')
    await page.waitForTimeout(450)
    await expect(counter(page, 'done')).toHaveText('1 / 4')

    // the chevron has focus: arrow keys do nothing
    await nextChevron(page, 'done').focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(450)
    await expect(counter(page, 'done')).toHaveText('1 / 4')
    await nextChevron(page, 'done').click()
    await expect(counter(page, 'done')).toHaveText('2 / 4')
    await prevChevron(page, 'done').click()
    await prevChevron(page, 'done').click()
    await expect(counter(page, 'done')).toHaveText('4 / 4') // 1 / 4 wraps to 4 / 4
    await expect(counter(page, 'undone')).toHaveText('1 / 2')
  })

  test('the chevrons are disabled with a single card, which reads "1 / 1" and never moves', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: [newDayTasks(1)[0]!, newDayTasks(1)[4]!] })
    await page.goto('/tasks')
    await expect(counter(page, 'done')).toHaveText('1 / 1')
    await expect(nextChevron(page, 'done')).toBeDisabled()
    await expect(prevChevron(page, 'done')).toBeDisabled()
    const box = (await deck(page, 'done').boundingBox())!
    await page.mouse.move(box.x + 100, box.y + 60)
    await page.mouse.down()
    await page.mouse.move(box.x + 220, box.y + 60, { steps: 4 })
    await page.mouse.up()
    await deck(page, 'done').focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(450)
    await expect(counter(page, 'done')).toHaveText('1 / 1')
    await expect(frontTitle(page, 'done')).toHaveText('Angebot an Kunden schicken')
  })

  test('the live region announces the new front card after an advance', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    const live = deck(page, 'done').locator('xpath=ancestor::section[1]').getByTestId('recap-deck-live')
    await expect(live).toHaveAttribute('aria-live', 'polite')
    await expect(live).toHaveText('')
    await nextChevron(page, 'done').click()
    await expect.poll(() => live.textContent()).toBe('2 von 4: Steuerunterlagen sortieren')
  })

  test('tab order: deck, previous, next per deck, then the switch and the button; focus starts on the button, no trap (#245)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(planButton(page)).toBeFocused()
    const order = ['recap-deck-undone', 'recap-prev-undone', 'recap-next-undone', 'recap-deck-done', 'recap-prev-done', 'recap-next-done', 'recap-archive-toggle', 'recap-continue', 'recap-plan']
    const active = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid'))
    // Backwards from the button through every stop in reverse
    for (const id of order.slice(0, -1).reverse()) {
      await page.keyboard.press('Shift+Tab')
      await expect.poll(active).toBe(id)
    }
    // Forwards again to the button
    for (const id of order.slice(1)) {
      await page.keyboard.press('Tab')
      await expect.poll(active).toBe(id)
    }
    // Not a trap: the next Tab leaves the stage (the app bar is reachable), and the stage stays
    await page.keyboard.press('Tab')
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-testid="new-day-recap"]') === null)).toBe(true)
    await expect(recap(page)).toBeVisible()
    // Escape inside the stage still leaves
    await continueButton(page).focus()
    await page.keyboard.press('Escape')
    await expect(recap(page)).toBeHidden()
  })

  test('nothing moves: boxes and scroll size are the same at rest, mid-drag, mid-move and after advances and wraps', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: [...newDayTasks(1), recapLongTask()] })
    await page.goto('/tasks')
    await expect(deck(page, 'done')).toBeVisible()
    await settleAnimations(page) // the modal scales in: boxes are measured at rest
    const rest = await layoutSnapshot(page)
    expect(rest.scroll.scrollWidth).toBe(rest.scroll.clientWidth)

    const box = (await deck(page, 'done').boundingBox())!
    await page.mouse.move(box.x + 100, box.y + 60)
    await page.mouse.down()
    await page.mouse.move(box.x + 240, box.y + 70, { steps: 4 })
    expect(await layoutSnapshot(page)).toEqual(rest) // mid-drag
    await page.mouse.up()
    expect(await layoutSnapshot(page)).toEqual(rest) // mid-move (the card is still flying)
    await expect(counter(page, 'done')).toHaveText('2 / 5')

    for (let i = 0; i < 5; i++) {
      await nextChevron(page, 'done').click()
      await nextChevron(page, 'undone').click()
      expect(await layoutSnapshot(page)).toEqual(rest) // mid-move of both decks
    }
    await expect(counter(page, 'done')).toHaveText('2 / 5') // 1 + 1 + 5 wraps once
    await page.waitForTimeout(500)
    expect(await layoutSnapshot(page)).toEqual(rest)
  })

  test('with prefers-reduced-motion the card swaps at once, no slide', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(frontTitle(page, 'done')).toHaveText('Retrospektive nachbereiten')
    await nextChevron(page, 'done').click()
    // within one animation frame the card is swapped, and nothing is flying or fading
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))))
    await expect(frontTitle(page, 'done')).toHaveText('Steuerunterlagen sortieren')
    await expect.poll(() => deck(page, 'done').locator('.recap-deck__card').evaluateAll(els => els.map(el => getComputedStyle(el).transitionDuration))).toEqual(['0s', '0s', '0s', '0s'])
    await page.keyboard.press('Tab')
    await deck(page, 'done').focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(counter(page, 'done')).toHaveText('4 / 4')
  })

  test('a long title, notes and topic do not change the deck or card height', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: [...newDayTasks(1), recapLongTask()] })
    await page.goto('/tasks')
    await expect(deck(page, 'done')).toBeVisible()
    await settleAnimations(page) // the modal scales in: boxes are measured at rest
    const heights = new Set<number>()
    for (let i = 0; i < 5; i++) {
      heights.add(Math.round((await deck(page, 'done').boundingBox())!.height))
      await nextChevron(page, 'done').click()
      await page.waitForTimeout(450)
    }
    expect([...heights]).toHaveLength(1)
    const cardHeights = await deck(page, 'done').locator('.recap-deck__card .task').evaluateAll(els => els.map(el => (el as HTMLElement).offsetHeight))
    expect(new Set(cardHeights).size).toBe(1)
  })

  test('the command palette opens over the stage (the bar stays usable) and Escape there does not leave the recap', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(recap(page)).toBeVisible()
    expect(await archived(page)).toEqual([])
  })

  test('the app bar stays usable: settings and back shows the same recap again, nothing archived (#245)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await expect(appNav(page)).toBeVisible()
    await openSettings(page)
    await expect(recap(page)).toHaveCount(0)
    await goToPlace(page, 'Heute')
    await expect(recap(page)).toBeVisible()
    await expect(summary(page)).toHaveText('Du hast gestern 4 von 6 Aufgaben erledigt.')
    expect(await archived(page)).toEqual([])
    expect((await marker(page))?.lastShownDay).not.toBe(dayKeyDaysAgo(0))
  })

  test('the stage covers the board; the bar is above it (#245)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    const top = await page.evaluate(() => {
      const at = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-testid="new-day-recap"], [data-testid="app-nav"]')?.getAttribute('data-testid') ?? null
      return { corner: at(8, innerHeight - 8) }
    })
    expect(top.corner).toBe('new-day-recap')
  })

  test('the photo runs behind the app bar: no paper band, no veil, the brand and labels stay readable (#262)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await expect(page.getByTestId('recap-photo')).toHaveCSS('opacity', '1')
    const hit = await page.evaluate(() => {
      const at = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-testid="new-day-recap"], [data-testid="app-nav"]')?.getAttribute('data-testid') ?? null
      const pill = document.querySelector('[data-testid="app-nav-place-board"]')!.getBoundingClientRect()
      return { row: at(8, 8), pill: at(pill.x + pill.width / 2, pill.y + pill.height / 2) }
    })
    // The stage reaches the window's top edge (the row above the photo was the page paper); the pills stay above it
    expect(hit).toEqual({ row: 'new-day-recap', pill: 'app-nav' })
    // The bar's paper veil steps back, so it does not wash the photo
    await expect.poll(() => appNav(page).evaluate(el => getComputedStyle(el, '::before').opacity)).toBe('0')
    // The brand has no pill: it is read straight on the photo
    await expectContrast(page, appNav(page).locator('.app-nav-brand-text'), 4.5)
    await expectContrast(page, page.getByTestId('app-nav-place-board'), 4.5)
    await expectContrast(page, page.getByTestId('app-nav-place-statistics'), 4.5)
    // Back on the board the veil returns
    await continueButton(page).click()
    await expect(recap(page)).toHaveCount(0)
    await expect.poll(() => appNav(page).evaluate(el => getComputedStyle(el, '::before').opacity)).toBe('1')
  })

  test('curtain: only the photo slides up, the board is live from the first moment, then the stage is gone and focus is on the board (#245)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await continueButton(page).click()
    await expect(board(page)).not.toHaveAttribute('inert', '')
    // while the curtain runs the stage no longer takes pointer input and only its photo layer carries the transform
    await expect(recap(page)).toHaveAttribute('data-closing', 'true')
    await expect(recap(page)).toHaveCSS('pointer-events', 'none')
    await expect(recap(page)).toBeHidden({ timeout: 5000 })
    await expect(board(page)).toBeFocused()
  })

  test('reduced motion: no curtain, gone at once (#245)', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await continueButton(page).click()
    await expect(recap(page)).toHaveCount(0)
  })

  test.describe('Notion stub (mixed board)', () => {
    test('the board fetch has started while the recap is open; Local and Notion tasks are listed source-blind', async ({ page, context }) => {
      const localDone: SeedTask = {
        id: 'local-done-old', title: 'Lokal: erledigt', status: 3, priority: 2, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {},
        completedAt: atDaysAgo(1, 10), source: 'local', externalId: null,
      }
      await seedMixedBoard(context, [...MIXED_SEED_TASKS.filter(t => t.status !== 3), localDone], { once: true })
      await seedDayRecapStore(context, { lastShownDay: dayKeyDaysAgo(2), once: true })

      const fetched = page.waitForRequest('**/api/notion/query-data-source')
      await page.goto('/tasks')
      await expect(recap(page)).toBeVisible()
      await fetched
      await expect(recap(page)).toBeVisible()
      await expect(summary(page)).toContainText('erledigt')
      await expect(deck(page, 'done')).toHaveAccessibleName('1 erledigt')
      await expect(deck(page, 'done')).not.toHaveAttribute('tabindex')
    })
  })

  test('with the focus setting on and a task in Jetzt, no overlay shows while the recap is open, and it behaves as normal after "Weiter zum Board"', async ({ page, context }) => {
    const nowTask: SeedTask = { id: 'nd-now-1', title: 'Gerade in Arbeit', status: 1, priority: 3, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {} }
    // The new day's pass already ran today (#356) and this task was put into Jetzt after it; the recap is still unanswered
    await seedNewDayBoard(context, { tasks: [...newDayTasks(1), nowTask], focus: true, lastNewDay: dayKeyDaysAgo(0) })
    await page.goto('/tasks')

    await expect(recap(page)).toBeVisible()
    await expect(page.locator('#column-progress .task[data-current]')).toBeAttached()
    // Neither mounted under the recap nor fading in while it is up (the overlay needs ~1 s of rest to appear)
    await expect(page.getByTestId('focus-overlay')).toHaveCount(0)
    await expect(page.locator('.board')).not.toHaveAttribute('data-focus', '')
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('focus-overlay')).toHaveCount(0)

    await continueButton(page).click()
    await expect(recap(page)).toBeHidden()
    // Back on the board the overlay comes on after the usual rest
    await expect(page.locator('.board')).toHaveAttribute('data-focus', '')
    await expect.poll(async () => (await page.getByTestId('focus-overlay').getAttribute('class').catch(() => null))?.includes('is-on') ?? false, { timeout: 8000 }).toBe(true)
  })

  test.describe('390px', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('a stage without scroll bar: one deck at a time under a switcher, the panel pinned, the page never scrolls', async ({ page, context }) => {
      await seedNewDayBoard(context)
      await page.goto('/tasks')

      await expect(recap(page)).toBeVisible()
      await expect(recap(page)).toHaveAttribute('role', 'region')
      const noScroll = () => page.evaluate(() => {
        const body = document.querySelector('[data-testid="new-day-recap"] .recap-stage__scroll') as HTMLElement
        return { page: document.documentElement.scrollHeight <= innerHeight, pageX: document.documentElement.scrollWidth <= innerWidth, body: body.scrollHeight <= body.clientHeight }
      })
      expect(await noScroll()).toEqual({ page: true, pageX: true, body: true })

      // One deck, "noch offen" first; the switcher says how many are in each
      await expect(switcher(page, 'undone')).toHaveText('2 noch offen')
      await expect(switcher(page, 'done')).toHaveText('4 erledigt')
      await expect(switcher(page, 'undone')).toHaveAttribute('aria-selected', 'true')
      await expect(deck(page, 'undone')).toBeVisible()
      await expect(deck(page, 'done')).toHaveCount(0)
      await expect(deck(page, 'undone')).toHaveAccessibleName('2 noch offen, mit Pfeiltasten wechseln')

      await switcher(page, 'done').tap()
      await expect(switcher(page, 'done')).toHaveAttribute('aria-selected', 'true')
      await expect(deck(page, 'done')).toBeVisible()
      await expect(deck(page, 'undone')).toHaveCount(0)
      expect(await noScroll()).toEqual({ page: true, pageX: true, body: true })

      // The panel stacks in the thumb zone: switch above, full-width button below, both in view
      const button = continueButton(page)
      await expect(button).toBeInViewport({ ratio: 1 })
      const toggleBox = (await archiveSwitch(page).boundingBox())!
      const box = (await button.boundingBox())!
      expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(box.y)
      expect(box.width).toBeGreaterThan(390 - 2 * 40)
      // the stage sits above the phone bar, which stays usable
      expect(box.y + box.height).toBeLessThan(844 - 72)

      // a tap and a mouse drag past 80px advance the deck without moving anything
      const before = await layoutSnapshot2(page)
      await deck(page, 'done').tap({ position: { x: 140, y: 60 } })
      await expect(counter(page, 'done')).toHaveText('2 / 4')
      expect(await layoutSnapshot2(page)).toEqual(before)

      await button.tap()
      await expect(recap(page)).toBeHidden()
    })

    test('a touch swipe on the deck advances it and never closes the recap (closing would archive the done tasks)', async ({ page, context }) => {
      await seedNewDayBoard(context)
      await page.goto('/tasks')
      await expect(recap(page)).toBeVisible()
      await switcher(page, 'done').tap()
      await expect(counter(page, 'done')).toHaveText('1 / 4')
      const box = (await deck(page, 'done').boundingBox())!
      const cdp = await context.newCDPSession(page)
      const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
        cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
      // a thumb swipe: mostly sideways, drifting down as it goes (vaul reads the vertical part as a drawer drag)
      const swipe = async (dx: number, dy: number) => {
        const x0 = box.x + box.width / 2 - dx / 2
        const y0 = box.y + 50
        await touch('touchStart', x0, y0)
        for (let i = 1; i <= 8; i++) await touch('touchMove', x0 + (dx * i) / 8, y0 + (dy * i) / 8)
        // the drawer must not follow the finger down, even before the release decides anything
        expect(await recap(page).evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBe(0)
        await touch('touchEnd', x0 + dx, y0 + dy)
      }
      await swipe(120, 40)
      await expect(counter(page, 'done')).toHaveText('2 / 4')
      await swipe(-160, 70)
      await expect(counter(page, 'done')).toHaveText('3 / 4')
      await page.waitForTimeout(500)
      await expect(recap(page)).toBeVisible()
      expect(await archived(page)).toEqual([])
    })

    test('with nothing open there is no switcher, only the done deck', async ({ page, context }) => {
      await seedNewDayBoard(context, { allDone: true })
      await page.goto('/tasks')
      await expect(deck(page, 'done')).toBeVisible()
      await expect(switcher(page, 'undone')).toHaveCount(0)
      await expect(switcher(page, 'done')).toHaveCount(0)
      await expect(deck(page, 'undone')).toHaveCount(0)
      await expect(continueButton(page)).toBeInViewport({ ratio: 1 })
    })
  })
})

/**
 * #356 (epic #334): a new day sends what was planned and not finished (Offen, Jetzt) back to "Nicht geplant", and the
 * recap has two ways out. `seedNewDayBoard` stores an earlier pass, so the pass runs and the one-time note stays away;
 * `firstPass: true` is the first morning after the update.
 */
test.describe('A new day sends unfinished cards back (#356)', () => {
  const side = (page: Page) => page.getByTestId('not-planned')
  const groupIds = (page: Page, group: 'yesterday' | 'others') =>
    page.getByTestId(`not-planned-list-${group}`).locator('[data-not-planned-id]').evaluateAll(els => els.map(el => el.getAttribute('data-not-planned-id')))
  const openIds = (page: Page) =>
    page.locator('#column-open-list > .task-wrapper').evaluateAll(els => els.map(el => el.getAttribute('data-task-id')))
  const sentence = (page: Page) => page.getByTestId('open-yesterday-note')
  const note = (page: Page) => page.getByTestId('new-day-note')
  const storedTask = (page: Page, id: string) =>
    page.evaluate(taskId => (JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: Array<Record<string, unknown>> }).tasks?.find(task => task.id === taskId) ?? null, id)
  const settled = async (page: Page) => {
    await expect(recap(page)).toBeHidden({ timeout: 5000 })
    await settleAnimations(page)
  }

  test('"Tag planen" leads to "Alle": yesterday\'s Jetzt and Offen cards are the group on top, above "Weitere Aufgaben"; Wartet stays', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks() })
    await page.goto('/tasks')
    // the recap still looks at yesterday's board: Jetzt, both Offen cards and the Wartet card are "noch offen"
    await expect(summary(page)).toHaveText('Du hast gestern 4 von 8 Aufgaben erledigt.')
    await expect(planButton(page)).toBeFocused()
    await expect(planButton(page)).toHaveText('Tag planen')
    await expect(continueButton(page)).toHaveText('Direkt zu Heute')

    await planButton(page).click()
    await expect(page).toHaveURL(/\/all$/)
    await settled(page)
    await expect(page.getByRole('heading', { level: 3, name: 'Gestern geplant, noch offen' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: 'Weitere Aufgaben' })).toBeVisible()
    // board order, Jetzt first
    await expect.poll(() => groupIds(page, 'yesterday')).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1'])
    await expect.poll(() => groupIds(page, 'others')).toEqual(['nd-held-1'])
    expect(await openIds(page)).toEqual([])
    await expect(note(page)).toHaveCount(0)

    // Wartet stayed; the Jetzt task is an Offen task that is not planned, with its time
    await goToPlace(page, 'Heute')
    await expect(page.locator('#column-waiting [data-task-id="nd-waiting-1"]').first()).toBeVisible()
    await expect(page.locator('#column-progress .task-wrapper')).toHaveCount(0)
    expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 0, notPlanned: true, timeSpentSeconds: 1800 })
  })

  test('"Direkt zu Heute": an empty Offen says how many tasks of yesterday wait under "Alle", with a link; planning one ends the sentence', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks() })
    await page.goto('/tasks')
    await continueButton(page).click()
    await settled(page)
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(sentence(page)).toHaveText('3 Aufgaben von gestern liegen unter Alle.')

    await sentence(page).getByRole('link', { name: 'Alle' }).click()
    await expect(page).toHaveURL(/\/all$/)
    await settleAnimations(page)
    // on "Alle" the group is beside the column: Offen stays blank
    await expect(sentence(page)).toHaveCount(0)

    // a task planned again keeps its time spent and leaves the group
    await side(page).locator('[data-not-planned-id="nd-now-1"]').getByTestId('not-planned-pick').click()
    await expect.poll(() => openIds(page)).toEqual(['nd-now-1'])
    await expect.poll(() => groupIds(page, 'yesterday')).toEqual(['nd-open-2', 'nd-open-1'])
    expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 0, timeSpentSeconds: 1800 })
    expect(await storedTask(page, 'nd-now-1')).not.toHaveProperty('notPlanned')
    await goToPlace(page, 'Heute')
    await expect(sentence(page)).toHaveCount(0)

    // once per day: a reload and a return to the app leave the planned card in Offen
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toHaveCount(0)
    await expect.poll(() => openIds(page)).toEqual(['nd-now-1'])
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(() => openIds(page)).toEqual(['nd-now-1'])
    // "Nicht heute" puts it back into the group, and the sentence counts it again
    await goToPlace(page, 'Alle')
    await expect.poll(() => groupIds(page, 'yesterday')).toEqual(['nd-open-2', 'nd-open-1'])
  })

  test('one task of yesterday: the sentence is singular', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await continueButton(page).click()
    await settled(page)
    await expect(sentence(page)).toHaveText('Eine Aufgabe von gestern liegt unter Alle.')
  })

  test('the sentence in an empty Offen counts what the topic focus leaves of the group, as "Alle" shows it', async ({ page, context }) => {
    const topics: Record<string, string> = { 'nd-now-1': 'Keller', 'nd-open-2': 'Keller', 'nd-open-1': 'Büro', 'nd-held-1': 'Garten' }
    const tasks = newDayBackTasks().filter(task => task.status !== 3).map(task => ({ ...task, topic: topics[task.id] ?? null }))
    await seedNewDayBoard(context, { tasks })
    await page.goto('/tasks')
    await expect(sentence(page)).toHaveText('3 Aufgaben von gestern liegen unter Alle.')
    // the funnel has cards to filter only under "Alle" (Heute's Offen is empty): the focus is set there
    const focusOn = async (topic: string) => {
      await page.getByTestId('focus-trigger').click()
      await page.getByTestId('focus-chip').filter({ hasText: topic }).click()
    }
    await goToPlace(page, 'Alle')
    await expect.poll(() => groupIds(page, 'yesterday')).toHaveLength(3)
    // the focus leaves one task of the group: the sentence says one, and "Alle" shows exactly that one
    await focusOn('Büro')
    await goToPlace(page, 'Heute')
    await expect(sentence(page)).toHaveText('Eine Aufgabe von gestern liegt unter Alle.')
    await sentence(page).getByRole('link', { name: 'Alle' }).click()
    await expect(page).toHaveURL(/\/all$/)
    await expect.poll(() => groupIds(page, 'yesterday')).toEqual(['nd-open-1'])
    // the focus leaves none of the group (a task that was not sent back matches): no sentence, no link to nothing
    await page.getByTestId('focus-trigger').click() // the funnel ends the focus that is on
    await focusOn('Garten')
    await goToPlace(page, 'Heute')
    await expect(sentence(page)).toHaveCount(0)
  })

  test('without a recap (nothing was done yesterday) the cards go back all the same', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks().filter(task => task.status !== 3) })
    await page.goto('/tasks')
    await expect(board(page)).toBeVisible()
    await expect(sentence(page)).toHaveText('3 Aufgaben von gestern liegen unter Alle.')
    await expect(recap(page)).toHaveCount(0)
    await goToPlace(page, 'Alle')
    await expect.poll(() => groupIds(page, 'yesterday')).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1'])
  })

  /** The page clock runs on (`__shiftMs` moves it): a night passes without a reload. */
  const installShiftedClock = (context: BrowserContext) => context.addInitScript(() => {
    const RealDate = Date
    const w = window as unknown as { __shiftMs: number }
    w.__shiftMs = 0
    class ShiftedDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(RealDate.now() + w.__shiftMs)
        else super(...(args as [number]))
      }
      static now() { return RealDate.now() + w.__shiftMs }
    }
    window.Date = ShiftedDate as unknown as DateConstructor
  })
  const nextMorning = (page: Page) => page.evaluate(() => {
    const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(9, 0, 0, 0)
    ;(window as unknown as { __shiftMs: number }).__shiftMs = next.getTime() - Date.now()
  })

  test('app left open over midnight: nothing moves while the user works in the window, the next return after an absence sends the cards back', async ({ page, context }) => {
    // The marker is today: nothing is due. The page clock is then moved a day on, as after a night.
    await seedNewDayBoard(context, { daysAgo: 0, lastShownDay: dayKeyDaysAgo(0), tasks: newDayBackTasks(0).filter(task => task.status !== 3) })
    await installShiftedClock(context)
    await page.goto('/tasks')
    await expect.poll(() => openIds(page)).toEqual(['nd-open-2', 'nd-open-1'])
    await expect(page.locator('#column-progress [data-task-id="nd-now-1"]').first()).toBeVisible()

    await nextMorning(page)
    await page.waitForTimeout(300)
    expect(await openIds(page)).toEqual(['nd-open-2', 'nd-open-1']) // still focused: the cards stay under the user's hands

    // a glance at another window is not leaving: its return starts nothing
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(300)
    expect(await openIds(page)).toEqual(['nd-open-2', 'nd-open-1'])

    // a real absence (the grace is 60 s: the page clock jumps past it), then the return
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.evaluate(() => { (window as unknown as { __shiftMs: number }).__shiftMs += 120_000 })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(sentence(page)).toHaveText('3 Aufgaben von gestern liegen unter Alle.')
    await expect(page.locator('#column-progress .task-wrapper')).toHaveCount(0)
    // the Jetzt task's time from before midnight is kept (the clock jump itself counts no second)
    expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 0, notPlanned: true })
    expect((await storedTask(page, 'nd-now-1'))!.timeSpentSeconds).toBeGreaterThanOrEqual(1800)
    expect((await storedTask(page, 'nd-now-1'))!.timeSpentSeconds).toBeLessThan(1800 + 30)
  })

  test('a route change after midnight (a sheet opens and closes while the user works) does not send the cards back, and neither does the recap open', async ({ page, context }) => {
    await seedNewDayBoard(context, { daysAgo: 0, lastShownDay: dayKeyDaysAgo(0), tasks: newDayBackTasks(0) })
    await installShiftedClock(context)
    await page.goto('/tasks')
    await expect.poll(() => openIds(page)).toEqual(['nd-open-2', 'nd-open-1'])

    await nextMorning(page)
    await page.locator('#column-open-list [data-task-id="nd-open-1"]').first().click()
    await expect(page).toHaveURL(/\/tasks\/nd-open-1$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/tasks$/)
    await settleAnimations(page)
    await page.waitForTimeout(300)
    expect(await openIds(page)).toEqual(['nd-open-2', 'nd-open-1'])
    await expect(page.locator('#column-progress [data-task-id="nd-now-1"]').first()).toBeVisible()
    await expect(recap(page)).toHaveCount(0)
    await expect(sentence(page)).toHaveCount(0)
    expect(await storedTask(page, 'nd-now-1')).not.toHaveProperty('notPlanned')

    // the next return after an absence is the new day: the pass, then the recap
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.evaluate(() => { (window as unknown as { __shiftMs: number }).__shiftMs += 120_000 })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(recap(page)).toBeVisible()
    expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 0, notPlanned: true })
  })

  test('the first morning after the update: a one-time note on Heute and on "Alle"; "Alle wieder einplanen" puts every card back, once', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks(), firstPass: true })
    await page.goto('/tasks')
    await continueButton(page).click()
    await settled(page)
    await expect(note(page)).toBeVisible()
    await expect(note(page)).toHaveAttribute('role', 'status')
    await expect(note(page)).toContainText('Neu: Jeder Tag beginnt mit einem leeren Plan.')
    await expect(note(page)).toContainText('3 Aufgaben aus Offen und Jetzt liegen jetzt unter „Alle“ bei „Nicht geplant“.')
    await goToPlace(page, 'Alle')
    await expect(note(page)).toBeVisible()

    await page.getByTestId('new-day-note-plan-all').click()
    await expect(note(page)).toHaveCount(0)
    // back in Offen in their order, the Jetzt task too (no timer starts by itself); what was not planned before stays
    await expect.poll(() => openIds(page)).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1'])
    await expect.poll(() => groupIds(page, 'others')).toEqual(['nd-held-1'])
    await expect(page.getByTestId('not-planned-group-yesterday')).toHaveCount(0)
    await expect(page.getByTestId('not-planned-group-others')).toHaveCount(0)
    await expect(page.getByTestId('plan-announcement')).toHaveText('3 Aufgaben sind wieder für heute geplant.')
    expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 0, timeSpentSeconds: 1800 })

    // never again: not after a reload, and the cards stay
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect(note(page)).toHaveCount(0)
    await expect.poll(() => openIds(page)).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1'])
  })

  test('the first morning: "Schließen" leaves the cards under "Alle" and the note stays away after a reload', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks(), firstPass: true })
    await page.goto('/tasks')
    await continueButton(page).click()
    await settled(page)
    await page.getByTestId('new-day-note-close').click()
    await expect(note(page)).toHaveCount(0)
    await expect(sentence(page)).toHaveText('3 Aufgaben von gestern liegen unter Alle.')
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect(note(page)).toHaveCount(0)
    await expect(sentence(page)).toBeVisible()
  })

  test('the group headings follow the topic focus: a group without a match is not shown', async ({ page, context }) => {
    const tasks = newDayBackTasks().filter(task => task.status !== 3).map(task =>
      ({ ...task, topic: task.id === 'nd-held-1' ? 'Keller' : task.id === 'nd-waiting-1' ? null : 'Büro' }))
    await seedNewDayBoard(context, { tasks })
    await page.goto('/all')
    await expect.poll(() => groupIds(page, 'yesterday')).toHaveLength(3)
    await page.getByTestId('focus-trigger').click()
    await page.getByTestId('focus-chip').filter({ hasText: 'Keller' }).click()
    await expect(page.getByTestId('not-planned-group-yesterday')).toHaveCount(0)
    await expect(page.getByTestId('not-planned-group-others')).toHaveCount(0)
    await expect.poll(() => groupIds(page, 'others')).toEqual(['nd-held-1'])
  })

  test('Escape on the recap dismisses without a move: on "Alle" the place stays "Alle"', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks() })
    await page.goto('/all')
    await expect(recap(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await settled(page)
    await expect(page).toHaveURL(/\/all$/)
    await expect.poll(() => groupIds(page, 'yesterday')).toHaveLength(3)
  })

  test('the pick moves keyboard focus on across the group heading', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks().filter(task => task.status !== 3 && task.id !== 'nd-open-2' && task.id !== 'nd-now-1') })
    await page.goto('/all')
    await expect.poll(() => groupIds(page, 'yesterday')).toEqual(['nd-open-1'])
    const pick = (id: string) => side(page).locator(`[data-not-planned-id="${id}"]`).getByTestId('not-planned-pick')
    await pick('nd-open-1').focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => openIds(page)).toEqual(['nd-open-1'])
    // the last card of the first group hands on to the first card below the heading
    await expect(pick('nd-held-1')).toBeFocused()
  })

  test.describe('390px', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

    test('the note stacks its actions below the text, and the buttons of the recap stack with "Tag planen" on top', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: newDayBackTasks(), firstPass: true })
      await page.goto('/tasks')
      const plan = (await planButton(page).boundingBox())!
      const skip = (await continueButton(page).boundingBox())!
      expect(plan.y + plan.height).toBeLessThanOrEqual(skip.y)
      await continueButton(page).click()
      await settled(page)
      const text = (await note(page).getByText('Neu: Jeder Tag beginnt mit einem leeren Plan.').boundingBox())!
      const action = (await page.getByTestId('new-day-note-plan-all').boundingBox())!
      expect(action.y).toBeGreaterThan(text.y + text.height)
      expect(action.height).toBeGreaterThanOrEqual(44)
      // no sideways scroll
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await expect(sentence(page)).toHaveText('3 Aufgaben von gestern liegen unter Alle.')
    })
  })
})
