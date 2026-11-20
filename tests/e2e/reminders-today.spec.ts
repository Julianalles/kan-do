import { test, expect, type Page } from '@playwright/test'
import { seedRemindersBoard, dayKeyDaysAhead } from './helpers/seed'
import { persistedStores, setReminderDue, stubState } from './helpers/tauriStub'
import type { ReminderStub, TauriStubState } from './helpers/tauriStub'

/**
 * Apple Reminders, today sync (#553, epic #481 slice 4): the date is the plan, planning writes the date. The Tauri stub plays
 * macOS (compare-and-set `reminders_set_due`, as `src-tauri/src/reminders.rs`); native behaviour (what EventKit does with the
 * saved date, alerts) is the user's Mac check, not this spec.
 */

const TODAY = dayKeyDaysAhead(0)
const FUTURE = dayKeyDaysAhead(5)
const PAST = dayKeyDaysAhead(-4)
const readable = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(year!, month! - 1, day!))
}

const reminders: ReminderStub[] = [
  { id: 'r-today', listId: 'list-home', title: 'Heute fällig', due: { date: TODAY, time: '08:00' } },
  { id: 'r-future', listId: 'list-home', title: 'Später fällig', due: { date: FUTURE, time: '09:30' } },
  { id: 'r-past', listId: 'list-home', title: 'Längst fällig', due: { date: PAST, time: null } },
  { id: 'r-none', listId: 'list-home', title: 'Ohne Datum', due: null },
  { id: 'r-series', listId: 'list-home', title: 'Jede Woche', due: { date: FUTURE, time: null }, recurrence: { rule: 'FREQ=WEEKLY' }, nextDue: { date: dayKeyDaysAhead(12), time: null } },
]

const calls = async (page: Page, cmd: string): Promise<TauriStubState['calls']> => (await stubState(page)).calls.filter(call => call.cmd === cmd)
const stubDue = async (page: Page, id: string) => (await stubState(page)).reminders.reminders.find(r => r.id === id)?.due ?? null
const storedTask = async (page: Page, title: string) =>
  (((await persistedStores(page))['tasks-store']?.tasks ?? []) as Array<Record<string, unknown>>).find(task => task.title === title)

const openList = (page: Page) => page.locator('#column-open-list')
const held = (page: Page) => page.getByTestId('not-planned')
const heldCard = (page: Page, title: string) => held(page).locator('[data-not-planned-id]', { hasText: title })
/** The visible sentence of a toast (the screen-reader copy of the toast and the live region of the move repeat parts of it) */
const toastText = (page: Page, text: string) => page.getByText(text).last()
const toastButton = (page: Page, name: string) => page.getByRole('button', { name })

test.describe('Apple Reminders: today sync (#553)', () => {
  test.beforeEach(async ({ context }) => {
    await seedRemindersBoard(context, { reminders })
  })

  test('a reminder dated today is planned, every other date waits in "Alle Aufgaben"; nothing is written', async ({ page }) => {
    await page.goto('/all')
    await expect(openList(page).getByText('Heute fällig')).toBeVisible()
    for (const title of ['Später fällig', 'Längst fällig', 'Ohne Datum', 'Jede Woche']) {
      await expect(heldCard(page, title)).toBeVisible()
      await expect(openList(page).getByText(title)).toHaveCount(0)
    }
    expect(await calls(page, 'reminders_set_due')).toEqual([])
  })

  test('planning writes today, keeps the time, names the old date; Rückgängig restores it and puts the task back', async ({ page }) => {
    await page.goto('/all')
    await heldCard(page, 'Später fällig').getByTestId('not-planned-pick').click()
    await expect(openList(page).getByText('Später fällig')).toBeVisible()

    await expect.poll(() => stubDue(page, 'r-future')).toEqual({ date: TODAY, time: '09:30' })
    const write = (await calls(page, 'reminders_set_due'))[0]?.args
    expect(write).toMatchObject({ id: 'r-future', expectedDate: FUTURE, date: TODAY, allowedListIds: ['list-home'] })
    await expect(toastText(page, `In Erinnerungen jetzt heute statt ${readable(FUTURE)}.`)).toBeVisible()

    await toastButton(page, 'Rückgängig').click()
    await expect.poll(() => stubDue(page, 'r-future')).toEqual({ date: FUTURE, time: '09:30' })
    await expect(heldCard(page, 'Später fällig')).toBeVisible()
    await expect(openList(page).getByText('Später fällig')).toHaveCount(0)
  })

  test('a past date is replaced and a reminder without a date becomes today, without a time', async ({ page }) => {
    await page.goto('/all')
    await heldCard(page, 'Längst fällig').getByTestId('not-planned-pick').click()
    await expect.poll(() => stubDue(page, 'r-past')).toEqual({ date: TODAY, time: null })
    await expect(toastText(page, `statt ${readable(PAST)}, ohne Uhrzeit.`)).toBeVisible()

    await heldCard(page, 'Ohne Datum').getByTestId('not-planned-pick').click()
    await expect.poll(() => stubDue(page, 'r-none')).toEqual({ date: TODAY, time: null })
    await expect(toastText(page, 'In Erinnerungen jetzt heute, ohne Uhrzeit.')).toBeVisible()
  })

  test('a recurring reminder is planned without a write; the toast says the date stays', async ({ page }) => {
    await page.goto('/all')
    await heldCard(page, 'Jede Woche').getByTestId('not-planned-pick').click()
    await expect(openList(page).getByText('Jede Woche')).toBeVisible()
    await expect(toastText(page, 'Das Datum bleibt, die Aufgabe wiederholt sich.')).toBeVisible()
    expect(await calls(page, 'reminders_set_due')).toEqual([])
    // The plan is kan-do's: a sync does not take the card off the board
    await page.reload()
    await expect(openList(page).getByText('Jede Woche')).toBeVisible()
    expect(await calls(page, 'reminders_set_due')).toEqual([])
  })

  test('putting a task back writes nothing; the toast offers the old date once, tapping it restores', async ({ page }) => {
    await page.goto('/all')
    await heldCard(page, 'Später fällig').getByTestId('not-planned-pick').click()
    await expect.poll(() => stubDue(page, 'r-future')).toEqual({ date: TODAY, time: '09:30' })
    const writes = (await calls(page, 'reminders_set_due')).length

    await openList(page).locator('.task-wrapper', { hasText: 'Später fällig' }).getByTestId('not-today-arrow').click({ force: true })
    await expect(heldCard(page, 'Später fällig')).toBeVisible()
    await expect(toastText(page, 'In Erinnerungen steht sie weiter auf heute.')).toBeVisible()
    await expect(toastButton(page, `Altes Datum zurück: ${readable(FUTURE)}`)).toBeVisible()
    expect((await calls(page, 'reminders_set_due')).length).toBe(writes)

    // The card says why it is here, through every sync (the put-back is persisted first: the write is debounced)
    await expect.poll(async () => (await storedTask(page, 'Später fällig'))?.notPlanned).toBe(true)
    await page.reload()
    await expect(heldCard(page, 'Später fällig')).toBeVisible()
    await expect(heldCard(page, 'Später fällig').getByTestId('task-reminders-hint')).toHaveAttribute('title', 'Heute in Apple Erinnerungen fällig, hier zurückgelegt')
    expect(await stubDue(page, 'r-future')).toEqual({ date: TODAY, time: '09:30' })
  })

  test('the offer on the put-back toast writes the old date and the task stays in "Alle Aufgaben"', async ({ page }) => {
    await page.goto('/all')
    await heldCard(page, 'Später fällig').getByTestId('not-planned-pick').click()
    await expect.poll(() => stubDue(page, 'r-future')).toEqual({ date: TODAY, time: '09:30' })
    await openList(page).locator('.task-wrapper', { hasText: 'Später fällig' }).getByTestId('not-today-arrow').click({ force: true })
    await toastButton(page, `Altes Datum zurück: ${readable(FUTURE)}`).click()
    await expect.poll(() => stubDue(page, 'r-future')).toEqual({ date: FUTURE, time: '09:30' })
    await expect(heldCard(page, 'Später fällig')).toBeVisible()
  })

  test('a date changed in Reminders follows at the next sync; a card on today\'s board stays', async ({ page }) => {
    await page.goto('/all')
    await expect(openList(page).getByText('Heute fällig')).toBeVisible()
    await setReminderDue(page, 'r-today', dayKeyDaysAhead(9))
    await setReminderDue(page, 'r-future', TODAY)
    await page.reload()
    // The planned card stays on the board; its date follows
    await expect(openList(page).getByText('Heute fällig')).toBeVisible()
    await expect.poll(async () => ((await storedTask(page, 'Heute fällig'))?.reminders as { due?: { date: string } } | undefined)?.due?.date).toBe(dayKeyDaysAhead(9))
    // A held task dated today in Reminders joins the board, nothing written
    await expect(openList(page).getByText('Später fällig')).toBeVisible()
    expect(await calls(page, 'reminders_set_due')).toEqual([])
  })
})
