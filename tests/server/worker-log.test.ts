// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * #540: Workers Logs persist the console. Every log line of the Worker's own code goes through `logWorkerError`
 * (`worker/log.ts`, tested in `worker/log.test.ts`), the way `server/` goes through `logServerError`. (Here, not in
 * `worker/`: that folder's tsconfig has no Node types.)
 */
const workerDir = resolve(__dirname, '../../worker')

describe('worker/ console use (#540)', () => {
  it('no source file calls `console.` except log.ts: a new log line goes through logWorkerError', () => {
    const sources = readdirSync(workerDir).filter(name => /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/\.d\.ts$/.test(name))
    expect(sources).toContain('gate.ts') // the scan finds the folder
    const offenders = sources.filter(name => name !== 'log.ts' && /\bconsole\s*\./.test(readFileSync(join(workerDir, name), 'utf8')))
    expect(offenders).toEqual([])
  })
})
