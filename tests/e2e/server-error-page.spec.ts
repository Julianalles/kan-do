import { test, expect } from '@playwright/test'

/**
 * #525: the production build registers `server/error-handler.ts` (it keeps the URL query and the raw error out of the
 * console). It must wrap Nuxt's own error handler, not replace it: a failing document request (a server route opened
 * in the browser) still gets Nuxt's error page, with the `vary` header Nuxt sets, and a JSON request still gets the
 * JSON error. The app is a SPA shell, so an unknown page URL is a 200: the failing server route is the way in.
 * Runs against the production build (`npm run test:e2e`).
 */
test.describe('production error responses (#525)', () => {
  test('a failing server route opened as a page renders Nuxt\'s error page, not raw JSON', async ({ page }) => {
    const response = await page.goto('/api/notion/tasks?databaseId=db-secret-1')
    expect(response?.status()).toBe(400)
    expect(response?.headers()['content-type']).toContain('text/html')
    expect(response?.headers().vary).toContain('accept')
    expect(response?.headers()['content-security-policy'] ?? '').not.toContain("script-src 'none'")
    // Nuxt serialises the error into the page payload: raw Nitro JSON would be a bare document with no payload
    expect(await response?.text()).toContain('__NUXT_DATA__')
  })

  test('the same route asked for JSON still gets the JSON error', async ({ request }) => {
    const response = await request.get('/api/notion/tasks?databaseId=db-secret-1', { headers: { accept: 'application/json' } })
    expect(response.status()).toBe(400)
    expect(response.headers()['content-type']).toContain('application/json')
    expect(await response.json()).toMatchObject({ error: true, statusCode: 400 })
  })
})
