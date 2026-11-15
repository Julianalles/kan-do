/**
 * @module copy-editor/jobs
 * @description The one background publish job of the dev server (#340, decision D1). A publish now takes minutes (build,
 * checks, specs), so `POST /api/dev/copy/publish` starts the job and answers at once, and the Publish view polls the
 * status route for the stage, the notes and the result. One job at a time; the last finished job stays readable until
 * the next one starts.
 * @responsibility Job state in memory. The flow itself is `publish()`, injected.
 */
import { randomUUID } from 'node:crypto'
import type { PublishDeps, PublishResult, PublishStage } from './publish'

export interface JobStatus {
  id: string
  state: 'running' | 'done'
  stage: PublishStage | null
  notes: string[]
  result: PublishResult | null
}

export type PublishFn = (input: unknown, deps: PublishDeps) => Promise<PublishResult>

let current: JobStatus | null = null

/** Starts the job, or says why not. The flow runs in the background; failures end up in `result`. */
export function startPublishJob(input: unknown, deps: PublishDeps, publishFn: PublishFn): { ok: true, jobId: string } | { ok: false, step: 'busy', errors: string[] } {
  if (current?.state === 'running') return { ok: false, step: 'busy', errors: ['another publish is still running'] }
  const job: JobStatus = { id: randomUUID(), state: 'running', stage: null, notes: [], result: null }
  current = job
  void publishFn(input, { ...deps, onStage: (stage) => { job.stage = stage }, onNote: (text) => { job.notes.push(text) } })
    .then((result) => { job.result = result })
    .catch((error: unknown) => { job.result = { ok: false, step: 'internal', errors: [error instanceof Error ? error.message : String(error)] } })
    .finally(() => { job.state = 'done' })
  return { ok: true, jobId: job.id }
}

/** The job with this id (a copy, so a caller cannot change it), or null when it is unknown (another server run, or replaced). */
export function jobStatus(id: unknown): JobStatus | null {
  return current && current.id === id ? { ...current, notes: [...current.notes] } : null
}

/** Tests only. */
export function resetJobs() {
  current = null
}
