/**
 * E2E: no layout shift from the document scrollbar (issue #580). An open overlay (card context menu,
 * command palette, dialog, task sheet) locks the page scroll, which removes a classic scrollbar. Nothing on
 * the page may move horizontally for that: not the board, and not the elements outside the body flow
 * (fixed toasts, the titlebar): they subtract `--scrollbar-width` (assets/css/utilities.css).
 *
 * Headless Chromium hides scrollbars by default (overlay-like, width 0), which would pass without the fix:
 * this spec launches with classic ones and asserts that the scrollbar is really there first. A macOS host with
 * "Show scroll bars: Automatically" and only a trackpad makes Chromium use overlay scrollbars even then (#612),
 * so the page also gets a `::-webkit-scrollbar` style: a styled scrollbar is always classic and takes width.
 * With a classic bar the page also reserves its gutter (#669, `kando-classic-scrollbar`): the lock then removes nothing
 * and the same zero-shift holds, which is what these cases assert.
 */
import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, fillerTasks, SEED_TASKS } from './helpers/seed'
import { openDayClose } from './helpers/appNav'
import { showColumnPage } from './helpers/dnd'
import { settleSheet } from './helpers/settle'
import { forceClassicScrollbar, tagElements, boxes, moved, documentScrollbar } from './helpers/layoutShift'

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

// The task sheet re-centres the app bar's group in the space left of it (#290, a slide over `--sheet-fade-duration`): that
// shift is the design, not a scrollbar shift, and whether it has started when the dialog shows is a race. The bar's own
// box (`.app-nav`, `.titlebar`) stays checked, which is where a scrollbar shift shows.
// Day close (phone only): it hides the topic focus funnel (#608), and on a phone the app bar's group shares its centre with the funnel (#381), so it re-centres when the funnel goes: by design. Desktop keeps the centre and the group stays checked.
const openers: Array<{ name: string, ignore?: string | ((width: number) => string | undefined), open: (page: Page) => Promise<void> }> = [
  {
    name: 'card context menu',
    open: async (page) => {
      await page.locator('.task-wrapper').first().click({ button: 'right' })
      await expect(page.getByRole('menu')).toBeVisible()
    },
  },
  {
    name: 'command palette',
    open: async (page) => {
      await page.locator('.task-wrapper').first().focus()
      await page.keyboard.press('ControlOrMeta+k')
      await expect(page.getByRole('dialog', { name: 'Befehlspalette' })).toBeVisible()
    },
  },
  {
    name: 'day-close stage',
    ignore: width => (width <= 767 ? '.app-nav-group' : undefined),
    open: async (page) => {
      await openDayClose(page)
      await expect(page.getByRole('region', { name: 'Tag abschließen' })).toBeVisible()
    },
  },
  {
    name: 'task sheet',
    ignore: '.app-nav-group',
    open: async (page) => {
      await page.locator('.task-wrapper').first().focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('dialog')).toBeVisible()
      // The desktop sheet grows out of its card (#705): a copy of the card's face, which carries the card's probe tags (`cloneNode`),
      // scales from 288 to 500 px for 340 ms, and `boxes` would read that copy instead of the board card. Measure at rest, where the lock stays in place and a scrollbar shift stays visible: the face is gone then.
      if ((page.viewportSize()?.width ?? 0) > 767) await settleSheet(page)
    },
  },
]

test.beforeEach(async ({ context }) => {
  await seedLocalBoard(context, [...SEED_TASKS, ...fillerTasks(30, 0)])
})

for (const viewport of [{ name: 'desktop', width: 1280, height: 700 }, { name: 'wide', width: 1800, height: 700 }, { name: 'mobile', width: 390, height: 844 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    for (const { name, ignore, open } of openers) {
      test(`${name} moves no element horizontally`, async ({ page }) => {
        await forceClassicScrollbar(page)
        await page.goto('/tasks')
        await expect(page.locator('.task-wrapper').first()).toBeVisible()
        await showColumnPage(page, 0) // the board opens on Jetzt while a task sits there (kd#191)
        // The precondition: a classic scrollbar takes width from the page (not on touch layouts, where the board scrolls inside)
        if (viewport.width > 767) await expect.poll(() => documentScrollbar(page), { message: 'the document has a classic scrollbar' }).toBeGreaterThan(0)
        await tagElements(page, typeof ignore === 'function' ? ignore(viewport.width) : ignore)
        const before = await boxes(page)

        await open(page)
        const afterOpen = await boxes(page)
        expect(moved(before, afterOpen)).toEqual([])

        await page.keyboard.press('Escape')
        // The lock is released when `--scrollbar-width` is gone again; the menu and dialogs fade out first
        await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--scrollbar-width'))).toBe('')
        await expect.poll(async () => moved(before, await boxes(page))).toEqual([])
      })
    }
  })
}
