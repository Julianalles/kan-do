import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The gate's E2E port picker (#349): never a port Chromium blocks, never one already listening.
const script = resolve(__dirname, '../../.claude/hooks/e2e-port.sh')
const pick = (start?: string) => spawnSync('/bin/bash', [script], {
  encoding: 'utf8',
  env: { ...process.env, ...(start ? { E2E_PORT_START: start } : {}) },
})

describe('e2e-port.sh', () => {
  it('skips 3659 (apple-sasl, ERR_UNSAFE_PORT) when it would be the first pick', () => {
    const result = pick('3659')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('3660')
  })

  it('always lands in 3200-3899 and never on a blocked port', () => {
    for (let i = 0; i < 30; i++) {
      const port = Number(pick().stdout.trim())
      expect(port).toBeGreaterThanOrEqual(3200)
      expect(port).toBeLessThan(3900)
      expect(port).not.toBe(3659)
    }
  })

  it('skips a port that is already listening', async () => {
    const server = createServer()
    await new Promise<void>(res => server.listen(3700, '127.0.0.1', res))
    try {
      const result = pick('3700')
      expect(result.stdout.trim()).toBe('3701')
    }
    finally {
      server.close()
    }
  })
})
