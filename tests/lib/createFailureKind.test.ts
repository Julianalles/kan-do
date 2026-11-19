import { describe, it, expect } from 'vitest'
import { CreateLookupError, createFailureKind, createOutcomeUnknown, pushFailureScope } from '~/lib/integrationHealth'
import { SourceNotConfiguredError } from '~/integrations/sources/types'

const http = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })

describe('createFailureKind (#321)', () => {
  it('agrees with pushFailureScope: only the source\'s own faults are source-scoped, and none of the task-scoped kinds marks the source', () => {
    for (const status of [400, 403, 404, 409, 422, 429, 500, 503]) expect(pushFailureScope(http(status))).toBe('task')
    for (const error of [http(0), http(401), new SourceNotConfiguredError('notion', 'not configured')]) {
      expect(pushFailureScope(error)).toBe('source')
      expect(createFailureKind(error)).toBe('transient')
    }
  })

  it.each([
    ['no connection (statusCode 0)', http(0)],
    ['a rejected token (401)', http(401)],
    ['no access to the database (403)', http(403)],
    ['a rate limit (429, #507)', http(429)],
    ['a 429 behind a wrapping error', new Error('Cannot create', { cause: http(429) })],
    ['a 403 behind a wrapping error', new Error('Cannot create', { cause: http(403) })],
    ['a server error (500)', http(500)],
    ['a gateway error (503)', http(503)],
    ['a source that is not set up', new SourceNotConfiguredError('notion', 'not configured')],
    ['a status behind a wrapping error', new Error('Cannot access database', { cause: http(401) })],
  ])('keeps the task for later: %s', (_name, error) => {
    expect(createFailureKind(error)).toBe('transient')
  })

  it.each([
    ['an invalid property (400)', http(400)],
    ['a validation error (422)', http(422)],
    ['a conflict (409)', http(409)],
    ['a database that is gone (404)', http(404)],
    ['an error without a status', new Error('boom')],
  ])('refuses the create: %s', (_name, error) => {
    expect(createFailureKind(error)).toBe('rejected')
  })
})

describe('createOutcomeUnknown (#528)', () => {
  it.each([
    ['a timeout or network error (status 0)', http(0)],
    ['a server error (500)', http(500)],
    ['a gateway error (502)', http(502)],
    ['a status behind a wrapping error', new Error('Cannot create', { cause: http(503) })],
  ])('the page may exist: %s', (_name, error) => {
    expect(createOutcomeUnknown(error)).toBe(true)
  })

  it.each([
    ['a rate limit (429)', http(429)],
    ['no access (403)', http(403)],
    ['a rejected token (401)', http(401)],
    ['invalid (400)', http(400)],
    ['in conflict (409)', http(409)],
    ['a source that is not set up', new SourceNotConfiguredError('notion', 'not configured')],
    ['a failed lookup, whatever status its query had', new CreateLookupError(http(502))],
  ])('the create was refused or never sent: %s', (_name, error) => {
    expect(createOutcomeUnknown(error)).toBe(false)
  })

  it('a failed lookup is classified by its cause, as before', () => {
    expect(createFailureKind(new CreateLookupError(http(502)))).toBe('transient')
    expect(createFailureKind(new CreateLookupError(http(400)))).toBe('rejected')
  })
})
