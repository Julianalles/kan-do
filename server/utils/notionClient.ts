import { Client } from '@notionhq/client'
import type { LogLevel } from '@notionhq/client'

/**
 * The one way a server route builds a Notion SDK client (#530). The SDK logs through `console` by default (WARN
 * `request fail: code, message, attempt`, its message can quote the request), and the public Worker persists the
 * console (Workers Logs). The SDK only logs at DEBUG, INFO and WARN, so `logLevel: 'error'` (`LogLevel.ERROR`, written as the literal so a test's `@notionhq/client` mock needs no `LogLevel`) silences it, and the no-op
 * logger keeps a future ERROR line off the console too: a route logs only through `logServerError` (#511).
 *
 * `retry: false` (#539): the SDK would retry a 429 twice by itself (honouring `Retry-After` up to 60 s each), so the proxy
 * would hit Notion three times and wait inside the browser's 10 s timeout before it answered. The proxy throws the first
 * error instead: `handleNotionError` forwards Notion's `Retry-After` and the browser client (`NotionClientAPI`, #507) is
 * the one retry policy.
 */
export function createNotionClient(auth: string, notionVersion: '2025-09-03' | '2022-06-28' = '2025-09-03'): Client {
  return new Client({ auth, notionVersion, logLevel: 'error' as LogLevel, logger: () => {}, retry: false })
}
