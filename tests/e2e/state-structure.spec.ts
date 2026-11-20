import { expect, test, type Page, type Route } from '@playwright/test'
import { fillerTasks, MIXED_SEED_TASKS, newDayBackTasks, seedAfterMidnight, seedLocalBoard, seedMixedBoard, seedNewDayBoard, SEED_TASKS, type SeedTask } from './helpers/seed'
import { goToPlace, openDayClose, openMore, openSettings } from './helpers/appNav'
import { pinClock, pinnedNow } from './helpers/clock'
import { settleAnimations } from './helpers/settle'
import { installTauriStub } from './helpers/tauriStub'
import { dayKeyDaysAhead, REMINDERS_SEED_LISTS, remindersSeedReminders, seedRemindersBoard } from './helpers/seed'

/**
 * Structure of the empty, loading and error states and of the open task sheet, as Playwright ARIA snapshots
 * (`toMatchAriaSnapshot`, files in `snapshots/state-structure.spec.ts/*.aria.yml`): roles, accessible names, states
 * and copy, without pixels. The default UI acceptance criterion "Empty, loading and error states handled"
 * (`.claude/issue-workflow.md`) gets evidence that a later change cannot silently drop, and the visual-regression
 * shots stay free to change the look.
 *
 * Each snapshot is scoped to the region of the state (a column, the Mehr panel, the sheet), so a change elsewhere
 * does not touch it. An intended change: `npm run test:e2e -- tests/e2e/state-structure.spec.ts --update-snapshots`,
 * then read the `.aria.yml` diff like copy and a11y review (it is the screen reader's view of the state).
 */

const MOBILE = { width: 390, height: 844 }

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(page.locator('#column-open')).toBeVisible()
  await settleAnimations(page)
}

test.describe('empty states', () => {
  test('empty board: every column with its empty state (1280)', async ({ context, page }) => {
    await seedLocalBoard(context, [])
    await gotoBoard(page)
    await expect(page.locator('main')).toMatchAriaSnapshot({ name: 'empty-board-1280.aria.yml' })
  })

  test('empty board: the Offen page (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedLocalBoard(context, [])
    await gotoBoard(page)
    await expect(page.locator('#column-open')).toMatchAriaSnapshot({ name: 'empty-board-open-390.aria.yml' })
  })
})

test.describe('the place "Alle" (#354)', () => {
  async function gotoAll(page: Page) {
    await page.goto('/all')
    await expect(page.locator('.board')).toHaveAttribute('data-place', 'all')
    await expect(page.locator('#column-open')).toBeVisible()
    await settleAnimations(page)
  }

  test('empty "Meine Aufgaben": everything is planned, and how a task gets here (1280)', async ({ context, page }) => {
    await seedLocalBoard(context)
    await gotoAll(page)
    await expect(page.getByTestId('not-planned')).toMatchAriaSnapshot({ name: 'not-planned-empty-1280.aria.yml' })
  })

  test('"Meine Aufgaben" with tasks: each card a named group with its pick button (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    const held: SeedTask[] = SEED_TASKS.filter(task => task.status === 0).map(task => ({ ...task, notPlanned: true as const }))
    await seedLocalBoard(context, [...held, ...SEED_TASKS.filter(task => task.status !== 0)])
    await gotoAll(page)
    await expect(page.getByTestId('not-planned')).toMatchAriaSnapshot({ name: 'not-planned-tasks-390.aria.yml' })
  })

  test('"Meine Aufgaben" with the add card open (#567): the add button is off, the card is a group above the cards (1280)', async ({ context, page }) => {
    const held: SeedTask[] = SEED_TASKS.filter(task => task.status === 0).slice(0, 2).map(task => ({ ...task, notPlanned: true as const }))
    await seedLocalBoard(context, [...held, ...SEED_TASKS.filter(task => task.status !== 0)])
    await gotoAll(page)
    await page.getByTestId('not-planned-add').click()
    await expect(page.getByTestId('new-card-title')).toBeFocused()
    await settleAnimations(page)
    await expect(page.getByTestId('not-planned')).toMatchAriaSnapshot({ name: 'not-planned-add-card-1280.aria.yml' })
  })
})

test.describe('a new day (#356, #387)', () => {
  // No done task: no recap opens, the board shows as it was left and the notice offers the fresh start
  const board = () => newDayBackTasks().filter(task => task.status !== 3)
  const startFresh = async (page: Page) => {
    await page.getByTestId('new-day-note-start').click()
    await expect(page).toHaveURL(/\/all$/)
    await expect(page.getByTestId('not-planned-group-others')).toBeVisible()
    await settleAnimations(page)
  }

  test('"Meine Aufgaben" after the fresh start: the panel "Gestern auf dem Board" (a labelled group) and "Weitere Aufgaben", each a heading with its list (1280)', async ({ context, page }) => {
    await seedNewDayBoard(context, { tasks: board() })
    await page.goto('/all')
    await startFresh(page)
    await expect(page.getByTestId('not-planned')).toMatchAriaSnapshot({ name: 'not-planned-new-day-groups-1280.aria.yml' })
  })

  test('"Meine Aufgaben" after the fresh start: the panel is one named group on a phone (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedNewDayBoard(context, { tasks: board() })
    await gotoBoard(page)
    await startFresh(page)
    await expect(page.getByTestId('not-planned')).toMatchAriaSnapshot({ name: 'not-planned-new-day-groups-390.aria.yml' })
  })

  test('an empty Offen on Heute says how many tasks of yesterday wait under "Alle", with a link (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedNewDayBoard(context, { tasks: board() })
    await gotoBoard(page)
    await startFresh(page)
    await goToPlace(page, 'Heute')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByTestId('open-yesterday-note')).toBeVisible()
    await settleAnimations(page)
    await expect(page.locator('#column-open')).toMatchAriaSnapshot({ name: 'open-yesterday-note-390.aria.yml' })
  })

  test('the notice of a day that was not started fresh: a status with its two actions (1280)', async ({ context, page }) => {
    await seedNewDayBoard(context, { tasks: board() })
    await gotoBoard(page)
    await expect(page.getByTestId('new-day-note')).toMatchAriaSnapshot({ name: 'new-day-note-1280.aria.yml' })
  })

  test('the notice of a day that was not started fresh (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedNewDayBoard(context, { tasks: board() })
    await page.goto('/tasks')
    await expect(page.getByTestId('new-day-note')).toMatchAriaSnapshot({ name: 'new-day-note-390.aria.yml' })
  })

  test('the question about time after midnight: a status with the task, the stretch and its two actions (1280)', async ({ context, page }) => {
    await seedNewDayBoard(context, { tasks: board() })
    await seedAfterMidnight(context, { taskId: 'nd-now-1', seconds: 4500 })
    await gotoBoard(page)
    await expect(page.getByTestId('new-day-time-note')).toMatchAriaSnapshot({ name: 'new-day-time-note-1280.aria.yml' })
  })
})

test.describe('Apple Reminders: the hint on a card (#553)', () => {
  test('a reminder dated today is on today\'s board with its hint: an image named by the sentence (1280)', async ({ context, page }) => {
    await seedRemindersBoard(context, {
      reminders: [{ id: 'r-today', listId: 'list-home', title: 'Heute fällig', due: { date: dayKeyDaysAhead(0), time: '08:00' } }],
    })
    await gotoBoard(page)
    await expect(page.getByTestId('task-reminders-hint')).toBeVisible()
    await expect(page.locator('#column-open')).toMatchAriaSnapshot({ name: 'reminders-hint-open-1280.aria.yml' })
  })
})

test.describe('Statistik task table pager (#604)', () => {
  test('30 done tasks: the first 25 rows, the count line and "Mehr anzeigen" (1280)', async ({ context, page }) => {
    await seedLocalBoard(context)
    await context.addInitScript(() => {
      const records = Array.from({ length: 30 }, (_, i) => ({
        taskId: `pg-${i}`,
        title: `Aufgabe ${String(i).padStart(2, '0')}`,
        completedAt: new Date(2026, 10, 1 + (i % 15), 10, i).toISOString(),
        timeBoxSeconds: 1800,
        actualTimeSpentSeconds: 1800,
        estimationAccuracy: 100,
        topic: 'Büro',
        topicColorCode: null,
        activity: 'Büro',
        isUnplanned: false,
      }))
      localStorage.setItem('taskStatistics', JSON.stringify({ completionRecords: records }))
    })
    await page.goto('/statistics')
    const list = page.getByTestId('stats-all-tasks')
    await list.getByText(/Alle erledigten Aufgaben/).click()
    await expect(page.getByTestId('stats-table-more')).toBeVisible()
    await expect(page.getByTestId('stats-table-shown').locator('..')).toMatchAriaSnapshot({ name: 'statistics-table-pager-1280.aria.yml' })
  })
})

test.describe('Offen add button (#248)', () => {
  test('the header button at rest and while a draft is open: named, then disabled in place (1280)', async ({ context, page }) => {
    await seedLocalBoard(context)
    await gotoBoard(page)
    const header = page.locator('#column-open .column-header')
    await expect(header).toMatchAriaSnapshot({ name: 'add-button-rest-1280.aria.yml' })
    await header.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()
    await expect(page.getByTestId('new-card-title')).toBeFocused()
    await settleAnimations(page)
    await expect(header).toMatchAriaSnapshot({ name: 'add-button-draft-open-1280.aria.yml' })
  })
})

test.describe('loading state', () => {
  test('sync in progress: the Mehr panel while Notion has not answered', async ({ context, page }) => {
    await seedMixedBoard(context)
    await gotoBoard(page)
    await expect(page.locator('#column-open-list').getByText('Fokusaufgabe vorbereiten')).toBeVisible()

    // Hold every Notion request until the snapshot is taken, so the sync stays in flight.
    const held: Route[] = []
    await page.route('**/api/notion/**', route => { held.push(route) })
    const panel = await openMore(page)
    await panel.getByTestId('more-sync').click()
    await expect.poll(() => held.length).toBeGreaterThan(0)
    await expect(panel).toMatchAriaSnapshot({ name: 'sync-loading-more-panel.aria.yml' })

    await page.unroute('**/api/notion/**')
    for (const route of held) await route.continue().catch(() => {})
  })
})

test.describe('board menu: stacking (kd#178)', () => {
  test('the group-by options are choice chips and the picked one is pressed (1280)', async ({ context, page }) => {
    await seedLocalBoard(context)
    await gotoBoard(page)
    const panel = await openMore(page)
    await panel.getByTestId('more-stack').click()
    const group = panel.getByRole('group', { name: 'Gruppieren nach' })
    await expect(group).toBeVisible()
    await expect(group).toMatchAriaSnapshot({ name: 'more-panel-group-by-1280.aria.yml' })
  })
})

test.describe('topic focus (#161)', () => {
  const NOW = new Date().toISOString()
  const withTopic = (task: SeedTask, topic: string): SeedTask => ({ ...task, topic, updatedAt: NOW })
  const tasks = SEED_TASKS.map((task, i) => withTopic(task, i % 2 === 0 ? 'Baustelle' : 'Büro'))

  test('the funnel at rest and with the chip row open (1280)', async ({ context, page }) => {
    await seedLocalBoard(context, tasks)
    await gotoBoard(page)
    await expect(page.getByTestId('focus-trigger')).toMatchAriaSnapshot({ name: 'focus-trigger-rest-1280.aria.yml' })
    await page.getByTestId('focus-trigger').click()
    await expect(page.getByTestId('focus-bar')).toMatchAriaSnapshot({ name: 'focus-chips-1280.aria.yml' })
  })

  test('a focus is on: the pill and the funnel that ends it (1280)', async ({ context, page }) => {
    await seedLocalBoard(context, tasks)
    await gotoBoard(page)
    await page.getByTestId('focus-trigger').click()
    await page.getByTestId('focus-chip').first().click()
    await expect(page.getByTestId('focus-bar')).toMatchAriaSnapshot({ name: 'focus-pill-1280.aria.yml' })
    await expect(page.getByTestId('focus-trigger')).toMatchAriaSnapshot({ name: 'focus-trigger-active-1280.aria.yml' })
  })
})

test.describe('swap on the running card (#162)', () => {
  test('a keyboard drag over the running card announces the swap (1280)', async ({ context, page }) => {
    await seedLocalBoard(context)
    await gotoBoard(page)
    await page.locator('.task-wrapper[data-task-id="seed-open-1"]').focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    const live = page.locator('body > [aria-live]')
    await expect(live).toContainText('Beim Ablegen wechseln beide')
    await expect(live).toMatchAriaSnapshot({ name: 'swap-announcement-1280.aria.yml' })
    await page.keyboard.press('Escape')
  })
})

test.describe('error states', () => {
  test('Notion unreachable: the Mehr panel names the problem', async ({ context, page }) => {
    await seedMixedBoard(context)
    await gotoBoard(page)
    await expect(page.locator('#column-open-list').getByText('Fokusaufgabe vorbereiten')).toBeVisible()

    await page.route('**/api/notion/**', route => route.abort('connectionrefused'))
    const panel = await openMore(page)
    await panel.getByTestId('more-sync').click()
    await expect(panel.getByTestId('sync-problem-notion')).toBeVisible()
    await expect(panel).toMatchAriaSnapshot({ name: 'sync-offline-more-panel.aria.yml' })
  })

  test('Notion rejects the database (404): the source is broken and the panel offers the repair', async ({ context, page }) => {
    await seedMixedBoard(context, undefined, { notionConfig: { token: `notion_test_stub:fail=404:${crypto.randomUUID()}` } })
    const rejected = page.waitForResponse(res => res.url().includes('/api/notion/') && res.status() === 404)
    await page.goto('/tasks')
    await rejected
    const panel = await openMore(page)
    await expect(panel.getByTestId('sync-problem-notion')).toBeVisible()
    await expect(panel).toMatchAriaSnapshot({ name: 'sync-broken-more-panel.aria.yml' })
  })
})

test.describe('sync question (#369)', () => {
  const notionExtras = (): SeedTask[] => fillerTasks(30).map((task) => ({ ...task, title: `Notion-Altlast ${task.title}`, source: 'notion', externalId: task.id }))

  test('a sync that returns far less than the board holds: the question with nothing chosen (1280)', async ({ context, page }) => {
    await seedMixedBoard(context, [...MIXED_SEED_TASKS, ...notionExtras()])
    await page.goto('/tasks')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await settleAnimations(page)
    await expect(dialog).toMatchAriaSnapshot({ name: 'sync-question-1280.aria.yml' })
  })

  test('the same question after an answer: the footer button follows it (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedMixedBoard(context, [...MIXED_SEED_TASKS, ...notionExtras()])
    await page.goto('/tasks')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Nein oder nicht sicher/ }).click()
    await settleAnimations(page)
    await expect(dialog).toMatchAriaSnapshot({ name: 'sync-question-answered-390.aria.yml' })
  })
})

test.describe('welcome page (kd#14)', () => {
  test('first run: wordmark, tagline, statement, "Jetzt starten" and the sample start (1280)', async ({ page }) => {
    await page.goto('/welcome')
    await expect(page.getByTestId('welcome-choice-local')).toBeVisible()
    await expect(page.locator('main')).toMatchAriaSnapshot({ name: 'welcome-1280.aria.yml' })
  })

  test('the photo fails to load: the same structure on the paper colour', async ({ page }) => {
    await page.route('**/welcome/*.webp', route => route.abort('failed'))
    await page.goto('/welcome')
    await expect(page.getByTestId('welcome-choice-local')).toBeVisible()
    await expect(page.getByTestId('welcome-photo')).toHaveCSS('opacity', '0')
    await expect(page.locator('main')).toMatchAriaSnapshot({ name: 'welcome-1280.aria.yml' })
  })
})

test.describe('welcome setup on the page (#43)', () => {
  test('Notion: first step with the guide rail (1280)', async ({ page }) => {
    await page.goto('/welcome')
    await page.getByTestId('welcome-choice-local').click()
    await page.getByTestId('local-source-notion').click()
    await page.getByTestId('local-confirm').click()
    await expect(page.getByRole('group', { name: 'Vorbereitung' })).toBeFocused()
    await expect(page.getByTestId('notion-setup-flow')).toMatchAriaSnapshot({ name: 'welcome-notion-first-step-1280.aria.yml' })
  })

  test('Notion: the database step with the fact badges (1280, #649)', async ({ page }) => {
    await page.goto('/welcome')
    await page.getByTestId('welcome-choice-local').click()
    await page.getByTestId('local-source-notion').click()
    await page.getByTestId('local-confirm').click()
    const flow = page.getByTestId('notion-setup-flow')
    await page.getByTestId('wizard-proceed').click() // the intro
    await flow.getByPlaceholder('Integrationstoken eingeben').fill('notion_test_stub')
    await page.getByTestId('wizard-proceed').click()
    await expect(flow.getByRole('group', { name: 'Datenbank', exact: true })).toBeFocused()
    await expect(flow.getByRole('combobox')).toBeVisible()
    await expect(flow).toMatchAriaSnapshot({ name: 'welcome-notion-database-1280.aria.yml' })
  })

  test('Local: step 2 with the source checklist (1280, #294)', async ({ page }) => {
    await page.goto('/welcome')
    await page.getByTestId('welcome-choice-local').click()
    await expect(page.getByTestId('local-confirm')).toBeVisible()
    await expect(page.getByTestId('local-setup-flow')).toMatchAriaSnapshot({ name: 'welcome-local-1280.aria.yml' })
  })

  test('Samples: step 2 with the reset note and "Board ansehen" (1280, #236)', async ({ page }) => {
    await page.goto('/welcome')
    await page.getByTestId('welcome-choice-samples').click()
    await expect(page.getByRole('heading', { name: 'Beispielaufgaben' })).toBeFocused()
    await expect(page.getByTestId('samples-setup-flow')).toMatchAriaSnapshot({ name: 'welcome-samples-1280.aria.yml' })
  })
})

test.describe('Apple Reminders setup and settings (#552)', () => {
  const remindersStub = (status: 'notDetermined' | 'granted' | 'denied', answer: 'granted' | 'denied' = 'granted') => ({
    reminders: { status, answer, lists: REMINDERS_SEED_LISTS, reminders: remindersSeedReminders() },
  })
  async function openSetup(page: Page) {
    await page.goto('/welcome')
    await page.getByTestId('welcome-choice-local').click()
    await page.getByTestId('local-source-reminders').click()
    await page.getByTestId('local-confirm').click()
    await expect(page.getByTestId('setup-pane')).toBeFocused()
  }

  test('access step before the prompt: announcement, preview and facts (1280)', async ({ context, page }) => {
    await installTauriStub(context, remindersStub('notDetermined'))
    await openSetup(page)
    await expect(page.getByTestId('reminders-setup-flow')).toMatchAriaSnapshot({ name: 'reminders-access-1280.aria.yml' })
  })

  test('access denied: the way to allow it (1280)', async ({ context, page }) => {
    await installTauriStub(context, remindersStub('notDetermined', 'denied'))
    await openSetup(page)
    await page.getByTestId('reminders-proceed').click()
    await expect(page.getByTestId('reminders-denied')).toBeVisible()
    await expect(page.getByTestId('reminders-setup-flow')).toMatchAriaSnapshot({ name: 'reminders-denied-1280.aria.yml' })
  })

  test('lists step: one radio group per list, an Aus list, then every list Aus (1280)', async ({ context, page }) => {
    await installTauriStub(context, remindersStub('granted'))
    await openSetup(page)
    await page.getByTestId('reminders-proceed').click()
    await expect(page.getByTestId('reminders-lists-step')).toBeVisible()
    await page.getByTestId('reminders-role-list-private-off').click()
    await expect(page.getByTestId('reminders-lists-step')).toMatchAriaSnapshot({ name: 'reminders-lists-1280.aria.yml' })
    await page.getByTestId('reminders-role-list-home-off').click()
    await page.getByTestId('reminders-role-list-work-off').click()
    await expect(page.getByTestId('reminders-lists-empty')).toBeVisible()
    await expect(page.getByTestId('reminders-setup-flow')).toMatchAriaSnapshot({ name: 'reminders-lists-empty-1280.aria.yml' })
  })

  test('today step: the four-row table and the write line (1280)', async ({ context, page }) => {
    await installTauriStub(context, remindersStub('granted'))
    await openSetup(page)
    await page.getByTestId('reminders-proceed').click()
    await page.getByTestId('reminders-proceed').click()
    await expect(page.getByTestId('reminders-today-rules')).toBeVisible()
    await expect(page.getByTestId('reminders-setup-flow')).toMatchAriaSnapshot({ name: 'reminders-today-1280.aria.yml' })
  })

  test('settings page with the question before a list leaves (1280)', async ({ context, page }) => {
    await seedRemindersBoard(context)
    // From the board, so the tasks of the list are loaded and the question has counts
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list').getByText('Milch kaufen')).toBeVisible()
    await openSettings(page, 'sources')
    await page.getByTestId('source-actions-reminders').click()
    await page.getByRole('menuitem', { name: 'Erinnerungen-Einstellungen' }).click()
    await page.getByTestId('reminders-role-list-home-off').click()
    await expect(page.getByTestId('reminders-exclude-confirm')).toBeVisible()
    await settleAnimations(page)
    await expect(page.getByTestId('reminders-settings')).toMatchAriaSnapshot({ name: 'reminders-settings-exclude-1280.aria.yml' })
  })

  test('settings page, access revoked: the denied panel with the repair (1280)', async ({ context, page }) => {
    await seedRemindersBoard(context, { status: 'denied' })
    await page.goto('/settings/reminders')
    await expect(page.getByTestId('reminders-access-denied')).toBeVisible()
    await expect(page.getByTestId('reminders-section-access')).toMatchAriaSnapshot({ name: 'reminders-settings-denied-1280.aria.yml' })
  })
})

test.describe('task sheet', () => {
  test('open from the board (1280)', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto(`/tasks/${SEED_TASKS[0]!.id}`)
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await settleAnimations(page)
    await expect(sheet).toMatchAriaSnapshot({ name: 'task-sheet-1280.aria.yml' })
  })

  test('open as a drawer (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedLocalBoard(context)
    await page.goto(`/tasks/${SEED_TASKS[0]!.id}`)
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await settleAnimations(page)
    await expect(sheet).toMatchAriaSnapshot({ name: 'task-sheet-390.aria.yml' })
  })
})

test.describe('task sheet: time spent row (kd#4)', () => {
  // A waiting task (no timer ticks): 30 of 60 min, with a Timebox
  const WAITING_WITH_TIME: SeedTask = {
    id: 'time-edit-1', title: 'Wartende Aufgabe', status: 2, priority: 1, activity: null, topic: null, topicColorCode: null,
    timeSpentSeconds: 1800, timeBoxSeconds: 3600, custom: {},
  }
  const timeSpentRow = (page: Page) => page.getByTestId('task-property-row').filter({ hasText: 'Aufgewendete Zeit' })

  test('time and time left beside it (1280)', async ({ context, page }) => {
    await seedLocalBoard(context, [WAITING_WITH_TIME], {}, undefined, { once: true })
    await page.goto('/tasks/time-edit-1')
    await expect(timeSpentRow(page)).toBeVisible()
    await settleAnimations(page)
    await expect(timeSpentRow(page)).toMatchAriaSnapshot({ name: 'time-spent-row-1280.aria.yml' })
  })

  test('the minutes field is open (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedLocalBoard(context, [WAITING_WITH_TIME], {}, undefined, { once: true })
    await page.goto('/tasks/time-edit-1')
    await timeSpentRow(page).getByRole('button', { name: /^Aufgewendete Zeit: / }).click()
    await expect(page.getByTestId('time-spent-edit-input')).toBeVisible()
    await settleAnimations(page)
    await expect(timeSpentRow(page)).toMatchAriaSnapshot({ name: 'time-spent-row-edit-390.aria.yml' })
  })
})

test.describe('add-task sheet validation (#662)', () => {
  test('empty-title submit: the title is invalid and described by its error (1280)', async ({ context, page }) => {
    await seedLocalBoard(context, [])
    await page.goto('/tasks/add')
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Aufgabe erstellen' }).click()
    await expect(sheet.getByTestId('add-task-title-error')).toBeVisible()
    await settleAnimations(page)
    await expect(sheet).toMatchAriaSnapshot({ name: 'add-task-title-error-1280.aria.yml' })
  })
})

test.describe('guided new card (#649)', () => {
  test('title step, the Thema combobox (list, a new value, a chosen value), and the Notiz step (1280)', async ({ context, page }) => {
    await seedLocalBoard(context, [
      ...SEED_TASKS,
      { ...SEED_TASKS[0]!, id: 'ncf-extra', title: 'Weitere', topic: 'Büro', activity: 'Abstimmung', status: 2 },
      // a fourth topic, so the combobox list holds several entries (kd#16, #434)
      { ...SEED_TASKS[0]!, id: 'ncf-extra-2', title: 'Noch eine', topic: 'Vertrieb', activity: 'Telefonat', status: 2 },
    ])
    await gotoBoard(page)
    await page.locator('#column-open [data-testid="add-task-header-button"]').click()
    const card = page.getByTestId('new-card-flow')
    await expect(page.getByTestId('new-card-title')).toBeFocused()
    await settleAnimations(page)
    await expect(card).toMatchAriaSnapshot({ name: 'new-card-title-1280.aria.yml' })

    await page.getByTestId('new-card-title').fill('Angebot schreiben')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('new-card-step')).toHaveAttribute('data-step', 'topic')
    await settleAnimations(page)
    await expect(card).toMatchAriaSnapshot({ name: 'new-card-topic-1280.aria.yml' })

    // the list opens with the field and is portalled out of the card
    const list = page.getByRole('listbox')
    await expect(list.getByRole('option', { name: 'Vertrieb' })).toBeVisible()
    await expect(list).toMatchAriaSnapshot({ name: 'new-card-all-options-1280.aria.yml' })
    // typing a name no value has: the "Neu" row (kd#16)
    await page.getByTestId('new-card-combo').fill('Gartenpflege')
    await expect(list.getByRole('option', { name: /Neu:/ })).toBeVisible()
    await expect(list).toMatchAriaSnapshot({ name: 'new-card-search-new-1280.aria.yml' })
    // a chosen value: back on the step it shows in the field, with the clear button (#434)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('new-card-step')).toHaveAttribute('data-step', 'activity')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('new-card-step')).toHaveAttribute('data-step', 'topic')
    await expect(page.getByTestId('new-card-combo')).toHaveValue('Gartenpflege')
    await settleAnimations(page)
    await expect(card).toMatchAriaSnapshot({ name: 'new-card-topic-value-1280.aria.yml' })

    await page.getByTestId('new-card-step').focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('Enter')
    await expect(page.getByTestId('new-card-notes')).toBeFocused()
    await settleAnimations(page)
    await expect(card).toMatchAriaSnapshot({ name: 'new-card-notes-1280.aria.yml' })
  })

  test('the Notiz step at 390 (drawer for all options, no key cues)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedLocalBoard(context, [])
    await gotoBoard(page)
    await page.locator('#column-open [data-testid="add-task-header-button"]').click()
    await page.getByTestId('new-card-title').fill('Erste Aufgabe')
    await page.keyboard.press('Enter')
    // an empty board has no topics or activities: Timebox comes first, with the full list behind the third pill
    await expect(page.getByTestId('new-card-step')).toHaveAttribute('data-step', 'timebox')
    await settleAnimations(page)
    await expect(page.getByTestId('new-card-flow')).toMatchAriaSnapshot({ name: 'new-card-timebox-390.aria.yml' })
  })
})

test.describe('new-day recap (#44)', () => {
  const recap = (page: Page) => page.getByTestId('new-day-recap')

  test('stage on the photo with both decks (1280)', async ({ context, page }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await settleAnimations(page)
    await expect(recap(page)).toMatchAriaSnapshot({ name: 'recap-stage-1280.aria.yml' })
  })

  test('stage with the deck switcher (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await settleAnimations(page)
    await expect(recap(page)).toMatchAriaSnapshot({ name: 'recap-stage-390.aria.yml' })
  })

  test('nothing open: the stage shows only the done deck, no switcher (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedNewDayBoard(context, { allDone: true })
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await settleAnimations(page)
    await expect(recap(page)).toMatchAriaSnapshot({ name: 'recap-stage-all-done-390.aria.yml' })
  })
})

test.describe('day close stage (#237, #480)', () => {
  const stage = (page: Page) => page.getByTestId('day-close-stage')
  /** Fixed data on the pinned day, so the date, the counts and the facts read the same on every run. */
  const doneAt = () => new Date(pinnedNow().getTime() - 3_600_000).toISOString()
  const task = (id: string, title: string, status: SeedTask['status'], extra: Partial<SeedTask> = {}): SeedTask =>
    ({ id, title, status, priority: 2, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, ...extra })
  const DONE: SeedTask[] = [
    task('dc-1', 'Angebot schreiben', 3, { topic: 'Angebote', timeSpentSeconds: 4500, timeBoxSeconds: 3600, completedAt: doneAt() }),
    task('dc-2', 'Steuerunterlagen sortieren', 3, { topic: 'Steuern', timeSpentSeconds: 2700, timeBoxSeconds: 3600, completedAt: doneAt() }),
    task('dc-6', 'Rückfrage beantwortet', 3, { completedAt: doneAt() }),
  ]
  const OPEN: SeedTask[] = [
    task('dc-3', 'Konzept ausarbeiten', 0),
    task('dc-4', 'Review schreiben', 1, { timeSpentSeconds: 1800, timeBoxSeconds: 3600 }),
    task('dc-5', 'Blocker klären', 2),
  ]

  test('both charts and the consequence line (1280)', async ({ context, page }) => {
    await pinClock(context) // the stage shows today's date
    await seedLocalBoard(context, [...DONE, ...OPEN])
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(stage(page)).toBeVisible()
    await settleAnimations(page)
    await expect(stage(page)).toMatchAriaSnapshot({ name: 'day-close-stage-1280.aria.yml' })
  })

  test('both charts and the stacked buttons (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await pinClock(context)
    await seedLocalBoard(context, [...DONE, ...OPEN])
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(stage(page)).toBeVisible()
    await settleAnimations(page)
    await expect(stage(page)).toMatchAriaSnapshot({ name: 'day-close-stage-390.aria.yml' })
  })

  test('nothing left open: the trophy headline, no Themen chart, the second sentence only (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await pinClock(context)
    await seedLocalBoard(context, DONE.filter(done => !done.topic))
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(stage(page)).toBeVisible()
    await settleAnimations(page)
    await expect(stage(page)).toMatchAriaSnapshot({ name: 'day-close-all-done-390.aria.yml' })
  })

  test('nothing done and nothing open: the one quiet line (1280)', async ({ context, page }) => {
    await pinClock(context)
    await seedLocalBoard(context, [])
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(stage(page)).toBeVisible()
    await settleAnimations(page)
    await expect(stage(page)).toMatchAriaSnapshot({ name: 'day-close-empty-1280.aria.yml' })
  })
})

// Live copy editor (#59): a dev-only tool that the E2E build carries (KANDO_COPY_EDITOR=1). Its dev routes are mocked.
test.describe('live copy editor (#59)', () => {
  // The shortcut hints are platform glyphs (Nuxt UI's UKbd reads `Macintosh;` from the user agent: "⌥" there, "Alt" elsewhere);
  // the snapshots record the macOS spelling, so the editor specs pin a macOS user agent and read the same on a Linux runner (#100).
  test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' })

  async function openEditor(context: Parameters<typeof seedLocalBoard>[0], page: Page) {
    await seedLocalBoard(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open')).toBeVisible()
    await page.keyboard.press('Control+k')
    await page.keyboard.type('Edit UI copy')
    await page.getByRole('option', { name: /Edit UI copy: text selection mode/ }).click()
  }

  test('the mode bar (1280)', async ({ context, page }) => {
    await openEditor(context, page)
    await expect(page.getByRole('region', { name: 'UI copy editor' })).toMatchAriaSnapshot({ name: 'copy-editor-bar-1280.aria.yml' })
  })

  test('the editor pane: one language written, the other left to the agent (1280)', async ({ context, page }) => {
    await openEditor(context, page)
    await page.getByText('Offen', { exact: true }).first().click()
    await expect(page.getByTestId('copy-editor-form')).toMatchAriaSnapshot({ name: 'copy-editor-editor-1280.aria.yml' })
  })

  test('Publish: empty state, then the translation failing keeps the edit (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await page.route('**/api/dev/copy/translate', route => route.fulfill({ status: 502, json: { ok: false, errors: ['the agent did not answer within 180 s'] } }))
    await openEditor(context, page)
    await page.getByTestId('copy-editor-publish').click()
    await expect(page.getByTestId('copy-editor-publish-view')).toMatchAriaSnapshot({ name: 'copy-editor-publish-empty-390.aria.yml' })

    await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
    await page.getByTestId('copy-editor-search-list').getByRole('option').first().click()
    await page.getByTestId('copy-editor-text').fill('Zurück zur Liste')
    await page.getByTestId('copy-editor-save').click()
    await page.getByTestId('copy-editor-tab-publish').click()
    await page.getByTestId('copy-editor-translate').click()
    await expect(page.getByTestId('copy-editor-error')).toBeVisible()
    await expect(page.getByTestId('copy-editor-publish-view')).toMatchAriaSnapshot({ name: 'copy-editor-publish-error-390.aria.yml' })
  })
})

test.describe('the floating Now window (#383)', () => {
  const snapshot = { taskId: 'seed-1', title: 'Release notes schreiben', timeBoxSeconds: 1500, spentSeconds: 860, running: false, locale: 'de' }

  async function openPill(context: Parameters<typeof installTauriStub>[0], page: Page, extra: Record<string, unknown> = {}) {
    await installTauriStub(context, {})
    await context.addInitScript((value) => {
      ;(window as unknown as { __overlaySnapshot: unknown }).__overlaySnapshot = { ...value, at: Date.now() }
    }, { ...snapshot, ...extra })
    await page.goto('/overlay')
    await expect(page.getByTestId('now-pill')).toBeVisible()
  }

  test('paused pill with a timebox: title, time, and the resume and done buttons', async ({ context, page }) => {
    await openPill(context, page)
    await expect(page.getByTestId('now-pill')).toMatchAriaSnapshot({ name: 'now-window-paused.aria.yml' })
  })

  test('running pill without a timebox: the title and the time passed', async ({ context, page }) => {
    await openPill(context, page, { timeBoxSeconds: null, running: true })
    await expect(page.getByTestId('now-pill')).toMatchAriaSnapshot({ name: 'now-window-no-timebox.aria.yml' })
  })

  test('the setting row on the desktop Board tab', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context, {})
    await page.goto('/settings')
    await expect(page.getByTestId('floating-now-setting')).toBeVisible()
    await expect(page.getByTestId('focus-settings')).toMatchAriaSnapshot({ name: 'settings-board-desktop.aria.yml' })
  })
})
