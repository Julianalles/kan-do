import { test, expect, type Page } from '@playwright/test'
import { seedMixedBoard, fillerTasks, MIXED_SEED_TASKS, type SeedTask } from './helpers/seed'

/**
 * The sync warning (#337, per source in #318): when a source returns far fewer tasks than the board holds
 * for it, a dialog names the source and asks what happened (#369) while the fetch waits. "Nein oder nicht sicher"
 * and every close keep the board, "Ja, das habe ich so gemacht" applies the result. Local tasks never take part. The Notion stub returns its four
 * fixture pages, so 30 extra Notion tasks on the board make a drop of 88%.
 */

const NOTION_EXTRAS: SeedTask[] = fillerTasks(30).map((task) => ({ ...task, title: `Notion-Altlast ${task.title}`, source: 'notion', externalId: task.id }))

const storedTasks = (page: Page) => page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: Array<{ id: string; source: string }> }
  return raw.tasks ?? []
})

test.describe('Sync warning per source (#337, #318, #369)', () => {
  test('a Notion drop opens the question, naming Notion; nothing is chosen and the footer waits', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, [...MIXED_SEED_TASKS, ...NOTION_EXTRAS])
    await page.goto(`${baseURL}/tasks`)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Kurz prüfen')).toBeVisible()
    await expect(dialog.getByText('Notion hat kaum etwas geliefert (4 von 34 Aufgaben)')).toBeVisible()
    await expect(dialog.getByText('Bisher wurde nichts geändert.')).toBeVisible()
    await expect(dialog.getByRole('radio', { name: /Ja, das habe ich so gemacht/ })).not.toBeChecked()
    await expect(dialog.getByRole('radio', { name: /Nein oder nicht sicher/ })).not.toBeChecked()
    await expect(dialog.getByTestId('sync-warning-submit')).toBeDisabled()
  })

  test('"Notion öffnen" points at the database and leaves the question open', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, [...MIXED_SEED_TASKS, ...NOTION_EXTRAS])
    await page.goto(`${baseURL}/tasks`)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const link = dialog.getByRole('link', { name: 'Notion öffnen' })
    await expect(link).toHaveAttribute('href', 'https://www.notion.so/db123')
    const popup = page.waitForEvent('popup')
    await link.click()
    await (await popup).close()
    await expect(dialog).toBeVisible()
  })

  test('"Nein oder nicht sicher" keeps the Notion tasks and the Local tasks on the board', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, [...MIXED_SEED_TASKS, ...NOTION_EXTRAS])
    await page.goto(`${baseURL}/tasks`)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('radio', { name: /Nein oder nicht sicher/ }).click()
    await dialog.getByRole('button', { name: 'Board behalten' }).click()
    await expect(dialog).toBeHidden()

    const tasks = await storedTasks(page)
    expect(tasks.filter((task) => task.source === 'notion')).toHaveLength(34)
    expect(tasks.filter((task) => task.source === 'local')).toHaveLength(3)
  })

  test('Esc keeps the board like "Board behalten"', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, [...MIXED_SEED_TASKS, ...NOTION_EXTRAS])
    await page.goto(`${baseURL}/tasks`)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect((await storedTasks(page)).filter((task) => task.source === 'notion')).toHaveLength(34)
  })

  test('"Ja, das habe ich so gemacht" resumes the fetch: the Notion tasks follow the source, Local stays', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, [...MIXED_SEED_TASKS, ...NOTION_EXTRAS])
    await page.goto(`${baseURL}/tasks`)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('radio', { name: /Ja, das habe ich so gemacht/ }).click()
    await dialog.getByRole('button', { name: 'Änderung übernehmen' }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(async () => (await storedTasks(page)).filter((task) => task.source === 'notion').length).toBe(4)
    expect((await storedTasks(page)).filter((task) => task.source === 'local')).toHaveLength(3)
  })

  test('many Local tasks never raise the warning', async ({ context, page, baseURL }) => {
    const localExtras: SeedTask[] = fillerTasks(30).map((task) => ({ ...task, source: 'local', externalId: null }))
    await seedMixedBoard(context, [...MIXED_SEED_TASKS, ...localExtras])
    const notionFetch = page.waitForResponse((res) => res.url().includes('/api/notion/query-data-source'))
    await page.goto(`${baseURL}/tasks`)
    await notionFetch

    await expect(page.locator('#column-open-list').getByText('Fokusaufgabe vorbereiten')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})
