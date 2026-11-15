// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { jobStatus, resetJobs, startPublishJob, type PublishFn } from '~/server/copy-editor/jobs'
import type { PublishDeps, PublishResult } from '~/server/copy-editor/publish'

const deps = {} as PublishDeps
const done: PublishResult = { ok: false, step: 'validate', errors: ['x'] }

beforeEach(resetJobs)

describe('copy publish job', () => {
  it('starts at once, reports the stage and notes while it runs, then the result', async () => {
    let finish: (result: PublishResult) => void = () => {}
    const publishFn: PublishFn = (_input, d) => new Promise((resolve) => { d.onStage?.('specs'); d.onNote?.('specs: smoke'); finish = resolve })
    const started = startPublishJob({ edits: [] }, deps, publishFn)
    expect(started).toMatchObject({ ok: true })
    const id = (started as { jobId: string }).jobId
    expect(jobStatus(id)).toMatchObject({ state: 'running', stage: 'specs', notes: ['specs: smoke'], result: null })
    finish(done)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(jobStatus(id)).toMatchObject({ state: 'done', result: done })
  })

  it('refuses a second job while one runs, and starts again after it ended', async () => {
    let finish: (result: PublishResult) => void = () => {}
    const slow: PublishFn = () => new Promise((resolve) => { finish = resolve })
    const first = startPublishJob({}, deps, slow)
    expect(startPublishJob({}, deps, slow)).toEqual({ ok: false, step: 'busy', errors: ['another publish is still running'] })
    finish(done)
    await new Promise(resolve => setTimeout(resolve, 0))
    const second = startPublishJob({}, deps, async () => done)
    expect(second).toMatchObject({ ok: true })
    expect((second as { jobId: string }).jobId).not.toBe((first as { jobId: string }).jobId)
    expect(jobStatus((first as { jobId: string }).jobId)).toBeNull()
  })

  it('turns a throwing flow into a failed result and knows no foreign id', async () => {
    const started = startPublishJob({}, deps, async () => { throw new Error('boom') }) as { jobId: string }
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(jobStatus(started.jobId)).toMatchObject({ state: 'done', result: { ok: false, step: 'internal', errors: ['boom'] } })
    expect(jobStatus('nope')).toBeNull()
    expect(jobStatus(undefined)).toBeNull()
  })
})
