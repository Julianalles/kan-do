import { test, expect } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { openAddSheet } from './helpers/addSheet'
import { chooseInMore, openMore, openSettings } from './helpers/appNav'
import { showColumnPage } from './helpers/dnd'
import { undersizedControls, type HitAreaException } from './helpers/hitArea'
import { seedLocalBoard, seedNotionBoard, SEED_TASKS } from './helpers/seed'

/**
 * Sweep guard 103 (#592): every visible control on the seeded screens, at 390 px, has a 44 x 44 hit area. The class
 * ratchets (`tests/config/button-ladder.test.ts`) read classes and let 23 controls through (a 33 px chip, a 16 px
 * checkbox, a 17 px link); this spec measures what the finger meets, a pseudo-element hit area and a tappable label
 * row included (`helpers/hitArea.ts`).
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

/** What stays below the floor on purpose, each with its reason. A new entry needs one. */
const EXCEPTIONS: HitAreaException[] = [
  {
    selector: '[data-testid="notion-setup-flow"] a[href="https://www.notion.so/my-integrations"]',
    reason: 'a link inside a sentence ("Öffne … um eine neue Integration zu erstellen"): WCAG 2.5.8 exempts it, padding around an inline box is covered by the field above it, and the copy is not this issue',
  },
]

/** Each screen seeds a Local board unless it names its own start (the welcome flow has no board, the Notion pages need the stub). */
const SCREENS: Array<{ name: string, seed?: (context: BrowserContext) => Promise<void>, start?: string, within?: string, run: (page: Page) => Promise<void> }> = [
  {
    name: 'the board, each column page',
    run: async (page) => {
      for (const index of [0, 1, 2] as const) {
        await showColumnPage(page, index)
        const small = await undersizedControls(page, { exceptions: EXCEPTIONS })
        if (process.env.HIT_SURVEY) console.log(`SURVEY column ${index}: ${JSON.stringify(small)}`)
        else expect(small, `column page ${index}`).toEqual([])
      }
    },
  },
  {
    name: 'the Mehr panel',
    run: async (page) => {
      await openMore(page)
    },
  },
  {
    name: 'the add sheet',
    run: async (page) => {
      await openAddSheet(page)
    },
  },
  {
    name: 'the add sheet with its title error',
    run: async (page) => {
      await openAddSheet(page)
      await page.getByPlaceholder('Aufgabe benennen…').fill('')
      await page.keyboard.press('Enter')
    },
  },
  {
    name: 'the task sheet',
    run: async (page) => {
      await page.goto('/tasks/seed-open-1')
      await expect(page.getByRole('button', { name: /Titel/ })).toBeVisible()
    },
  },
  {
    name: 'the task sheet with its title edited and Metadaten open',
    run: async (page) => {
      await page.goto('/tasks/seed-open-1')
      await page.getByRole('button', { name: /Metadaten/i }).click()
      await page.getByRole('button', { name: /Titel/ }).click()
    },
  },
  {
    name: 'the in-card add flow, second step',
    within: '[data-testid="new-card-flow"]',
    run: async (page) => {
      await showColumnPage(page, 0)
      await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).first().click()
      await page.getByTestId('new-card-title').fill('Phone check')
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('new-card-step')).toBeVisible()
    },
  },
  {
    name: 'Einstellungen, each tab',
    run: async (page) => {
      await openSettings(page)
      for (const tab of ['board', 'sources', 'manage'] as const) {
        await openSettings(page, tab)
        const small = await undersizedControls(page, { exceptions: EXCEPTIONS })
        if (process.env.HIT_SURVEY) console.log(`SURVEY settings ${tab}: ${JSON.stringify(small)}`)
        else expect(small, `settings ${tab}`).toEqual([])
      }
    },
  },
  {
    name: 'Themen und Aktivitäten with a topic editor open',
    run: async (page) => {
      await page.goto('/settings/topics')
      await page.getByTestId('topics-row-button').first().click()
      await expect(page.getByTestId('topic-editor')).toBeVisible()
    },
  },
  {
    name: 'the welcome flow, local step with the services offered',
    seed: async () => {},
    start: '/welcome',
    run: async (page) => {
      await page.getByRole('button', { name: 'Jetzt starten' }).click()
      await expect(page.getByRole('checkbox', { name: 'Notion' })).toBeVisible()
    },
  },
  {
    name: 'the welcome flow, Notion token step',
    seed: async () => {},
    start: '/welcome',
    run: async (page) => {
      await page.getByRole('button', { name: 'Jetzt starten' }).click()
      await page.getByRole('checkbox', { name: 'Notion' }).click()
      await page.getByRole('button', { name: 'Mit Notion einrichten' }).click()
      await page.getByTestId('wizard-proceed').click()
      await expect(page.getByPlaceholder('Integrationstoken eingeben')).toBeVisible()
    },
  },
  {
    name: 'the Notion settings page',
    seed: (context) => seedNotionBoard(context, SEED_TASKS),
    start: '/settings/notion',
    run: async (page) => {
      await expect(page.getByRole('tabpanel')).toBeVisible()
    },
  },
  {
    name: 'Papierkorb',
    run: async (page) => {
      await chooseInMore(page, 'trash')
    },
  },
  {
    name: 'Statistik',
    run: async (page) => {
      await page.goto('/statistics')
    },
  },
]

for (const screen of SCREENS) {
  test(`phone floor: ${screen.name}`, async ({ context, page }) => {
    await (screen.seed ?? ((ctx) => seedLocalBoard(ctx, SEED_TASKS)))(context)
    await page.goto(screen.start ?? '/tasks')
    if (!screen.start) await expect(page.locator('.board .task').first()).toBeVisible()
    await screen.run(page)
    await page.waitForTimeout(400)
    const small = await undersizedControls(page, { exceptions: EXCEPTIONS, within: screen.within })
    if (process.env.HIT_SURVEY) console.log(`SURVEY ${screen.name}: ${JSON.stringify(small)}`)
    else expect(small).toEqual([])
  })
}
