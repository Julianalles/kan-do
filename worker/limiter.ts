/**
 * The Notion proxy's rate limiter (#508, ADR 021): one Durable Object per client, counting in memory, so every
 * request of a client, from any isolate and any Cloudflare location, meets the same count. It replaces the Workers
 * Rate Limiting binding of #503, which never limited on the live instance: its counts are approximate, local to a
 * location and eventually consistent, and on Workers Free on workers.dev it answered `success: true` for 1200 requests
 * in 28 s against a 120 per 60 s limit (cloudflare/developer-platform#123 reports the same).
 *
 * The object is addressed by `idFromName(limiterName(clientKey))` (a keyed hash: no IP in a name) and answers `POST` with `{ success }`. A Durable Object serves
 * its requests one after the other, so the count is exact while the object lives. An idle object is evicted after
 * about ten seconds and loses its memory, which would let a client reset its window by pausing: so the window is also
 * checkpointed to the object's storage, in steps of `CHECKPOINT` hits (the first hit of a window, then every tenth),
 * each checkpoint rounded up, so a restored count is never below the true one and at most 9 above it. That keeps a
 * client's writes at a few per window, far below the Free quota of 100,000 rows a day. A failing storage never
 * blocks an answer: the count then lives in memory only. Nothing outlives its window: the first write of a window sets an
 * alarm at the window's end, which deletes everything the object stored (`alarm()`). Written as the plain `fetch` class (no `cloudflare:workers`
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
    if (now < this.windowStart || now - this.windowStart >= this.periodMs) { // a start in the future (bad data, a clock step) is no window
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

  /** Is `now` inside the window that started at `windowStart`? */
  isCurrent(now: number): boolean {
    return now >= this.windowStart && now - this.windowStart < this.periodMs
  }

  reset(): void {
    this.windowStart = 0
    this.count = 0
  }

  restore(saved: WindowState): void {
    this.windowStart = saved.windowStart
    this.count = Math.max(0, Math.min(saved.count, this.limit))
  }
}

/** The slice of the Durable Object's storage this class uses. */
export interface LimiterStorage {
  get: (key: string) => Promise<unknown>
  put: (key: string, value: unknown) => Promise<void>
  setAlarm: (scheduledTime: number) => Promise<void>
  deleteAll: () => Promise<void>
}

const isState = (v: unknown): v is WindowState =>
  typeof v === 'object' && v !== null && Number.isFinite((v as WindowState).windowStart) && Number.isFinite((v as WindowState).count)

export class NotionLimiter {
  private readonly counter = new WindowCounter(LIMIT, LIMIT_PERIOD_SECONDS * 1000)
  private readonly storage?: LimiterStorage
  private ready?: Promise<boolean>
  /** What storage holds: a window start and the count it would restore. */
  private saved: WindowState = { windowStart: -1, count: 0 }
  /** The window start the pending alarm (the cleanup at the window's end) is set for. */
  private alarmFor = -1

  constructor(state?: { storage: LimiterStorage }) {
    this.storage = state?.storage
  }

  async fetch(_request: Request): Promise<Response> {
    // One read, shared by requests that arrive while it runs; a failed read is retried by the next request, and until it
    // succeeds nothing is written, so the stored window is never overwritten by a count that started from zero.
    const read = await (this.ready ??= this.load())
    const success = this.counter.hit(Date.now())
    if (read) await this.checkpoint()
    return Response.json({ success })
  }

  private async load(): Promise<boolean> {
    try {
      const saved = await this.storage?.get('window')
      if (isState(saved)) {
        this.counter.restore(saved)
        this.saved = saved
        this.alarmFor = saved.windowStart // the alarm was set before this window was written
      }
      return true
    } catch (error) {
      this.ready = undefined // the next request reads again: counting from zero is only for the requests in between
      console.error('limiter: could not read the window, counting from zero', error)
      return false
    }
  }

  /**
   * The cleanup at the window's end: storage holds a client's window only for that window, so nothing derived from a
   * client outlives it by more than one period (#508, the Worker stores nothing of a visitor, epic #279). A window that
   * is still current (the alarm ran early, or a new window began meanwhile) schedules the alarm again for its end. A
   * failure throws, so Cloudflare retries the alarm.
   */
  async alarm(): Promise<void> {
    if (!this.storage) return
    if (!(await (this.ready ??= this.load()))) throw new Error('limiter: could not read the window, retrying the cleanup')
    const { windowStart } = this.counter.state()
    if (this.counter.isCurrent(Date.now())) {
      await this.storage.setAlarm(windowStart + LIMIT_PERIOD_SECONDS * 1000)
      this.alarmFor = windowStart
      return
    }
    await this.storage.deleteAll()
    this.counter.reset()
    this.saved = { windowStart: -1, count: 0 }
    this.alarmFor = -1
  }

  /**
   * Writes the window when it is a new one or the count passed the stored one; rounded up to the next step. The alarm
   * that deletes it is set first, so nothing is ever stored without a cleanup pending.
   */
  private async checkpoint(): Promise<void> {
    if (!this.storage) return
    const { windowStart, count } = this.counter.state()
    if (windowStart === this.saved.windowStart && count <= this.saved.count) return
    try {
      if (this.alarmFor !== windowStart) {
        await this.storage.setAlarm(windowStart + LIMIT_PERIOD_SECONDS * 1000)
        this.alarmFor = windowStart
      }
    } catch (error) {
      console.error('limiter: could not set the cleanup alarm, counting in memory only', error)
      return
    }
    const next = { windowStart, count: Math.min(LIMIT, count + CHECKPOINT - 1) }
    try {
      await this.storage.put('window', next)
      this.saved = next // a failed write is tried again with the next hit
    } catch (error) {
      console.error('limiter: could not write the window, counting in memory only', error)
    }
  }
}

/**
 * The name of a client's Durable Object: HMAC-SHA-256 of its `clientKey`, hex, keyed with the Worker's gate secret, so the
 * object's name (which Cloudflare keeps and shows in its dashboard and logs) is no IP address and, without the key, cannot
 * be turned back into one (an unkeyed hash of an IPv4 address falls to a 2^32 search). A Worker without the secret (the
 * gate off, a test) keys with a public constant: the name is then still no plain IP, and the cleanup alarm bounds how
 * long it exists. The secret is only ever used as the HMAC key, never stored or returned.
 */
export async function limiterName(key: string, secret?: string): Promise<string> {
  const material = new TextEncoder().encode(secret || 'kando-limiter-unkeyed')
  const hmacKey = await crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(`kando-limiter:v1:${key}`))
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('')
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
  if (!groups) return ip
  // IPv4 in IPv6 clothes (`::ffff:a.b.c.d` or `::ffff:xxxx:xxxx`): the same client as the plain address
  if (groups.slice(0, 5).every(g => g === '0') && groups[5] === 'ffff') {
    const hi = parseInt(groups[6]!, 16)
    const lo = parseInt(groups[7]!, 16)
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  }
  return groups.slice(0, 4).join(':')
}

function expandIpv6(ip: string): string[] | null {
  // A dotted IPv4 tail (`::ffff:203.0.113.7`) is two groups.
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (dotted) {
    const octets = dotted.slice(2).map(Number)
    if (octets.some(o => o > 255)) return null
    ip = `${dotted[1]}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`
  }
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
