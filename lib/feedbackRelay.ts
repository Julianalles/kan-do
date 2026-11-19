/**
 * @module feedbackRelay
 * @description The one network call of the feedback relay path (#268, ADR 010 "Amendment: relay"): posts a
 * report to the app's own server route, which files it in the private feedback repository. No token, no
 * cookie and no GitHub host is involved here; the GitHub feedback code (`lib/feedback/`, `useFeedback.ts`)
 * still never calls `fetch` itself and reaches GitHub through Rust only.
 * @responsibility
 * - Maps every outcome to one of a few results; never throws, never retries
 * - `unavailable`: there is no relay behind the URL (404, 405, 501, a non-JSON 201: static host, fork) or it
 *   says it has no token (503 with the relay's own `FEEDBACK_NOT_CONFIGURED` body). The caller falls back to
 *   the browser path for the session.
 * - Any other 503 (a Cloudflare platform error page, a gateway) is a `server` error: retryable, the relay
 *   route stays (#559). So is every other status not named here (401, 403, 408, 410, 421, 3xx: an edge WAF
 *   or challenge, #572); a 2xx other than a JSON 201 is a static host's shell and `unavailable`.
 */
export interface RelayReport {
  title: string
  body: string
  screenshot?: { path: string, content: string }
}

export type RelayResult = 'sent' | 'offline' | 'blocked' | 'server' | 'unavailable' | 'invalid'

const TIMEOUT_MS = 30000
/** Largest PNG the relay takes (decoded bytes); the same number as `SCREENSHOT_MAX_BYTES` on the server. */
export const RELAY_IMAGE_MAX_BYTES = 3 * 1024 * 1024

export async function sendToRelay(url: string, report: RelayReport): Promise<RelayResult> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      credentials: 'omit',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  }
  catch {
    return 'offline'
  }
  if (response.status === 201) {
    // A static host can answer a POST with its HTML shell: only the relay's own JSON counts as sent.
    const answer = await response.json().catch(() => null) as { ok?: unknown } | null
    return answer?.ok === true ? 'sent' : 'unavailable'
  }
  if (response.status === 429) return 'blocked'
  if (response.status === 400 || response.status === 413) return 'invalid'
  if (response.status === 503) {
    // Only the relay's own JSON answer means "no token here"; a platform error page is a transient failure.
    const answer = await response.json().catch(() => null) as { data?: { error?: unknown } | null } | null
    return answer?.data?.error === 'FEEDBACK_NOT_CONFIGURED' ? 'unavailable' : 'server'
  }
  // Only a status that says "nothing answers here" switches to the browser path. Every other unnamed status
  // (401/403/408/410/421, a 3xx, any 5xx but 501: an edge WAF or challenge, a timeout) is transient: retryable (#572).
  if (response.status === 404 || response.status === 405 || response.status === 501) return 'unavailable'
  if (response.status >= 200 && response.status < 300) return 'unavailable'
  return 'server'
}
