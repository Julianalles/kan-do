import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { fileReport, parseReport, relayDryRun, relayError, relayTarget, setCorsHeaders } from '~/server/utils/feedbackRelay'
import { logServerError } from '~/server/utils/serverLog'

/**
 * `POST /api/feedback` (#268): files an in-app report as an issue in the private feedback repository.
 * Answers 201 `{ ok: true }` and nothing about the issue: the repository is private.
 *
 * The configuration is checked before the report is read (#852): a deployment without `FEEDBACK_GITHUB_TOKEN` answers
 * 503 `FEEDBACK_NOT_CONFIGURED` to every body, so the empty probe of `scripts/feedback-relay-check.mjs` (`{}`: 400 on a
 * configured relay, never filed) finds a missing secret before a user does. That 503 is thrown on purpose, so the error
 * handler does not log it; the route writes the allow-listed line itself.
 */
export default defineEventHandler(async (event) => {
  setCorsHeaders(event)
  // A prototype preview (FEEDBACK_RELAY=dry-run) has no token and never posts into the private repository.
  const target = relayDryRun() ? null : configuredTarget(event)
  const input: unknown = await readBody(event).catch(() => relayError(400, 'INVALID_REPORT'))
  // Honeypot: a filled `website` field is a bot. It gets the same answer as a real report.
  const trap = (input as { website?: unknown } | null)?.website
  if (typeof trap === 'string' && trap.trim()) {
    setResponseStatus(event, 201)
    return { ok: true }
  }
  const report = parseReport(input)
  if (!target) {
    setResponseStatus(event, 201)
    return { ok: true, dryRun: true }
  }
  await fileReport(report, target)
  setResponseStatus(event, 201)
  return { ok: true }
})

function configuredTarget(event: H3Event): { token: string, repo: string } {
  try {
    return relayTarget()
  }
  catch (error) {
    logServerError(error, event)
    throw error
  }
}
