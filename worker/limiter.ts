/**
 * The Notion proxy's rate limiter (#508, ADR 021): one Durable Object per client, counting in memory, so every
 * request of a client, from any isolate and any Cloudflare location, meets the same count. It replaces the Workers
 * Rate Limiting binding of #503, which never limited on the live instance: its counts are approximate, local to a
 * location and eventually consistent, and on Workers Free on workers.dev it answered `success: true` for 1200 requests
 * in 28 s against a 120 per 60 s limit (cloudflare/developer-platform#123 reports the same).
 *
 * The object is addressed by `idFromName(clientKey)` and answers `POST` with `{ success }`. A Durable Object serves
 * its requests one after the other, so the count is exact while the object lives. An idle object is evicted after
 * about ten seconds and loses its memory, which would let a client reset its window by pausing: so the window is also
 * checkpointed to the object's storage, in steps of `CHECKPOINT` hits (the first hit of a window, then every tenth),
 * each checkpoint rounded up, so a restored count is never below the true one and at most 9 above it. That keeps a
 * client's writes at a few per window, far below the Free quota of 100,000 rows a day. A failing storage never
 * blocks an answer: the count then lives in memory only. Written as the plain `fetch` class (no `cloudflare:workers`
 * import) so `limiter.test.ts` runs it in Node.
 */

/** Requests allowed per window and client. Normal use is an order of magnitude below (ADR 021). */
export const LIMIT = 120
/** The window in seconds; also the `Retry-After` of a 429. */
export const LIMIT_PERIOD_SECONDS = 60

/** Hits between two writes of the window to storage; a restored count is up to `CHECKPOINT - 1` above the true one. */
export const CHECKPOINT = 10

export interface WindowState {
  windowStart: number
  count: number
}

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

  state(): WindowState {
    return { windowStart: this.windowStart, count: this.count }
  }

  restore(saved: WindowState): void {
    this.windowStart = saved.windowStart
    this.count = Math.min(saved.count, this.limit)
  }
}

/** The slice of the Durable Object's storage this class uses. */
export interface LimiterStorage {
  get: (key: string) => Promise<unknown>
  put: (key: string, value: unknown) => Promise<void>
}

const isState = (v: unknown): v is WindowState =>
  typeof v === 'object' && v !== null && Number.isFinite((v as WindowState).windowStart) && Number.isFinite((v as WindowState).count)

export class NotionLimiter {
  private readonly counter = new WindowCounter(LIMIT, LIMIT_PERIOD_SECONDS * 1000)
  private readonly storage?: LimiterStorage
  private loaded = false
  /** What storage holds: a window start and the count it would restore. */
  private saved: WindowState = { windowStart: -1, count: 0 }

  constructor(state?: { storage: LimiterStorage }) {
    this.storage = state?.storage
  }

  async fetch(_request: Request): Promise<Response> {
    if (!this.loaded) await this.load() // a Durable Object takes no other event while it waits for storage
    const success = this.counter.hit(Date.now())
    await this.checkpoint()
    return Response.json({ success })
  }

  private async load(): Promise<void> {
    this.loaded = true
    try {
      const saved = await this.storage?.get('window')
      if (isState(saved)) {
        this.counter.restore(saved)
        this.saved = saved
      }
    } catch (error) {
      console.error('limiter: could not read the window, counting from zero', error)
    }
  }

  /** Writes the window when it is a new one or the count passed the stored one; rounded up to the next step. */
  private async checkpoint(): Promise<void> {
    if (!this.storage) return
    const { windowStart, count } = this.counter.state()
    if (windowStart === this.saved.windowStart && count <= this.saved.count) return
    const next = { windowStart, count: Math.min(LIMIT, count + CHECKPOINT - 1) }
    this.saved = next // also after a failed write: retrying every hit would only repeat the failure
    try {
      await this.storage.put('window', next)
    } catch (error) {
      console.error('limiter: could not write the window, counting in memory only', error)
    }
  }
}

/**
 * The key a client is counted under: its IP; an IPv6 address by its /64, so a client holding a whole /64 (the usual
 * home allocation) does not get a fresh budget per address. Without the header every client shares one key.
 */
export function clientKey(ip: string | null): string {
  if (!ip) return 'unknown'
  if (!ip.includes(':')) return ip
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip) // IPv4 in IPv6 clothes: the same client as the plain address
  if (mapped) return mapped[1]!
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
