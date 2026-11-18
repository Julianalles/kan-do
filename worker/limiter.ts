/**
 * The Notion proxy's rate limiter (#508, ADR 021): one Durable Object per client, counting in memory, so every
 * request of a client, from any isolate and any Cloudflare location, meets the same count. It replaces the Workers
 * Rate Limiting binding of #503, which never limited on the live instance: its counts are approximate, local to a
 * location and eventually consistent, and on Workers Free on workers.dev it answered `success: true` for 1200 requests
 * in 28 s against a 120 per 60 s limit (cloudflare/developer-platform#123 reports the same).
 *
 * The object is addressed by `idFromName(clientKey)` and answers `POST` with `{ success }`. A Durable Object serves
 * its requests one after the other, so the count is exact. It keeps no storage: an object idle for a while is
 * evicted and its client starts a fresh window, which only ever loosens the limit slightly. Written as the plain
 * `fetch` class (no `cloudflare:workers` import) so `limiter.test.ts` runs it in Node.
 */

/** Requests allowed per window and client. Normal use is an order of magnitude below (ADR 021). */
export const LIMIT = 120
/** The window in seconds; also the `Retry-After` of a 429. */
export const LIMIT_PERIOD_SECONDS = 60

/** A fixed-window counter: at most `limit` hits per `periodMs`; a hit over the limit is not counted. */
export class WindowCounter {
  private windowStart = 0
  private count = 0

  constructor(private readonly limit: number, private readonly periodMs: number) {}

  hit(now: number): boolean {
    if (now - this.windowStart >= this.periodMs) {
      this.windowStart = now
      this.count = 0
    }
    if (this.count >= this.limit) return false
    this.count++
    return true
  }
}

export class NotionLimiter {
  private readonly counter = new WindowCounter(LIMIT, LIMIT_PERIOD_SECONDS * 1000)

  // No constructor: the object's state and env are unused, the count lives in memory only.

  async fetch(_request: Request): Promise<Response> {
    return Response.json({ success: this.counter.hit(Date.now()) })
  }
}

/**
 * The key a client is counted under: its IP; an IPv6 address by its /64, so a client holding a whole /64 (the usual
 * home allocation) does not get a fresh budget per address. Without the header every client shares one key.
 */
export function clientKey(ip: string | null): string {
  if (!ip) return 'unknown'
  if (!ip.includes(':')) return ip
  const [head] = ip.split('%') // a zone id never reaches Cloudflare, but never let it split a key
  const groups = expandIpv6(head ?? ip)
  return groups ? groups.slice(0, 4).join(':') : ip
}

function expandIpv6(ip: string): string[] | null {
  const lower = ip.toLowerCase()
  const parts = lower.split('::')
  if (parts.length > 2) return null
  const side = (s: string) => (s === '' ? [] : s.split(':'))
  const head = side(parts[0] ?? '')
  const tail = parts.length === 2 ? side(parts[1] ?? '') : []
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0
  if (fill < 0 || (parts.length === 1 && head.length !== 8)) return null
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail]
  return groups.every(g => /^[0-9a-f]{1,4}$/.test(g)) ? groups.map(g => g.replace(/^0+(?=.)/, '')) : null
}
