import { Client } from '@notionhq/client'
import type { LogLevel } from '@notionhq/client'

/**
 * The one way a server route builds a Notion SDK client (#530). The SDK logs through `console` by default (WARN
 * `request fail: code, message, attempt`, its message can quote the request), and the public Worker persists the
 * console (Workers Logs). The SDK only logs at DEBUG, INFO and WARN, so `logLevel: 'error'` (`LogLevel.ERROR`, written as the literal so a test's `@notionhq/client` mock needs no `LogLevel`) silences it, and the no-op
 * logger keeps a future ERROR line off the console too: a route logs only through `logServerError` (#511).
 */
export function createNotionClient(auth: string, notionVersion: '2025-09-03' | '2022-06-28' = '2025-09-03'): Client {
  return new Client({ auth, notionVersion, logLevel: 'error' as LogLevel, logger: () => {} })
}
