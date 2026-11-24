import { test, expect, type BrowserContext, type Page, type Request } from '@playwright/test'
import stubSchema from '../fixtures/notion/database-schema.json' with { type: 'json' }
import { buildSettingsStore, buildTasksStore, seedNotionBoard, DEFAULT_NOTION_SEED_CONFIG, type SeedTask } from './helpers/seed'
import { goToPlace } from './helpers/appNav'

/**
 * #357: what a connection brings in as "not planned".
 * - Todoist: a task kan-do sees for the first time starts under "Alle Aufgaben". The cards an existing board
 *   already holds stay where they are (#387: the app moves no card by itself). Todoist is mocked at its API (no stub server).
 * - Notion (stub): with a "not planned" status mapped, a put-back writes that status and a plan writes "today";
 *   the settings' Status tab holds the mapping.
 * On Heute the inert `#column-not-planned` is first in the DOM: id selectors throughout.
 */

const NOW = new Date().toISOString()
const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)
const notPlanned = (page: Page) => page.locator('#column-not-planned')
const menuOf = async (page: Page, title: string) => page.locator('.task-wrapper', { hasText: title }).first().click({ button: 'right' })

test.describe('Todoist: a task seen for the first time starts under "Alle Aufgaben" (#357)', () => {
  const todoistTask = (id: string, title: string, status: 0 | 1 | 2 | 3): SeedTask => ({
    id, title, status, source: 'todoist', externalId: id, priority: 2, timeSpentSeconds: 0, timeBoxSeconds: null, topic: null,
    custom: {}, createdAt: NOW, updatedAt: NOW,
  })
  /** A board as an existing Todoist user has it before the update: two cards in Offen, one in Jetzt, one in Wartet */
  const BEFORE: SeedTask[] = [
    todoistTask('t-open-1', 'Angebot schreiben', 0),
    todoistTask('t-open-2', 'Rechnung prüfen', 0),
    todoistTask('t-now', 'Plan zeichnen', 1),
    todoistTask('t-wait', 'Rückruf abwarten', 2),
  ]

  async function seedTodoistBoard(context: BrowserContext, tasks: SeedTask[]) {
    const byStatus = (status: number) => tasks.filter((task) => task.status === status).map((task) => task.id)
    const board = {
      boardConfig: { sources: { connected: ['todoist'], default: 'todoist' }, todoistApiToken: 'e2e-todoist-token' },
      columns: ['open', 'progress', 'waiting', 'done'].map((idClassSuffix, taskStatus) => ({ idClassSuffix, taskStatus, taskOrder: byStatus(taskStatus), taskPositions: {} })),
      grouping: { enabled: false, key: null },
    }
    await context.addInitScript(({ b, t, s }) => {
      if (sessionStorage.getItem('e2e-todoist-seeded')) return
      sessionStorage.setItem('e2e-todoist-seeded', '1')
      localStorage.setItem('board-store', JSON.stringify(b))
      localStorage.setItem('tasks-store', JSON.stringify(t))
      localStorage.setItem('settings-store', JSON.stringify(s))
    }, { b: board, t: buildTasksStore(tasks), s: buildSettingsStore() })
  }

  /** Todoist's API as the SDK calls it: the open tasks in two pages (a cursor), nothing completed today. */
  async function mockTodoist(page: Page, open: Array<{ id: string; content: string }>) {
    const requests: string[] = []
    const sdkTask = ({ id, content }: { id: string; content: string }) => ({
      id, content, description: '', checked: false, priority: 1, labels: [], project_id: 'p1', user_id: 'u1', section_id: null, parent_id: null,
      added_by_uid: 'u1', assigned_by_uid: null, responsible_uid: null, child_order: 1, day_order: 0, is_collapsed: false, is_deleted: false,
      added_at: NOW, updated_at: NOW, completed_at: null, due: null, deadline: null, duration: null, note_count: 0,
    })
    await page.route('https://api.todoist.com/**', async (route) => {
      const url = new URL(route.request().url())
      requests.push(`${route.request().method()} ${url.pathname}${url.search}`)
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      if (url.pathname.endsWith('/tasks') && route.request().method() === 'GET') {
        const half = Math.ceil(open.length / 2)
        return url.searchParams.get('cursor')
          ? json({ results: open.slice(half).map(sdkTask), next_cursor: null })
          : json({ results: open.slice(0, half).map(sdkTask), next_cursor: 'page-2' })
      }
      if (url.pathname.includes('/tasks/completed')) return json({ items: [], next_cursor: null })
      return json({ results: [], next_cursor: null })
    })
    return requests
  }

  const UPSTREAM = [
    { id: 't-open-1', content: 'Angebot schreiben' }, { id: 't-open-2', content: 'Rechnung prüfen' },
    { id: 't-now', content: 'Plan zeichnen' }, { id: 't-wait', content: 'Rückruf abwarten' },
    { id: 't-new', content: 'Neu aus Todoist' },
  ]

  test('existing board: every card stays where it is, only the new task starts under "Alle Aufgaben"; a plan survives the next sync and nothing is written', async ({ context, page }) => {
    await seedTodoistBoard(context, BEFORE)
    const requests = await mockTodoist(page, UPSTREAM)
    await page.goto('/tasks')

    await expect(column(page, 'open').locator('.task-wrapper')).toHaveText([/Angebot schreiben/, /Rechnung prüfen/])
    await expect(column(page, 'progress').getByText('Plan zeichnen')).toBeVisible()
    await expect(column(page, 'waiting').getByText('Rückruf abwarten')).toBeVisible()
    // every page of open tasks was read
    await expect.poll(() => requests.filter((request) => request.startsWith('GET /api/v1/tasks?')).some((request) => request.includes('cursor=page-2'))).toBe(true)

    // under "Alle": only the task from the second page, which kan-do sees for the first time
    await page.goto('/all')
    await expect(notPlanned(page).locator('[data-not-planned-id]')).toHaveText([/Neu aus Todoist/])
    // "Heute" on "Alle" lists everything planned (#797): Offen's own cards, then the Jetzt and the Wartet card with their badges
    const offen = column(page, 'open').locator('.task-wrapper:not([data-today-extra])')
    await expect(offen).toHaveText([/Angebot schreiben/, /Rechnung prüfen/])
    await expect(column(page, 'open').locator('.task-wrapper[data-today-extra]')).toHaveText([/Plan zeichnen.*Jetzt/, /Rückruf abwarten.*Wartet/])

    await notPlanned(page).locator('[data-not-planned-id]', { hasText: 'Neu aus Todoist' }).getByTestId('not-planned-pick').click()
    await expect(offen).toHaveText([/Angebot schreiben/, /Rechnung prüfen/, /Neu aus Todoist/])

    // the next sync (a reload) moves nothing; nothing was written to Todoist
    await page.reload()
    await expect(offen).toHaveText([/Angebot schreiben/, /Rechnung prüfen/, /Neu aus Todoist/])
    await expect(notPlanned(page).locator('[data-not-planned-id]')).toHaveCount(0)
    // "Alle" shows Offen only: Jetzt and Wartet are checked on Heute
    await goToPlace(page, 'Heute')
    await expect(column(page, 'progress').getByText('Plan zeichnen')).toBeVisible()
    await expect(column(page, 'waiting').getByText('Rückruf abwarten')).toBeVisible()
    expect(requests.filter((request) => !request.startsWith('GET '))).toEqual([])
  })

  test('a new connection: every task starts under "Alle Aufgaben"', async ({ context, page }) => {
    await seedTodoistBoard(context, [])
    await mockTodoist(page, UPSTREAM)
    await page.goto('/all')
    await expect(notPlanned(page).locator('[data-not-planned-id]')).toHaveCount(5)
    await expect(column(page, 'open').locator('.task-wrapper')).toHaveCount(0)
  })
})

test.describe('Notion: statuses that mean "not planned" (#357)', () => {
  const TITLE = 'Fokusaufgabe vorbereiten' // page-1 in tests/fixtures/notion/tasks.json (Today → Offen)
  const withMapping = { statusMapping: { ...DEFAULT_NOTION_SEED_CONFIG.statusMapping, notPlanned: ['Backlog', 'Someday'] } }
  const statusWrite = (page: Page) => page.waitForRequest((request: Request) =>
    request.url().includes('/api/notion/update-task') && request.method() === 'PATCH')
  const writtenStatus = (request: Request) => (request.postDataJSON() as { properties: { Status: { select: { name: string } } } }).properties.Status.select.name

  test('"Nicht für heute planen" writes the first mapped status, the arrow writes "today"; both survive a reload', async ({ context, page }) => {
    await seedNotionBoard(context, undefined, withMapping)
    await page.goto('/tasks')
    await expect(column(page, 'open').getByText(TITLE)).toBeVisible()

    const back = statusWrite(page)
    await menuOf(page, TITLE)
    await page.getByRole('menuitem', { name: 'Nicht für heute planen' }).click()
    expect(writtenStatus(await back)).toBe('Backlog')
    await expect(column(page, 'open').getByText(TITLE)).toHaveCount(0)

    // Notion now holds the page as Backlog: the next sync keeps it under "Alle Aufgaben"
    await page.goto('/all')
    await expect(notPlanned(page).getByText(TITLE)).toBeVisible()
    await page.reload()
    await expect(notPlanned(page).getByText(TITLE)).toBeVisible()
    await expect(column(page, 'open').getByText(TITLE)).toHaveCount(0)

    const plan = statusWrite(page)
    await notPlanned(page).locator('[data-not-planned-id]', { hasText: TITLE }).getByTestId('not-planned-pick').click()
    expect(writtenStatus(await plan)).toBe('Today')
    await expect(column(page, 'open').getByText(TITLE)).toBeVisible()
    await page.reload()
    await expect(column(page, 'open').getByText(TITLE)).toBeVisible()
    await expect(notPlanned(page).getByText(TITLE)).toHaveCount(0)
  })

  test('without the mapping "Nicht für heute planen" writes nothing to Notion', async ({ context, page }) => {
    await seedNotionBoard(context)
    await page.goto('/tasks')
    await expect(column(page, 'open').getByText(TITLE)).toBeVisible()
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/notion/') && request.method() !== 'GET' && !request.url().includes('query-data-source')) writes.push(request.url())
    })
    await menuOf(page, TITLE)
    await page.getByRole('menuitem', { name: 'Nicht für heute planen' }).click()
    await expect(column(page, 'open').getByText(TITLE)).toHaveCount(0)
    // without a reload: the seed would put the card back, and Notion still holds it as "Today"
    await page.getByRole('link', { name: 'Alle', exact: true }).click()
    await expect(notPlanned(page).getByText(TITLE)).toBeVisible()
    expect(writes).toEqual([])
  })

  test('settings, tab Status: the field is empty, takes several statuses, and Save stores them', async ({ context, page }) => {
    await seedNotionBoard(context)
    // The stub's database has no properties: serve the fixture schema for the database details
    await page.route('**/api/notion/database?*', async (route) => {
      const url = new URL(route.request().url())
      if (!url.searchParams.get('id')) return route.fallback()
      const response = await route.fetch()
      await route.fulfill({ response, json: { ...(await response.json()), properties: stubSchema } })
    })
    await page.goto('/settings/notion')
    await page.getByRole('tab', { name: 'Status' }).click()
    const field = page.getByTestId('status-map-not-planned')
    await expect(field).toBeVisible()
    await expect(field).toContainText('Status auswählen')
    const save = page.getByRole('tabpanel').getByRole('button', { name: 'Speichern' })
    await expect(save).toBeDisabled()

    await field.click()
    await page.getByRole('option', { name: 'Backlog' }).click()
    await page.getByRole('option', { name: 'Someday' }).click()
    await page.keyboard.press('Escape')
    await expect(field).toContainText('Backlog, Someday')
    await expect(save).toBeEnabled()
    await save.click()
    await expect(save).toBeDisabled()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('notionConfig') ?? '{}').config?.statusMapping?.notPlanned)).toEqual(['Backlog', 'Someday'])

    // a status that is a column already is not offered: only the two free ones
    await field.click()
    await expect(page.getByRole('option')).toHaveText(['Backlog', 'Someday'])
    await page.keyboard.press('Escape')
  })
})
