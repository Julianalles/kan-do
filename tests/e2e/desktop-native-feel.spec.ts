import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'
import { installTauriStub } from './helpers/tauriStub'

/**
 * #370: the desktop app feels native. Control labels are not selectable text, content and fields still are, and the
 * browser's context menu is gone (except in text fields). The Tauri stub makes `isTauri()` true, the production build
 * makes `import.meta.dev` false: the same conditions as the installed app.
 */

const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? '')

/** Dispatches a right click; resolves to whether the app cancelled the browser's menu. */
const contextMenuCancelled = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)!
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    return event.defaultPrevented
  }, selector)

test.describe('Native feel (desktop)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
    await installTauriStub(context, {})
  })

  test('a double click on a control label selects nothing, content on a page stays selectable', async ({ page }) => {
    await page.goto('/settings/data')
    await expect(page.locator('html')).toHaveAttribute('data-shell', 'desktop')
    const heading = page.getByRole('heading', { name: 'Datenordner', level: 2 })
    await expect(heading).toBeVisible()

    const button = page.getByTestId('data-folder-change')
    await button.dblclick()
    expect(await selectedText(page)).toBe('')

    await heading.dblclick()
    expect(await selectedText(page)).toBe('')

    const path = page.getByTestId('data-folder-path')
    await path.dblclick()
    expect((await selectedText(page)).length).toBeGreaterThan(0)
  })

  test('a text field keeps selecting and editing', async ({ page }) => {
    await page.goto('/tasks/add')
    const title = page.getByRole('textbox').first()
    await title.fill('Kopierbarer Text')
    await title.selectText()
    expect(await title.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart!, el.selectionEnd!))).toBe('Kopierbarer Text')
  })

  test('no browser context menu on a label, but the native one in a text field', async ({ page }) => {
    await page.goto('/settings/data')
    await expect(page.getByRole('heading', { name: 'Datenordner', level: 2 })).toBeVisible()
    expect(await contextMenuCancelled(page, '[data-testid="data-folder-change"]')).toBe(true)
    expect(await contextMenuCancelled(page, 'body')).toBe(true)

    await page.goto('/tasks/add')
    await expect(page.getByRole('textbox').first()).toBeVisible()
    expect(await contextMenuCancelled(page, 'input[type="text"], input:not([type]), textarea')).toBe(false)
  })
})

test.describe('Native feel (web)', () => {
  test('the web app keeps the browser selection and context menu', async ({ page, context }) => {
    await seedLocalBoard(context)
    await page.goto('/settings')
    await expect(page.locator('html')).not.toHaveAttribute('data-shell', 'desktop')
    expect(await contextMenuCancelled(page, 'body')).toBe(false)
  })
})
