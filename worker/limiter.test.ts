// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { LIMIT, LIMIT_PERIOD_SECONDS, NotionLimiter, WindowCounter, clientKey } from './limiter'

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

describe('clientKey', () => {
  it('an IPv4 address is its own key', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7')
  })

  it('IPv6 collapses to the /64, however it is written', () => {
    const key = '2001:db8:1:2'
    for (const ip of ['2001:db8:1:2::1', '2001:DB8:1:2:0:0:0:1', '2001:0db8:0001:0002:ffff:ffff:ffff:ffff', '2001:db8:1:2:a:b:c:d%eth0']) {
      expect(clientKey(ip), ip).toBe(key)
    }
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
