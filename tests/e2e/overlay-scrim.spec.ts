/**
 * E2E: overlay scrim (issue #127). Every modal and drawer overlay darkens the page by the shared
 * `--overlay-scrim`, the task sheet included (#419): its overlay covers the whole viewport on "Alle", Heute and Statistik.
 */
import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'

const overlay = (page: Page) => page.locator('[data-slot="overlay"]:visible')

/** Rasterises the computed overlay colour (any CSS colour syntax) to straight sRGB + alpha. */
const scrim = (page: Page) =>
  overlay(page).evaluate((el) => {
    const css = getComputedStyle(el).backgroundColor
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data as unknown as number[]
    return { css, alpha: a! / 255, luma: (0.299 * r! + 0.587 * g! + 0.114 * b!) / 255 }
  })

/** Waits out the fade-in (200ms) by polling the computed alpha into the scrim band, then checks the colour is dark. */
const expectScrim = async (page: Page) => {
  await expect.poll(async () => (await scrim(page)).alpha, { message: 'overlay alpha reaches the scrim band' }).toBeGreaterThan(0.1)
  const { alpha, luma, css } = await scrim(page)
  expect(css, 'overlay must not be transparent').not.toBe('rgba(0, 0, 0, 0)')
  expect(luma, 'overlay must be dark, not light').toBeLessThan(0.2)
  expect(alpha).toBeLessThan(0.2) // --overlay-scrim: the shadow colour at 17 %
}

test.beforeEach(async ({ context }) => {
  await seedLocalBoard(context)
})

for (const viewport of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('command palette overlay uses the same scrim', async ({ page }) => {
      await page.goto('/tasks')
      await page.locator('.task-wrapper').first().focus()
      await page.keyboard.press('ControlOrMeta+k')
      await expect(page.getByRole('dialog', { name: 'Befehlspalette' })).toBeVisible()
      await expect(overlay(page)).toHaveCount(1)
      await expectScrim(page)
    })

    for (const path of ['/tasks/seed-open-1', '/all/seed-open-1', '/tasks/add', '/all/add']) {
      test(`task sheet overlay on ${path} is the scrim over the whole viewport`, async ({ page }) => {
        await page.goto(path)
        await expect(page.getByRole('dialog')).toBeVisible()
        await expect(overlay(page)).toHaveCount(1)
        await expectScrim(page)
        const box = await overlay(page).evaluate((el) => {
          const r = el.getBoundingClientRect()
          return { x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight }
        })
        expect(box).toMatchObject({ x: 0, y: 0 })
        expect(box.w).toBe(box.vw)
        expect(box.h).toBe(box.vh)
      })
    }
  })
}

/** Browser bar tint (#554): the mobile drawer sets `theme-color` to the sheet white while open; the desktop modal never does. */
test.describe('theme-color while a drawer is open (#554)', () => {
  const themeColor = (page: Page) => page.locator('meta[name="theme-color"]')

  test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the drawer sets the white theme-color and closing removes it', async ({ page }) => {
      await page.goto('/tasks')
      await expect(page.locator('.task-wrapper').first()).toBeVisible()
      await expect(themeColor(page)).toHaveCount(0)
      await page.goto('/tasks/seed-open-1')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(themeColor(page)).toHaveAttribute('content', 'rgb(255, 255, 255)')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
      await expect(themeColor(page)).toHaveCount(0)
    })
  })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 800 } })

    test('the modal sets no theme-color', async ({ page }) => {
      await page.goto('/tasks/seed-open-1')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(themeColor(page)).toHaveCount(0)
    })
  })
})
