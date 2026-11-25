// Is the feedback relay configured? (#852) `npm run feedback:check [-- <relay url>]`
//
// The relay (`POST /api/feedback`, ADR 010 "Amendment: relay") needs the Worker secret FEEDBACK_GITHUB_TOKEN. Without it
// every client quietly falls back to the GitHub link, so nobody notices until a report does not arrive. This sends the
// relay one empty probe and reads the answer:
//
//   exit 0  configured     400 with an `INVALID_*` code: the relay got past its configuration check and refused the probe
//   exit 1  missing        503 `FEEDBACK_NOT_CONFIGURED`: set the secret on the Worker (the owner's step, never an agent's)
//   exit 2  inconclusive   anything else (network error, timeout, a platform 503, 401, 2xx), after ATTEMPTS tries
//
// The probe body is the constant `{}`. Never send anything that could pass as a report: a valid one is filed as an issue
// in the private feedback repository. Callers: `.github/workflows/feedback-relay-check.yml` (daily) and `wf_deploy_check`
// in `.claude/issue-workflow.sh` (after a merge). Prints one line and never a response body (the workflow log is public).
// Plain Node, no dependency: the workflow runs it without `npm ci`.
import { fileURLToPath } from 'node:url'

export const RELAY_URL_DEFAULT = 'https://kando.julius-wuestefeld.workers.dev/api/feedback'
export const PROBE_BODY = '{}'
export const ATTEMPTS = 3
export const EXIT = { configured: 0, missing: 1, inconclusive: 2 }

/** The relay's own error code (`{ data: { error } }`, as `lib/feedbackRelay.ts` reads it), or null. */
function codeOf(body) {
  const code = body && typeof body === 'object' && body.data && typeof body.data === 'object' ? body.data.error : null
  return typeof code === 'string' && /^[A-Z_]{1,40}$/.test(code) ? code : null
}

/** `configured`, `missing` or `inconclusive` for one answer to the empty probe. `body` is the parsed JSON or null. */
export function classify(status, body) {
  const code = codeOf(body)
  if (status === 503 && code === 'FEEDBACK_NOT_CONFIGURED') return 'missing'
  if (status === 400 && code?.startsWith('INVALID_')) return 'configured'
  return 'inconclusive'
}

/** One probe. A thrown fetch (offline, DNS, timeout) is an inconclusive answer with status 0. */
async function probe(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'kan-do-feedback-relay-check' },
      body: PROBE_BODY,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    })
    const body = await response.json().catch(() => null)
    return { state: classify(response.status, body), status: response.status }
  }
  catch {
    return { state: 'inconclusive', status: 0 }
  }
}

/** Probes until the answer is conclusive, at most `attempts` times. */
export async function checkRelay(url, { fetchImpl = fetch, attempts = ATTEMPTS, pauseMs = 2000 } = {}) {
  let result = { state: 'inconclusive', status: 0 }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    result = await probe(url, fetchImpl)
    if (result.state !== 'inconclusive') break
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, pauseMs))
  }
  return result
}

/** The one line a caller prints. The host only: a relay URL has no secret, but a query would not belong in a public log. */
export function describe(url, { state, status }) {
  const host = URL.canParse(url) ? new URL(url).host : 'invalid url'
  if (state === 'configured') return `feedback relay: configured (${host})`
  if (state === 'missing') return `feedback relay: NOT CONFIGURED (${host} answers 503 FEEDBACK_NOT_CONFIGURED): the Worker secret FEEDBACK_GITHUB_TOKEN is missing or empty`
  return `feedback relay: inconclusive (${host} answered ${status === 0 ? 'nothing' : status} to the empty probe)`
}

async function main() {
  const url = process.argv[2] || process.env.FEEDBACK_RELAY_URL || RELAY_URL_DEFAULT
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
    console.log(describe(url, { state: 'inconclusive', status: 0 }))
    process.exit(EXIT.inconclusive)
  }
  const result = await checkRelay(url)
  console.log(describe(url, result))
  process.exit(EXIT[result.state])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
