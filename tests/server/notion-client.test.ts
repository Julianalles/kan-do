// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { Client } from '@notionhq/client'
import { createNotionClient } from '~/server/utils/notionClient'

/**
 * #530: the Notion SDK logs a WARN `request fail` (code, message, attempt; the message can quote the request) through
 * `console` by default, and the public Worker persists the console. Every client in `server/` comes from one factory.
 */
const TITLE = 'Quarterly salary review for Jane'
const root = resolve(__dirname, '../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path)
    return /\.(ts|vue|mjs)$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

describe('createNotionClient (#530)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function failingNotion(status: number) {
    // The SDK binds `fetch` when the client is built: stub it first
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ object: 'error', status, code: 'object_not_found', message: `could not find ${TITLE}` }),
      { status, headers: { 'content-type': 'application/json' } },
    )))
    return (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}))
  }

  it.each([404, 400])('a failed %i request writes nothing to the console at any level', async (status) => {
    const spies = failingNotion(status)
    const notion = createNotionClient('secret_token', '2025-09-03')
    await expect(notion.request({ method: 'get', path: 'pages/p1' })).rejects.toMatchObject({ status })
    expect(spies.flatMap(s => s.mock.calls)).toEqual([])
  })

  it('control: a client built without the factory does log the failure, quoting the message', async () => {
    const spies = failingNotion(404)
    const notion = new Client({ auth: 'secret_token' })
    await expect(notion.request({ method: 'get', path: 'pages/p1' })).rejects.toBeTruthy()
    expect(JSON.stringify(spies.flatMap(s => s.mock.calls))).toContain(TITLE)
  })

  it('no route builds a Client itself: `new Client(` appears only in the factory', () => {
    const offenders = sourceFiles(join(root, 'server'))
      .filter(file => /\bnew Client\(/.test(readFileSync(file, 'utf8')))
      .map(file => relative(root, file))
    expect(offenders).toEqual(['server/utils/notionClient.ts'])
  })
})
