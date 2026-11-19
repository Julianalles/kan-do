// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHECKPOINT, LIMIT, LIMIT_PERIOD_SECONDS, NotionLimiter, WindowCounter, clientKey, limiterName, type LimiterStorage } from './limiter'

describe('WindowCounter', () => {
  it('allows `limit` hits per window and refuses the rest, however fast they come', () => {
    const counter = new WindowCounter(120, 60_000)
    const results = Array.from({ length: 600 }, () => counter.hit(1_000))
    expect(results.filter(Boolean)).toHaveLength(120)
    expect(results.indexOf(false)).toBe(120)
  })

  it('a refused hit is not counted and a new window starts fresh', () => {
    const counter = new WindowCounter(2, 10_000)
    expect([0, 1, 2, 3].map(t => counter.hit(t))).toEqual([true, true, false, false])
    expect(counter.hit(9_999)).toBe(false)
    expect(counter.hit(10_000)).toBe(true)
    expect(counter.hit(10_001)).toBe(true)
    expect(counter.hit(10_002)).toBe(false)
  })
})

describe('NotionLimiter (the Durable Object)', () => {
  it('answers 120 requests with success and then refuses, across separate fetches', async () => {
    const limiter = new NotionLimiter()
    const answers: boolean[] = []
    for (let i = 0; i < LIMIT + 10; i++) {
      answers.push(((await (await limiter.fetch(new Request('https://limiter.invalid/hit', { method: 'POST' }))).json()) as { success: boolean }).success)
    }
    expect(answers.filter(Boolean)).toHaveLength(LIMIT)
    expect(answers.slice(LIMIT).every(a => a === false)).toBe(true)
  })

  it('counts 120 per 60 s', () => {
    expect(LIMIT).toBe(120)
    expect(LIMIT_PERIOD_SECONDS).toBe(60)
  })
})

describe('NotionLimiter across an eviction (storage checkpoints)', () => {
  afterEach(() => vi.useRealTimers())

  const hit = async (limiter: NotionLimiter) =>
    ((await (await limiter.fetch(new Request('https://limiter.invalid/hit', { method: 'POST' }))).json()) as { success: boolean }).success
  const memory = (): LimiterStorage & { data: Map<string, unknown>, alarm: { at: number | null }, put: ReturnType<typeof vi.fn> } => {
    const data = new Map<string, unknown>()
    const alarm: { at: number | null } = { at: null }
    return {
      data,
      alarm,
      get: async (k: string) => data.get(k),
      put: vi.fn(async (k: string, v: unknown) => { data.set(k, v) }),
      setAlarm: async (at: number) => { alarm.at = at },
      deleteAll: async () => { data.clear() }, // the real one leaves a pending alarm alone; the handler's run consumes it
    }
  }

  it('a client cannot reset its window by pausing until the object is evicted', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const storage = memory()
    const first = new NotionLimiter({ storage })
    for (let i = 0; i < LIMIT; i++) expect(await hit(first)).toBe(true)
    expect(await hit(first)).toBe(false)

    vi.setSystemTime(1_000_000 + 15_000) // idle 15 s: the object is gone, a new instance starts from storage
    const second = new NotionLimiter({ storage })
    expect(await hit(second)).toBe(false)

    vi.setSystemTime(1_000_000 + 60_000) // the window is over
    expect(await hit(new NotionLimiter({ storage }))).toBe(true)
  })

  it('a restored count is never below the true one and at most CHECKPOINT - 1 above it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000_000)
    for (const n of [1, 5, 10, 11, 37, 119]) {
      const storage = memory()
      const before = new NotionLimiter({ storage })
      for (let i = 0; i < n; i++) await hit(before)
      const after = new NotionLimiter({ storage })
      let allowed = 0
      while (await hit(after)) allowed++
      const remaining = LIMIT - n
      expect(allowed, `after ${n} hits`).toBeLessThanOrEqual(remaining)
      expect(allowed, `after ${n} hits`).toBeGreaterThanOrEqual(remaining - (CHECKPOINT - 1))
    }
  })

  it('writes a few times per window, not on every hit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(3_000_000)
    const storage = memory()
    const limiter = new NotionLimiter({ storage })
    for (let i = 0; i < 600; i++) await hit(limiter)
    expect(storage.put.mock.calls.length).toBeLessThanOrEqual(LIMIT / CHECKPOINT + 1)
    expect(storage.put.mock.calls.length).toBeGreaterThan(0)
  })

  it('a failing storage never blocks an answer: it logs and counts in memory', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage: LimiterStorage = { ...memory(), get: async () => { throw new Error('read 203.0.113.9') }, put: async () => { throw new Error('write 203.0.113.9') } }
    const limiter = new NotionLimiter({ storage })
    const answers: boolean[] = []
    for (let i = 0; i < LIMIT + 5; i++) answers.push(await hit(limiter))
    expect(answers.filter(Boolean)).toHaveLength(LIMIT)
    expect(spy).toHaveBeenCalled()
    expect(JSON.stringify(spy.mock.calls)).not.toContain('203.0.113.9') // #540: the error's message is not logged
    spy.mockRestore()
  })

  it('a failed read is retried by the next request, the stored count is not lost for good', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(4_000_000)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage = memory()
    const writer = new NotionLimiter({ storage })
    for (let i = 0; i < 100; i++) await hit(writer) // stored: 100 (rounded up to 109)
    let failures = 1
    const flaky: LimiterStorage = { ...storage, get: async (k: string) => { if (failures-- > 0) throw new Error('read 203.0.113.9'); return storage.get(k) } }
    const limiter = new NotionLimiter({ storage: flaky })
    expect(await hit(limiter)).toBe(true) // the failed read: counted from zero, this once
    let allowed = 0
    while (await hit(limiter)) allowed++
    expect(allowed).toBeLessThanOrEqual(LIMIT - 100) // the second request read the stored count (from zero it would be 119)
    expect(storage.data.get('window')).toMatchObject({ count: expect.any(Number) }) // and the failed read overwrote nothing
    expect(spy.mock.calls).toEqual([['limiter: could not read the window, counting from zero [Error]']]) // #540
    spy.mockRestore()
  })

  it('a failed write is tried again with the next hit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000_000)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage = memory()
    storage.put.mockRejectedValueOnce(new Error('write 203.0.113.9'))
    const limiter = new NotionLimiter({ storage })
    await hit(limiter)
    expect(storage.data.has('window')).toBe(false)
    await hit(limiter)
    expect(storage.data.has('window')).toBe(true)
    expect(spy.mock.calls).toEqual([['limiter: could not write the window, counting in memory only [Error]']]) // #540
    spy.mockRestore()
  })

  it('a stored window start in the future is no window: the client is not locked out', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(6_000_000)
    const storage = memory()
    storage.data.set('window', { windowStart: 6_000_000 + 1e12, count: LIMIT })
    expect(await hit(new NotionLimiter({ storage }))).toBe(true)
    storage.data.set('window', { windowStart: 6_000_000, count: -50 })
    const limiter = new NotionLimiter({ storage })
    let allowed = 0
    while (await hit(limiter)) allowed++
    expect(allowed).toBe(LIMIT) // a negative stored count gives no extra budget
  })

  it('a stored value of the wrong shape is ignored', async () => {
    const storage = memory()
    storage.data.set('window', 'garbage')
    expect(await hit(new NotionLimiter({ storage }))).toBe(true)
  })
})

describe('NotionLimiter cleans up after its window (no client data outlives it, #508)', () => {
  afterEach(() => vi.useRealTimers())

  const hit = async (limiter: NotionLimiter) =>
    ((await (await limiter.fetch(new Request('https://limiter.invalid/hit', { method: 'POST' }))).json()) as { success: boolean }).success
  const memory = () => {
    const data = new Map<string, unknown>()
    const alarm: { at: number | null } = { at: null }
    const storage: LimiterStorage = {
      get: async k => data.get(k),
      put: async (k, v) => { data.set(k, v) },
      setAlarm: async at => { alarm.at = at },
      deleteAll: async () => { data.clear() },
    }
    return { data, alarm, storage }
  }

  it('sets the alarm for the window end before anything is stored, and the alarm after the window deletes everything', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(7_000_000)
    const { data, alarm, storage } = memory()
    const limiter = new NotionLimiter({ storage })
    for (let i = 0; i < 50; i++) await hit(limiter)
    expect(data.size).toBe(1)
    expect(alarm.at).toBe(7_000_000 + LIMIT_PERIOD_SECONDS * 1000)

    vi.setSystemTime(alarm.at!)
    await new NotionLimiter({ storage }).alarm() // a new instance: the object was evicted and the alarm woke it
    expect(data.size).toBe(0) // not a key left, one period after the window began at most
  })

  it('after the cleanup the object counts a fresh window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(8_000_000)
    const { data, alarm, storage } = memory()
    const limiter = new NotionLimiter({ storage })
    for (let i = 0; i < LIMIT + 1; i++) await hit(limiter)
    vi.setSystemTime(alarm.at!)
    await limiter.alarm()
    expect(data.size).toBe(0)
    expect(await hit(limiter)).toBe(true)
    expect(data.size).toBe(1)
    expect(alarm.at).toBe(8_000_000 + LIMIT_PERIOD_SECONDS * 1000 * 2)
  })

  it('an alarm that runs inside a current window keeps its state and sets the alarm again for its end', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(9_000_000)
    const { data, alarm, storage } = memory()
    await hit(new NotionLimiter({ storage }))
    vi.setSystemTime(9_000_000 + 30_000)
    await new NotionLimiter({ storage }).alarm()
    expect(data.size).toBe(1)
    expect(alarm.at).toBe(9_000_000 + 60_000)
  })

  it('an alarm on an empty object stores nothing and a failing read or delete is rethrown for a retry', async () => {
    const { data, storage } = memory()
    await new NotionLimiter({ storage }).alarm()
    expect(data.size).toBe(0)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(new NotionLimiter({ storage: { ...storage, get: async () => { throw new Error('read') } } }).alarm()).rejects.toThrow()
    await expect(new NotionLimiter({ storage: { ...storage, deleteAll: async () => { throw new Error('delete') } } }).alarm()).rejects.toThrow('delete')
    spy.mockRestore()
  })

  it('stores nothing when the alarm cannot be set, and counts in memory', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000_000)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { data, storage } = memory()
    const limiter = new NotionLimiter({ storage: { ...storage, setAlarm: async () => { throw new Error('alarm 203.0.113.9') } } })
    for (let i = 0; i < LIMIT + 1; i++) await hit(limiter)
    expect(data.size).toBe(0)
    expect(await hit(limiter)).toBe(false)
    expect(spy.mock.calls[0]).toEqual(['limiter: could not set the cleanup alarm, counting in memory only [Error]']) // #540
    expect(JSON.stringify(spy.mock.calls)).not.toContain('203.0.113.9')
    spy.mockRestore()
  })
})

describe('limiterName (the object name is no IP)', () => {
  const hex = /^[0-9a-f]{64}$/

  it('is a 64-character hex digest that contains no part of the address', async () => {
    for (const key of ['203.0.113.7', '2001:db8:1:2', 'unknown']) {
      const name = await limiterName(key, 's3cret')
      expect(name).toMatch(hex)
      expect(name).not.toContain(key)
      expect(name).not.toContain(key.replace(/[.:]/g, ''))
    }
  })

  it('is stable per client and secret, and differs by client and by secret', async () => {
    expect(await limiterName('203.0.113.7', 'a')).toBe(await limiterName('203.0.113.7', 'a'))
    expect(await limiterName('203.0.113.7', 'a')).not.toBe(await limiterName('203.0.113.8', 'a'))
    expect(await limiterName('203.0.113.7', 'a')).not.toBe(await limiterName('203.0.113.7', 'b'))
  })

  it('is not the plain sha-256 of the key (the unkeyed hash of an IPv4 address is brute-forceable) and works without a secret', async () => {
    const plain = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('203.0.113.7')))].map(b => b.toString(16).padStart(2, '0')).join('')
    expect(await limiterName('203.0.113.7', 'a')).not.toBe(plain)
    const unkeyed = await limiterName('203.0.113.7')
    expect(unkeyed).toMatch(hex)
    expect(unkeyed).toBe(await limiterName('203.0.113.7', ''))
  })
})

describe('clientKey', () => {
  it('an IPv4 address is its own key', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7')
  })

  it('IPv6 collapses to the /64, however it is written', () => {
    const key = '2001:db8:1:2'
    for (const ip of ['2001:db8:1:2::1', '2001:DB8:1:2:0:0:0:1', '2001:0db8:0001:0002:ffff:ffff:ffff:ffff', '2001:db8:1:2:a:b:c:d%eth0']) {
      expect(clientKey(ip), ip).toBe(key)
    }
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7') // the same client as its plain IPv4
    expect(clientKey('::FFFF:cb00:7107')).toBe('203.0.113.7')
    expect(clientKey('::ffff:999.1.1.1')).toBe('::ffff:999.1.1.1')
    expect(clientKey('::1')).toBe('0:0:0:0')
    expect(clientKey('2001:db8::5')).toBe('2001:db8:0:0')
  })

  it('a missing or malformed value gets a shared key or stays as sent, never throws', () => {
    expect(clientKey(null)).toBe('unknown')
    expect(clientKey('')).toBe('unknown')
    expect(clientKey('1:2:3::4::5')).toBe('1:2:3::4::5')
    expect(clientKey('zzzz::1')).toBe('zzzz::1')
  })
})
