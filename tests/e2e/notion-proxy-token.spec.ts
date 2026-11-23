import { test, expect, type Page } from '@playwright/test'
import { seedNotionBoard } from './helpers/seed'

/**
 * The Notion proxy takes the token only in `Authorization: Bearer` (#503): no request URL carries it (URLs end up
 * in server logs), and one normal board session stays at a handful of requests. The public instance has no Notion
 * proxy since #742 (local-only; its Worker answers `/api/notion/*` with 404, unit-tested in `worker/`); the proxy runs
 * in dev and the E2E build, which this suite serves.
 */

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)
const TITLE = 'Fokusaufgabe vorbereiten' // page-1 in tests/fixtures/notion/tasks.json (Today → Offen)

test('a Notion session sends the token in a header only, and uses a fraction of the rate limit', async ({ context, page, baseURL }) => {
  const token = `notion_test_stub:${crypto.randomUUID()}`
  await seedNotionBoard(context, [], { token })

  const requests: Array<{ method: string, url: string, authorization: string | undefined }> = []
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.startsWith('/api/notion/')) {
      requests.push({ method: req.method(), url: req.url(), authorization: req.headers()['authorization'] })
    }
  })

  await page.goto(`${baseURL}/tasks`)
  await expect(column(page, 'open').getByText(TITLE)).toBeVisible()

  const readBack = page.waitForResponse((res) => res.url().includes('/api/notion/pages?pageId=page-1'))
  await page.locator('.task-wrapper', { hasText: TITLE }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Status ändern' }).click()
  await page.getByRole('menuitem', { name: 'Warten', exact: true }).click()
  await readBack
  await expect(column(page, 'waiting').getByText(TITLE)).toBeVisible()

  await page.reload()
  await expect(column(page, 'waiting').getByText(TITLE)).toBeVisible()

  expect(requests.length).toBeGreaterThan(0)
  for (const { url, authorization } of requests) {
    expect(url).not.toMatch(/token=/i)
    expect(url).not.toContain(token)
    expect(authorization).toBe(`Bearer ${token}`)
  }
  // Measured: 12 (a load is 5-6 requests, a status move 2). The limit is 120 per minute, so a regression that makes the client
  // chatty (a loop, a poll) shows here long before real users meet a 429.
  expect(requests.length).toBeLessThan(30)
})
