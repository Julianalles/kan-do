/**
 * @module copy-editor/api
 * @description Client for the two dev-only routes (`server/copy-editor/`). Never throws: a network or HTTP failure is
 * returned as `errors`, so the editor shows it and keeps the edits.
 * @responsibility fetch with the marker header and a uniform result shape.
 */
import { API_HEADER } from './constants'

export interface Failure { ok: false, step?: string, errors: string[] }
export interface DraftResult { text: string | null, problems: string[], warnings: string[] }
export type TranslateResponse = { ok: true, drafts: Record<string, DraftResult> } | Failure
export interface FollowUpSummary {
  rewritten: string[]
  baselines: string[]
  repairs: { round: number, notes: string }[]
  repairedFiles: string[]
  specs: string[]
  tier: string
}
/** `landed: 'main'`: the commit is on main. `'branch'`: a step failed (see `failure`) and a `copy/...` PR waits for the owner. */
export type PublishResponse =
  | { ok: true, landed: 'main' | 'branch', commit: string | null, branch: string | null, prUrl: string | null, note: string | null, edits: number, files: number, warnings: string[], followUp: FollowUpSummary, failure: { stage: string, errors: string[] } | null }
  | Failure
export interface PublishStatus { id: string, state: 'running' | 'done', stage: string | null, notes: string[], result: PublishResponse | null }
export type PublishProgress = (status: Pick<PublishStatus, 'stage' | 'notes'>) => void

async function post<T extends { ok: boolean }>(route: string, body: unknown): Promise<T | Failure> {
  try {
    const response = await fetch(`/api/dev/copy/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [API_HEADER]: '1' },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => null) as T | null
    if (data && typeof data.ok === 'boolean') return data
    return { ok: false, errors: [`The dev server answered ${response.status}. Is this \`nuxt dev\` on your machine?`] }
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : 'request failed'] }
  }
}

export const requestTranslation = (items: { key: string, from: 'de' | 'en', value: string }[]) => post<TranslateResponse>('translate', { items })
const POLL_MS = 1000
const MAX_POLL_ERRORS = 5

/**
 * Starts the publish job (#340) and polls its status until it ends. Never throws: a refused start, a lost dev server and
 * the job's own failure all come back as `errors`, so the editor shows them and keeps the edits.
 */
export async function requestPublish(edits: { key: string, de: string, en: string, changed: ('de' | 'en')[] }[], onProgress: PublishProgress = () => {}): Promise<PublishResponse> {
  const started = await post<{ ok: boolean, jobId?: string, step?: string, errors?: string[] }>('publish', { edits })
  if (!started.ok || !('jobId' in started) || !started.jobId) return started.ok ? { ok: false, errors: ['the dev server did not start a publish job'] } : started as Failure
  let errors = 0
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
    const status = await post<{ ok: boolean, job?: PublishStatus }>('publish-status', { jobId: started.jobId })
    if (!status.ok || !('job' in status) || !status.job) {
      if (++errors >= MAX_POLL_ERRORS) return { ok: false, errors: ['Lost contact with the dev server; the publish may still be running. Check the repository before publishing again.'] }
      continue
    }
    errors = 0
    onProgress({ stage: status.job.stage, notes: status.job.notes })
    if (status.job.state === 'done') return status.job.result ?? { ok: false, errors: ['the publish job ended without a result'] }
  }
}
