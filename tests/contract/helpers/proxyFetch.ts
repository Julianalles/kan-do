import type { Agent } from 'supertest'

/**
 * `fetch` stand-in for contract tests: forwards the relative `/api/notion/...` requests the
 * browser-mode `NotionClientAPI` / `NotionIntegration` send to a supertest app that mounts the
 * unmocked proxy routes. Pair with `vi.stubGlobal('fetch', proxyFetch(request))` so the client
 * code (pagination loop, `getProxyUrl` / `getProxyOptions` mapping) runs end to end against
 * the real routes and real Notion, which hand-written route bodies cannot cover.
 *
 * The stub replaces the global `fetch` the server routes' `@notionhq/client` uses too, so call
 * `proxyFetch` BEFORE stubbing: it captures the real `fetch` then and hands every absolute URL
 * (the route's own outbound Notion call) to it. Only relative `/api/` URLs go to supertest.
 */
/** How often a 429 is replayed after its `Retry-After`: more than the client's one retry, as the SDK's two used to give. */
const MAX_429_REPLAYS = 3

export const proxyFetch = (request: Agent, passthrough: typeof fetch = globalThis.fetch): typeof fetch =>
  (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (!url.startsWith('/api/')) {
      if (/^https?:\/\//.test(url)) return passthrough(input, init)
      throw new Error(`proxyFetch only serves relative /api/ URLs, got ${url}`)
    }

    const method = (init.method ?? 'GET').toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete'
    const send = () => {
      let pending = request[method](url)
      for (const [name, value] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
        pending = pending.set(name, value)
      }
      if (typeof init.body === 'string') pending = pending.send(JSON.parse(init.body))
      return pending
    }

    // A 429 is Notion's quota on the shared sandbox token, not a contract failure, and the proxy no longer waits it out
    // (#539: the SDK's own retries are off). The browser would wait `Retry-After` and retry; so does this stand-in, and a
    // 429 refuses the request before it acts, so replaying it is safe. Anything else is returned as it is.
    let res = await send()
    for (let attempt = 0; res.status === 429 && attempt < MAX_429_REPLAYS; attempt++) {
      const asked = Number(res.headers['retry-after'])
      await new Promise(resolve => setTimeout(resolve, Math.min(Number.isFinite(asked) && asked > 0 ? asked * 1000 : 1000, 60_000)))
      res = await send()
    }
    return new Response(res.text, {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
