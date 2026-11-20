import { test, expect } from '@playwright/test'
import { seedLocalBoard, seedNotionBoard } from './helpers/seed'
import { installTauriStub } from './helpers/tauriStub'
import { openSettings } from './helpers/appNav'

/** #242, #324: the "GitHub-Zugriff" link row on the Speicherorte page (desktop only); /settings/notion has none (#429). */

const link = (page: import('@playwright/test').Page) => page.getByRole('link', { name: /GitHub-Zugriff/ })

test.describe('GitHub-Zugriff entry point', () => {
  test('web: neither the System tab nor /settings/notion shows the link', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/tasks')
    await openSettings(page, 'manage')
    await expect(page.getByTestId('settings-subpage-link').first()).toBeVisible()
    await expect(link(page)).toHaveCount(0)
  })

  test('desktop, local mode: the System tab ends with the link to /settings/github', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context)
    await page.goto('/tasks')
    await openSettings(page, 'manage')
    await expect(page.getByText('Token für Updates')).toBeVisible()
    await link(page).click()
    await expect(page).toHaveURL(/\/settings\/github$/)
    await expect(page.getByRole('heading', { name: 'GitHub-Zugriff' })).toBeVisible()
  })

  test('desktop: the System rows are hairline-divided like the connection rows (#683)', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context)
    await page.goto('/tasks')
    await openSettings(page, 'manage')
    const rows = page.getByTestId('settings-subpages').locator('li')
    await expect(rows).toHaveCount(4) // Themen, Daten, Updates, GitHub
    const borderBottom = (i: number) => rows.nth(i).evaluate(node => getComputedStyle(node).borderBottomWidth)
    expect(await borderBottom(0)).toBe('1px')
    expect(await borderBottom(3)).toBe('0px')
  })

  test('desktop, Notion mode: /settings/notion has no GitHub link (#429)', async ({ context, page }) => {
    await seedNotionBoard(context)
    await installTauriStub(context)
    await page.goto('/settings/notion')
    await expect(page.getByPlaceholder('ntn_...')).toBeVisible() // the settled connection tab
    await expect(link(page)).toHaveCount(0)
  })

  test('web: /settings/notion has no link', async ({ context, page }) => {
    await seedNotionBoard(context)
    await page.goto('/settings/notion')
    await expect(page.getByRole('heading', { name: /Notion/ }).first()).toBeVisible()
    await expect(link(page)).toHaveCount(0)
  })
})
