/**
 * @module copy-editor/routes
 * @description The three dev-only HTTP routes of the live copy editor (#59), registered by `nuxt.config.ts` through
 * `nitro.handlers` only in `nuxt dev` (they are not under `server/api`, so no build scans them in).
 * `POST /api/dev/copy/translate` drafts the other language, `POST /api/dev/copy/publish` starts the publish job (#340)
 * and `POST /api/dev/copy/publish-status` reports its stage and result.
 * @responsibility Wire h3 to the pure flows: request guard, body, repository root, status codes. No logic of its own.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createError, defineEventHandler, getRequestHeaders, readBody, setResponseStatus } from 'h3'
import type { TermEntry } from '../../lib/copy-editor/terms'
import { run } from './exec'
import { checkRequestHeaders } from './guard'
import { readLocaleTrees } from './locales'
import { jobStatus, startPublishJob } from './jobs'
import { publish } from './publish'
import { extractVoiceRules, translate, validateItems, VOICE_RULES_FILE } from './translate'

const root = () => process.cwd()
const readTerms = () => JSON.parse(readFileSync(join(root(), 'docs/copy/terms.json'), 'utf8')) as TermEntry[]

function guard(event: Parameters<typeof getRequestHeaders>[0]) {
  const problem = checkRequestHeaders(getRequestHeaders(event))
  if (problem) throw createError({ statusCode: 403, statusMessage: problem })
}

export const translateRoute = defineEventHandler(async (event) => {
  guard(event)
  const base = readLocaleTrees(root())
  const parsed = validateItems(await readBody(event), base)
  if (!parsed.ok) {
    setResponseStatus(event, 400)
    return { ok: false, errors: parsed.errors }
  }
  const voiceMd = readFileSync(join(root(), VOICE_RULES_FILE), 'utf8')
  const result = await translate(parsed.items, {
    base,
    terms: readTerms(),
    rules: extractVoiceRules(voiceMd),
    run,
    agentCmd: process.env.KANDO_COPY_AGENT_CMD || 'claude',
  })
  if (!result.ok) setResponseStatus(event, 502)
  return result
})

/** Starts the publish job (minutes long) and answers at once; the progress and the result come from `publishStatusRoute`. */
export const publishRoute = defineEventHandler(async (event) => {
  guard(event)
  const started = startPublishJob(await readBody(event), { root: root(), run, terms: readTerms(), agentCmd: process.env.KANDO_COPY_AGENT_CMD || 'claude' }, publish)
  setResponseStatus(event, started.ok ? 202 : 409)
  return started
})

export const publishStatusRoute = defineEventHandler(async (event) => {
  guard(event)
  const status = jobStatus(((await readBody(event)) as { jobId?: unknown } | null)?.jobId)
  if (!status) {
    setResponseStatus(event, 404)
    return { ok: false, errors: ['unknown publish job (the dev server restarted, or a newer publish replaced it)'] }
  }
  return { ok: true, job: status }
})
