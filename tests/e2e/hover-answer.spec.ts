import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, SEED_TASKS } from './helpers/seed'
import { silentPressables, type HoverException } from './helpers/hoverAnswer'

/**
 * Sweep guard 102 (#592): every pressable on the pages below shows the hand cursor and changes its look under the
 * pointer (DESIGN.md "States": Pressable, Hover). The rule was broken four times and fixed in each place (#55, #425,
 * #296, #25); hand-built controls (the raw `<button>` and `role="button"` ones) are where it breaks, and a class name
 * such as `hover:bg-transparent` passes every class-reading check.
 */

test.use({ viewport: { width: 1280, height: 800 } })

/** What does not answer on purpose, each with its reason. A new entry needs one. */
const EXCEPTIONS: HoverException[] = [
  { selector: '[data-testid="app-nav-brand"]', reason: 'the wordmark is already the darkest ink of the bar and a link to Heute: there is no darker step to answer with, and it is not a control of its own (#642)' },
]

const PAGES: Array<{ name: string, run: (page: Page) => Promise<void> }> = [
  { name: 'the board', run: async (page) => { await expect(page.locator('.board .task').first()).toBeVisible() } },
  { name: 'the task sheet', run: async (page) => { await page.goto('/tasks/seed-open-1'); await expect(page.getByTestId('task-metadata')).toBeVisible() } },
  { name: 'Statistik with finished tasks', run: async (page) => { await page.goto('/statistics'); await expect(page.getByTestId('stats-all-tasks').locator('summary')).toBeVisible() } },
  { name: 'the in-card add flow', run: async (page) => { await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).first().click(); await page.getByTestId('new-card-title').fill('Hover check'); await page.keyboard.press('Enter'); await expect(page.getByTestId('new-card-step')).toBeVisible() } },
  { name: 'Themen und Aktivitäten with an editor open', run: async (page) => { await page.goto('/settings/topics'); await page.getByTestId('topics-row-button').first().click(); await expect(page.getByTestId('topic-editor')).toBeVisible() } },
  { name: 'the component catalogue /ui', run: async (page) => { await page.goto('/ui') } },
]

for (const entry of PAGES) {
  test(`hover answer: ${entry.name}`, async ({ context, page }) => {
    await seedLocalBoard(context, SEED_TASKS)
    // One finished task in the statistics, so the page shows its "Alle erledigten Aufgaben" line
    await context.addInitScript(() => {
      if (localStorage.getItem('taskStatistics')) return
      localStorage.setItem('taskStatistics', JSON.stringify({
        completionRecords: [{ taskId: 'hv-done', title: 'Aufgabe erledigt', completedAt: new Date().toISOString(), timeBoxSeconds: 3600, actualTimeSpentSeconds: 3000, estimationAccuracy: 83, topic: 'Wrk', topicColorCode: null, activity: 'Plan', isUnplanned: false }],
      }))
    })
    await page.goto('/tasks')
    await entry.run(page)
    await page.waitForTimeout(500)
    expect(await silentPressables(page, { exceptions: EXCEPTIONS })).toEqual([])
  })
}
