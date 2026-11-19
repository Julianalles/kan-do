import type { Page } from '@playwright/test'

/** What the feedback relay route received (#268). */
export interface RelayReport {
  title: string
  body: string
  screenshot?: { path: string, content: string }
}

/**
 * Answers `POST /api/feedback` in the page, so no spec reaches a real relay (the E2E build posts to its own
 * origin, `nuxt.config.ts`). 201 is the relay's success; 503 is the relay's own `FEEDBACK_NOT_CONFIGURED`
 * ("no relay here"), which sends the dialog to the browser path; `'platform-503'` is a Cloudflare error page
 * (HTML 503), a retryable server error (#559). Returns the reports received so far.
 */
export async function mockFeedbackRelay(page: Page, status: 201 | 429 | 502 | 503 | 'platform-503' = 201): Promise<RelayReport[]> {
  const reports: RelayReport[] = []
  await page.route('**/api/feedback', async (route) => {
    reports.push(route.request().postDataJSON() as RelayReport)
    if (status === 201) await route.fulfill({ status, json: { ok: true } })
    else if (status === 503) await route.fulfill({ status, json: { statusCode: 503, data: { error: 'FEEDBACK_NOT_CONFIGURED' } } })
    else if (status === 'platform-503') await route.fulfill({ status: 503, contentType: 'text/html', body: '<!doctype html><title>Error 1102</title>' })
    else await route.fulfill({ status, json: { data: { error: 'RELAY' } } })
  })
  return reports
}

/** No relay behind the URL: the first send fails over to the browser path ("Auf GitHub öffnen"). */
export async function failOverToBrowserPath(page: Page): Promise<void> {
  await page.getByTestId('feedback-send-relay').click()
  await page.getByTestId('feedback-open-browser').waitFor()
}
