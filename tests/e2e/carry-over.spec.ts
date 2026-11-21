import { test, expect, type Page } from '@playwright/test'
import { elapse, elapseWindow, installClock, settleRequests } from './helpers/clock'
import { seedLocalBoard, seedNotionBoard, SEED_TASKS, type SeedCarryOver, type SeedTask } from './helpers/seed'
import { openTaskMenu } from './helpers/taskMenu'

/** Local date key, same format as utils/carryOver.ts (the browser runs on this machine). */
const dayKey = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Counted through today, so the board load does not add another day. */
const carried = (days: number, keptAtDays: number | null = null): SeedCarryOver =>
  ({ firstOn: dayKey(-days), days, lastOn: dayKey(), keptAtDays })

const CARRY_OVER = {
  'seed-open-1': carried(5),
  'seed-open-2': carried(2),
  'seed-waiting-1': carried(5),
}

const card = (page: Page, id: string) => page.locator(`.task[data-task-id="${id}"]`)
const dots = (page: Page, id: string) => card(page, id).getByTestId('carry-over-dots')
/** The delete answers in the card's own slot (#422): a gap with "Im Papierkorb" and the undo pill */
const deleteGap = (page: Page) => page.locator('.task-gap')

test.describe('Carried-over cue (#99), local tasks', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, SEED_TASKS, CARRY_OVER)
  })

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`shows one dot per carried day at ${viewport.width}px, none for a fresh card`, async ({ page, baseURL }) => {
      await page.setViewportSize(viewport)
      await page.goto(`${baseURL}/tasks`)

      await expect(dots(page, 'seed-open-1').locator('.carry-over-dot')).toHaveCount(6)
      await expect(dots(page, 'seed-open-1')).toHaveAttribute('aria-label', 'An 6 Tagen eingeplant')
      await expect(dots(page, 'seed-open-2').locator('.carry-over-dot')).toHaveCount(3)
      // Fresh in this run (no seed entry) and Done cards: no dots
      await expect(dots(page, 'seed-progress-1')).toHaveCount(0)
      await expect(dots(page, 'seed-done-1')).toHaveCount(0)
      // The card keeps its fixed height on desktop
      if (viewport.width > 767) {
        await expect.poll(async () => (await card(page, 'seed-open-1').boundingBox())?.height).toBe(132)
      }
    })
  }

  test('the dots show the meaning on hover and are not a tab stop (kd#27)', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks`)
    await expect(dots(page, 'seed-open-2')).not.toHaveAttribute('tabindex', /.*/)
    await dots(page, 'seed-open-2').hover()
    await expect(page.getByRole('tooltip')).toContainText('An 3 Tagen eingeplant')
  })

  test('the sheet asks one question past 4 days; Keep turns it into a confirmation and leaves the dots (#247)', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks/seed-open-1`)
    const triage = page.getByTestId('carry-over-triage')
    await expect(triage).toContainText('Die Aufgabe ist seit 6 Tagen zur Erledigung eingeplant. Ist sie wirklich wichtig?')
    await expect(triage.getByRole('button')).toHaveText(['Ja, behalten', 'Nein, löschen'])

    await triage.getByTestId('carry-over-keep').click()
    await expect(triage.getByRole('status')).toContainText('Die Aufgabe bleibt auf deinem Board')
    await expect(triage.getByRole('status')).toContainText('Tipp: Plane zunächst den kleinstmöglichen, ersten Schritt.')
    await expect(triage.getByRole('button')).toHaveCount(0)
    await expect(page.getByTestId('carry-over-line')).toContainText('An 6 Tagen eingeplant')
    await expect(page.locator('[data-testid="task-detail-header"] [role="button"]').first()).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dots(page, 'seed-open-1').locator('.carry-over-dot')).toHaveCount(6)
  })

  test('Wartet cards get the line but never the nudge', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks/seed-waiting-1`)
    await expect(page.getByTestId('carry-over-line')).toContainText('An 6 Tagen eingeplant')
    await expect(page.getByTestId('carry-over-triage')).toHaveCount(0)
  })

  test('Make smaller (from the closing step, ?smaller=1) focuses the title field with the first-step hint', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks/seed-open-1?smaller=1`)
    const titleInput = page.locator('[data-testid="task-detail-header"] input')
    await expect(titleInput).toBeFocused()
    await expect(page.getByTestId('carry-over-smaller-hint')).toHaveText('Was ist der erste kleine Schritt?')

    await titleInput.fill('Gliederung skizzieren')
    await titleInput.press('Enter')
    await expect(page.getByTestId('carry-over-triage')).toHaveCount(0)
  })

  test('Delete turns the card into a gap; Undo brings it back with its dots', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks/seed-open-1`)
    await page.getByTestId('carry-over-delete').click()
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(card(page, 'seed-open-1')).toHaveCount(0)

    await deleteGap(page).getByRole('button', { name: /Rückgängig/ }).click()
    await expect(dots(page, 'seed-open-1').locator('.carry-over-dot')).toHaveCount(6)
  })
})

/** `page-1` is an open ("Today") task in tests/fixtures/notion/tasks.json, so the stub fetch keeps it. */
const NOTION_TASK: SeedTask = {
  id: 'page-1', title: 'Fokusaufgabe vorbereiten', status: 0, priority: 0,
  timeSpentSeconds: 3600, timeBoxSeconds: 5400, custom: {},
}

test.describe('Carried-over cue (#99), Notion stub: deferred upstream delete', () => {
  test.beforeEach(async ({ context }) => {
    await installClock(context) // the undo window runs on the page clock (#543)
    await seedNotionBoard(
      context,
      [NOTION_TASK],
      { databaseId: 'db-123', dataSourceId: 'ds-123' },
      { 'page-1': carried(5) },
    )
  })

  test('names the upstream consequence and archives the page only after the undo window', async ({ page, baseURL }) => {
    const archiveCalls: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/notion/archive-page')) archiveCalls.push(req.postData() ?? '')
    })

    await page.goto(`${baseURL}/tasks/page-1`)
    const del = await openTaskMenu(page, 'Löschen, auch in Notion')
    await del.click()

    await expect(deleteGap(page)).toContainText('Im Papierkorb')
    await elapse(page, 1500)
    expect(archiveCalls).toHaveLength(0)

    await elapseWindow(page)
    await expect.poll(() => archiveCalls.length).toBe(1)
    expect(archiveCalls[0]).toContain('page-1')
  })

  test('Undo never reaches Notion', async ({ page, baseURL }) => {
    const archiveCalls: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/notion/archive-page')) archiveCalls.push(req.url())
    })

    await page.goto(`${baseURL}/tasks/page-1`)
    await page.getByTestId('carry-over-delete').click()
    await deleteGap(page).getByRole('button', { name: /Rückgängig/ }).click()
    await expect(card(page, 'page-1')).toHaveCount(1)
    await elapseWindow(page)
    await settleRequests(page) // the first test is the positive control: there the archive call arrives
    expect(archiveCalls).toHaveLength(0)
  })
})

test.describe('A task that is not planned for today (#353)', () => {
  const OFF: SeedTask = {
    id: 'seed-off-1', title: 'Angebot Dachfenster', status: 0, priority: 2, timeSpentSeconds: 900, timeBoxSeconds: 1800,
    topic: 'Baustelle Müller', notes: 'Maße fehlen noch', custom: {}, notPlanned: true,
  }
  const OFF_COUNT: SeedCarryOver = { firstOn: dayKey(-6), days: 3, lastOn: dayKey(-2), keptAtDays: null }
  const openIds = SEED_TASKS.filter(task => task.status === 0).map(task => task.id)
  const storedTasks = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tasks-store') ?? '{}'))

  test('is in no column, keeps the other cards in place and is still held after a reload, with its count', async ({ page, context, baseURL }) => {
    // the not-planned task sits between the seeded cards: the board must look as if it were not there
    const tasks = [SEED_TASKS[0]!, OFF, ...SEED_TASKS.slice(1)]
    await seedLocalBoard(context, tasks, { ...CARRY_OVER, [OFF.id]: OFF_COUNT }, undefined, { once: true })

    for (const pass of ['first load', 'after a reload']) {
      if (pass === 'first load') await page.goto(`${baseURL}/tasks`)
      else await page.reload()
      await expect(card(page, 'seed-open-1')).toBeVisible()
      await expect(card(page, OFF.id), pass).toHaveCount(0)
      await expect(page.getByText(OFF.title), pass).toHaveCount(0)
      const offen = page.locator('.column[data-status="open"] .task[data-task-id]')
      await expect.poll(() => offen.evaluateAll(cards => cards.map(el => el.getAttribute('data-task-id'))), pass).toEqual(openIds)

      // the board load counted today for the cards on the board (a write), and left this task and its count alone
      await expect.poll(async () => (await storedTasks(page)).carryOverByTaskId?.['seed-progress-1']?.lastOn, pass).toBe(dayKey())
      const stored = await storedTasks(page)
      expect(stored.tasks.find((task: SeedTask) => task.id === OFF.id), pass)
        .toMatchObject({ notPlanned: true, status: 0, timeSpentSeconds: 900, timeBoxSeconds: 1800, topic: 'Baustelle Müller', notes: 'Maße fehlen noch', source: 'local' })
      expect(stored.carryOverByTaskId[OFF.id], pass).toEqual(OFF_COUNT)
    }
    // the seeded column order still named it: reconciling took it out of Offen's order
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('board-store') ?? '{}').columns?.find((column: { taskStatus: number }) => column.taskStatus === 0)?.taskOrder ?? null))
      .toEqual(openIds)
  })
})
