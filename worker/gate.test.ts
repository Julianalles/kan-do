// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  COOKIE_MAX_AGE,
  COOKIE_NAME,
  PREVIEW_PAGE,
  ROBOTS_TAG,
  handle,
  readCookie,
  sha256Hex,
  type GateEnv,
} from './gate'

const SECRET = 'test-token'
const SITE = 'https://kando.example.workers.dev'

function setup(env: GateEnv = { GATE: 'on', GATE_SECRET: SECRET }) {
  const app = vi.fn(async (_request: Request) => new Response('<p>app</p>', { headers: { 'Content-Type': 'text/html' } }))
  const run = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const { cookie, ...rest } = init
    const headers = new Headers(rest.headers)
    if (cookie) headers.set('Cookie', cookie)
    return handle(new Request(SITE + path, { ...rest, headers }), env, app)
  }
  return { app, run }
}

const validCookie = async () => `other=1; ${COOKIE_NAME}=${await sha256Hex(SECRET)}`

describe('gate on', () => {
  it('valid token: sets the cookie and redirects to the URL without the token, other params kept', async () => {
    const { app, run } = setup()
    const res = await run(`/tasks?a=1&secret=${SECRET}&b=2`)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe(`${SITE}/tasks?a=1&b=2`)
    const cookie = res.headers.get('Set-Cookie') ?? ''
    expect(cookie).toContain(`${COOKIE_NAME}=${await sha256Hex(SECRET)}`)
    // The cookie holds the digest, never the token itself.
    expect(cookie).not.toContain(SECRET)
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${COOKIE_MAX_AGE}`]) {
      expect(cookie).toContain(attr)
    }
    expect(COOKIE_NAME.startsWith('__Host-')).toBe(true)
    expect(COOKIE_MAX_AGE).toBe(7776000)
    expect(res.headers.get('X-Robots-Tag')).toBe(ROBOTS_TAG)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('Location')).not.toContain(SECRET)
    expect(app).not.toHaveBeenCalled()
  })

  it('valid token on the root path redirects to the root', async () => {
    const { run } = setup()
    const res = await run(`/?secret=${SECRET}`)
    expect(res.headers.get('Location')).toBe(`${SITE}/`)
  })

  it('valid cookie: serves the app with X-Robots-Tag', async () => {
    const { app, run } = setup()
    const res = await run('/tasks', { cookie: await validCookie() })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<p>app</p>')
    expect(res.headers.get('X-Robots-Tag')).toBe(ROBOTS_TAG)
    expect(res.headers.get('Content-Type')).toBe('text/html')
    expect(app).toHaveBeenCalledOnce()
  })

  it('valid cookie: static files and API routes pass too', async () => {
    const { app, run } = setup()
    const cookie = await validCookie()
    expect((await run('/_nuxt/entry.js', { cookie })).status).toBe(200)
    expect((await run('/api/notion/ping', { cookie })).status).toBe(200)
    expect(app).toHaveBeenCalledTimes(2)
  })

  it('no cookie: plain private-preview page, 401, the app is never called', async () => {
    const { app, run } = setup()
    for (const path of ['/', '/tasks', '/_nuxt/entry.js', '/api/notion/ping', '/favicon.svg']) {
      const res = await run(path)
      expect(res.status).toBe(401)
      expect(res.headers.get('Content-Type')).toContain('text/html')
      expect(res.headers.get('X-Robots-Tag')).toBe(ROBOTS_TAG)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(await res.text()).toBe(PREVIEW_PAGE)
    }
    expect(app).not.toHaveBeenCalled()
  })

  it('the preview page loads no script, stylesheet or other asset', () => {
    expect(PREVIEW_PAGE).not.toMatch(/<script|<link|src=|url\(/i)
  })

  it('wrong token, no cookie: 401 and no cookie set', async () => {
    const { app, run } = setup()
    const res = await run('/tasks?secret=nope')
    expect(res.status).toBe(401)
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(app).not.toHaveBeenCalled()
  })

  it('wrong token with a valid cookie: redirect without the parameter and without a new cookie', async () => {
    const { run } = setup()
    const res = await run('/tasks?secret=nope', { cookie: await validCookie() })
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe(`${SITE}/tasks`)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('a wrong or stale cookie is refused', async () => {
    const { run } = setup()
    expect((await run('/', { cookie: `${COOKIE_NAME}=${await sha256Hex('old-token')}` })).status).toBe(401)
    // The raw token as the cookie value is not the digest.
    expect((await run('/', { cookie: `${COOKIE_NAME}=${SECRET}` })).status).toBe(401)
    // A cookie of the same name without the __Host- prefix is another cookie.
    expect((await run('/', { cookie: `kd_gate=${await sha256Hex(SECRET)}` })).status).toBe(401)
  })

  it('/robots.txt disallows everything and needs no token', async () => {
    const { app, run } = setup()
    const res = await run('/robots.txt')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Disallow: /')
    expect(res.headers.get('X-Robots-Tag')).toBe(ROBOTS_TAG)
    expect(app).not.toHaveBeenCalled()
  })

  it('missing GATE_SECRET fails closed, even for a request with a secret parameter', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { app, run } = setup({ GATE: 'on' })
    expect((await run('/')).status).toBe(401)
    expect((await run('/?secret=')).status).toBe(401)
    expect((await run('/?secret=undefined')).status).toBe(401)
    expect(app).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('a missing GATE var counts as on', async () => {
    const { run } = setup({ GATE_SECRET: SECRET })
    expect((await run('/')).status).toBe(401)
  })
})

describe('feedback relay is exempt', () => {
  it('POST and OPTIONS /api/feedback reach the app without token or cookie', async () => {
    const { app, run } = setup()
    const post = await run('/api/feedback', { method: 'POST', body: '{}' })
    const options = await run('/api/feedback', { method: 'OPTIONS' })
    expect(post.status).toBe(200)
    expect(options.status).toBe(200)
    expect(app).toHaveBeenCalledTimes(2)
    expect(post.headers.get('X-Robots-Tag')).toBe(ROBOTS_TAG)
  })

  it('ignores a secret parameter on the relay route', async () => {
    const { app, run } = setup()
    const res = await run(`/api/feedback?secret=${SECRET}`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(app).toHaveBeenCalledOnce()
  })

  it('nothing else is exempt: GET /api/feedback and look-alike paths stay gated', async () => {
    const { app, run } = setup()
    expect((await run('/api/feedback')).status).toBe(401)
    expect((await run('/api/feedback/', { method: 'POST' })).status).toBe(401)
    expect((await run('/api/feedback.json', { method: 'POST' })).status).toBe(401)
    expect((await run('/api/feedbackx', { method: 'POST' })).status).toBe(401)
    expect((await run('/x/api/feedback', { method: 'POST' })).status).toBe(401)
    expect((await run('/api/notion/ping', { method: 'POST' })).status).toBe(401)
    expect(app).not.toHaveBeenCalled()
  })
})

describe('gate off', () => {
  it('hands every request to the app and adds no gate header', async () => {
    const { app, run } = setup({ GATE: 'off', GATE_SECRET: SECRET })
    const res = await run('/tasks')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Robots-Tag')).toBeNull()
    expect(app).toHaveBeenCalledOnce()
  })

  it('works without a secret and leaves a secret parameter to the app', async () => {
    const { app, run } = setup({ GATE: 'off' })
    const res = await run('/?secret=anything')
    expect(res.status).toBe(200)
    expect(app).toHaveBeenCalledOnce()
    expect(app.mock.calls[0]![0].url).toBe(`${SITE}/?secret=anything`)
  })

  it('serves /robots.txt from the app, not the gate', async () => {
    const { app, run } = setup({ GATE: 'off' })
    await run('/robots.txt')
    expect(app).toHaveBeenCalledOnce()
  })
})

describe('readCookie', () => {
  it('finds a cookie among others and ignores prefix matches', () => {
    expect(readCookie('a=1; b=2; c=3', 'b')).toBe('2')
    expect(readCookie('ab=1', 'b')).toBeUndefined()
    expect(readCookie(null, 'a')).toBeUndefined()
  })
})
