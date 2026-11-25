// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createRouter, toNodeListener } from 'h3'
import supertest from 'supertest'
import { FEEDBACK_HOURLY_CAP } from '~/server/utils/feedbackRelay'

/** #268: the feedback relay. GitHub is a stubbed `fetch`; nothing leaves the test. */

const PATH = 'feedback/2026/11/0b6f3c1e-8a55-4d0a-9c1b-2f6f0a4d9e11.png'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64')
const REPORT = { title: 'Karte abgeschnitten', body: '## Description\n\nDer Titel ist zu lang.\n' }

type GithubCall = { method: string, url: string, body: Record<string, unknown> | null, auth: string | null }
let calls: GithubCall[]

/** Answers GitHub by `<METHOD> <path prefix>`; the default is an empty issue list and 201 for writes. */
function stubGithub(answers: Record<string, { status: number, json?: unknown }> = {}) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace('https://api.github.com', '')
    const method = init.method ?? 'GET'
    calls.push({ method, url: path, body: init.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init.headers).get('authorization') })
    const key = Object.keys(answers).find(k => `${method} ${path}`.startsWith(k))
    const answer = key ? answers[key]! : { status: method === 'GET' ? 200 : 201, json: method === 'GET' ? [] : { sha: `sha-${calls.length}` } }
    return new Response(JSON.stringify(answer.json ?? {}), { status: answer.status })
  }))
}

async function request() {
  const post = (await import('~/server/api/feedback.post')).default
  const options = (await import('~/server/api/feedback.options')).default
  const router = createRouter().post('/api/feedback', post).options('/api/feedback', options)
  const app = createApp()
  app.use(router)
  return supertest(toNodeListener(app))
}

const writes = () => calls.filter(call => call.method !== 'GET')

describe('server/api/feedback.post.ts', () => {
  beforeEach(() => {
    vi.stubEnv('FEEDBACK_GITHUB_TOKEN', 'github_pat_relay')
    vi.stubEnv('FEEDBACK_REPO', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubGithub()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('a prototype preview (FEEDBACK_RELAY=dry-run) validates the report but calls GitHub not at all, even with a token', async () => {
    vi.stubEnv('FEEDBACK_RELAY', 'dry-run')
    const res = await (await request()).post('/api/feedback').send(REPORT)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true, dryRun: true })
    expect(calls).toEqual([])
    const bad = await (await request()).post('/api/feedback').send({ title: '', body: 'x' })
    expect(bad.status).toBe(400)
  })

  it('files the report as an inbox issue in the private repository and tells the client nothing about it', async () => {
    const res = await (await request()).post('/api/feedback').send(REPORT)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true })
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(writes()).toEqual([{
      method: 'POST',
      url: '/repos/jaylouiz/kan-do-feedback/issues',
      body: { title: REPORT.title, body: REPORT.body, labels: ['inbox'] },
      auth: 'Bearer github_pat_relay',
    }])
    expect(JSON.stringify(res.body) + JSON.stringify(res.headers)).not.toContain('github_pat_relay')
  })

  it('stores the screenshot as the only file of its own parentless branch, then creates the issue (#744)', async () => {
    const res = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: PNG } })
    expect(res.status).toBe(201)
    const repo = '/repos/jaylouiz/kan-do-feedback'
    expect(writes().map(call => `${call.method} ${call.url}`)).toEqual([
      `POST ${repo}/git/blobs`,
      `POST ${repo}/git/trees`,
      `POST ${repo}/git/commits`,
      `POST ${repo}/git/refs`,
      `POST ${repo}/issues`,
    ])
    const [blob, tree, commit, ref] = writes()
    expect(blob!.body).toEqual({ content: PNG, encoding: 'base64' })
    expect(tree!.body).toEqual({ tree: [{ path: PATH, mode: '100644', type: 'blob', sha: 'sha-2' }] })
    expect(tree!.body).not.toHaveProperty('base_tree')
    expect(commit!.body).toMatchObject({ tree: 'sha-3', parents: [] })
    expect(ref!.body).toEqual({ ref: 'refs/heads/screenshot/0b6f3c1e-8a55-4d0a-9c1b-2f6f0a4d9e11', sha: 'sha-4' })
    // Nothing touches the default branch: no contents API write
    expect(writes().some(call => call.url.includes('/contents/'))).toBe(false)
  })

  it('rewrites the screenshot link of an older client (blob/main) to the branch the image is on, so the cleanup finds it', async () => {
    const oldBody = `## Description\n\nx\n\n![Screenshot](https://github.com/jaylouiz/kan-do-feedback/blob/main/${PATH}?raw=true)\n\nPath: \`${PATH}\` on \`main\`\nAgents: \`gh api repos/jaylouiz/kan-do-feedback/contents/${PATH}?ref=main\`\n`
    const res = await (await request()).post('/api/feedback').send({ title: 'T', body: oldBody, screenshot: { path: PATH, content: PNG } })
    expect(res.status).toBe(201)
    const body = (writes().at(-1)!.body as { body: string }).body
    const branch = 'screenshot/0b6f3c1e-8a55-4d0a-9c1b-2f6f0a4d9e11'
    expect(body).toContain(`/blob/${branch}/${PATH}?raw=true`)
    expect(body).toContain(`on \`${branch}\``)
    expect(body).toContain(`?ref=${branch}`)
    expect(body).not.toContain('main')
  })

  it('names the branch in a body that does not mention it at all', async () => {
    const res = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: PNG } })
    expect(res.status).toBe(201)
    expect((writes().at(-1)!.body as { body: string }).body).toContain('`screenshot/0b6f3c1e-8a55-4d0a-9c1b-2f6f0a4d9e11`')
  })

  it('a retry after a failed issue create finds the screenshot branch already there (422) and still files the issue', async () => {
    stubGithub({ 'POST /repos/jaylouiz/kan-do-feedback/issues': { status: 500 } })
    const first = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: PNG } })
    expect(first.status).toBe(502)
    stubGithub({ 'POST /repos/jaylouiz/kan-do-feedback/git/refs': { status: 422, json: { message: 'Reference already exists' } } })
    const retry = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: PNG } })
    expect(retry.status).toBe(201)
    expect(writes().at(-1)!.url).toBe('/repos/jaylouiz/kan-do-feedback/issues')
  })

  it('a failed screenshot upload creates no issue', async () => {
    stubGithub({ 'POST /repos/jaylouiz/kan-do-feedback/git/blobs': { status: 403, json: { message: 'Resource not accessible by personal access token' } } })
    const res = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: PNG } })
    expect(res.status).toBe(502)
    expect(writes().map(call => call.url)).toEqual(['/repos/jaylouiz/kan-do-feedback/git/blobs'])
  })

  it('a refused branch creates no issue', async () => {
    stubGithub({ 'POST /repos/jaylouiz/kan-do-feedback/git/refs': { status: 403 } })
    const res = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: PNG } })
    expect(res.status).toBe(502)
    expect(writes().some(call => call.url.endsWith('/issues'))).toBe(false)
  })

  it.each([
    ['no title', { ...REPORT, title: '  ' }],
    ['a title over 120 characters', { ...REPORT, title: 'x'.repeat(121) }],
    ['no body', { title: 'T' }],
    ['a body over 20000 characters', { ...REPORT, body: 'x'.repeat(20001) }],
    ['an array', [REPORT]],
    ['a screenshot path outside feedback/', { ...REPORT, screenshot: { path: '.github/workflows/x.png', content: PNG } }],
    ['a screenshot path with a traversal', { ...REPORT, screenshot: { path: 'feedback/2026/11/../../../x.png', content: PNG } }],
    ['a screenshot that is not a PNG', { ...REPORT, screenshot: { path: PATH, content: Buffer.from('<svg onload=alert(1)>').toString('base64') } }],
    ['a screenshot that is not base64', { ...REPORT, screenshot: { path: PATH, content: 'not base64!' } }],
  ])('refuses %s with 400 and never calls GitHub', async (_label, body) => {
    const res = await (await request()).post('/api/feedback').send(body)
    expect(res.status).toBe(400)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(calls).toEqual([])
  })

  it('refuses a screenshot over 3 MB with 413', async () => {
    const big = PNG.slice(0, 8) + 'A'.repeat(4 * 1024 * 1024 + 8)
    const res = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: big } })
    expect(res.status).toBe(413)
    expect(calls).toEqual([])
  })

  it('answers a filled honeypot like a success, without calling GitHub', async () => {
    const res = await (await request()).post('/api/feedback').send({ ...REPORT, website: 'https://spam.example' })
    expect(res.status).toBe(201)
    expect(calls).toEqual([])
  })

  it('stops at the hourly cap: 429 and nothing written', async () => {
    const now = new Date().toISOString()
    stubGithub({ 'GET ': { status: 200, json: Array.from({ length: FEEDBACK_HOURLY_CAP }, () => ({ created_at: now })) } })
    const res = await (await request()).post('/api/feedback').send({ ...REPORT, screenshot: { path: PATH, content: PNG } })
    expect(res.status).toBe(429)
    expect(res.body?.data?.error).toBe('FEEDBACK_RATE_LIMITED')
    expect(writes()).toEqual([])
  })

  it('issues older than an hour do not count towards the cap', async () => {
    const old = new Date(Date.now() - 61 * 60 * 1000).toISOString()
    const fresh = new Date().toISOString()
    const list = Array.from({ length: FEEDBACK_HOURLY_CAP }, (_, i) => ({ created_at: i === 0 ? fresh : old }))
    stubGithub({ 'GET ': { status: 200, json: list } })
    const res = await (await request()).post('/api/feedback').send(REPORT)
    expect(res.status).toBe(201)
  })

  it('without a token it answers 503 FEEDBACK_NOT_CONFIGURED and never calls GitHub', async () => {
    vi.stubEnv('FEEDBACK_GITHUB_TOKEN', '')
    const res = await (await request()).post('/api/feedback').send(REPORT)
    expect(res.status).toBe(503)
    expect(res.body?.data?.error).toBe('FEEDBACK_NOT_CONFIGURED')
    expect(calls).toEqual([])
  })

  // #852: the configuration is checked before the report, so an empty probe tells a missing token from a healthy relay.
  it.each([
    ['an empty probe', {}],
    ['an invalid report', { title: '' }],
    ['a filled honeypot', { ...REPORT, website: 'https://spam.example' }],
  ])('without a token %s answers 503 FEEDBACK_NOT_CONFIGURED too, and logs the one allow-listed line', async (_label, body) => {
    vi.stubEnv('FEEDBACK_GITHUB_TOKEN', '')
    const res = await (await request()).post('/api/feedback').send(body)
    expect(res.status).toBe(503)
    expect(res.body?.data?.error).toBe('FEEDBACK_NOT_CONFIGURED')
    expect(calls).toEqual([])
    expect(vi.mocked(console.error).mock.calls).toEqual([['[server-error] route=/api/feedback status=503 code=FEEDBACK_NOT_CONFIGURED']])
  })

  it('a malformed FEEDBACK_REPO answers the empty probe with 503 as well', async () => {
    vi.stubEnv('FEEDBACK_REPO', 'not a repo')
    const res = await (await request()).post('/api/feedback').send({})
    expect(res.status).toBe(503)
    expect(res.body?.data?.error).toBe('FEEDBACK_NOT_CONFIGURED')
  })

  it('with a token the empty probe answers 400 INVALID_REPORT, files nothing and logs nothing', async () => {
    const res = await (await request()).post('/api/feedback').send({})
    expect(res.status).toBe(400)
    expect(res.body?.data?.error).toMatch(/^INVALID_/)
    expect(calls).toEqual([])
    expect(console.error).not.toHaveBeenCalled()
  })

  it('a prototype preview without a token still answers a valid report with the dry-run 201', async () => {
    vi.stubEnv('FEEDBACK_GITHUB_TOKEN', '')
    vi.stubEnv('FEEDBACK_RELAY', 'dry-run')
    const res = await (await request()).post('/api/feedback').send(REPORT)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true, dryRun: true })
    expect(calls).toEqual([])
  })

  it.each([
    ['the issue list fails', { 'GET ': { status: 401, json: { message: 'Bad credentials' } } }],
    ['the issue create fails', { 'POST ': { status: 500 } }],
  ])('answers 502 when %s', async (_label, answers) => {
    stubGithub(answers)
    const res = await (await request()).post('/api/feedback').send(REPORT)
    expect(res.status).toBe(502)
    expect(JSON.stringify(res.body)).not.toContain('Bad credentials')
  })

  it('answers 502 when GitHub is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const res = await (await request()).post('/api/feedback').send(REPORT)
    expect(res.status).toBe(502)
  })

  it('FEEDBACK_REPO overrides the target repository', async () => {
    vi.stubEnv('FEEDBACK_REPO', 'someone/their-feedback')
    await (await request()).post('/api/feedback').send(REPORT)
    expect(writes()[0]!.url).toBe('/repos/someone/their-feedback/issues')
  })

  it('answers the CORS preflight', async () => {
    const res = await (await request()).options('/api/feedback')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type')
  })
})
