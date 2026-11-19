import { send, setResponseHeaders, setResponseStatus } from 'h3'
import type { NitroErrorHandler } from 'nitropack/types'
import { logServerError } from './utils/serverLog'

/**
 * Nitro's error handler for every route (`nitro.errorHandler` in `nuxt.config.ts`, #525). The built-in handler logs an
 * unhandled throw as `[request error] [unhandled] [METHOD] <full URL>` plus the raw error object, and the public Worker
 * persists the console (Workers Logs): the URL query holds database and page ids and property names, the error can quote
 * a request. This handler sends the same response through the built-in `defaultHandler` with its log switched off and
 * logs an unhandled or fatal error only through `logServerError` (route, status, code), like every route does (#511).
 *
 * Production only: `nuxt dev` keeps Nitro's own error page and its full log.
 */
const errorHandler: NitroErrorHandler = async (error, event, { defaultHandler }) => {
  if (import.meta.dev) return

  const res = await defaultHandler(error, event, { silent: true })
  if (error.unhandled || error.fatal) logServerError(error, event)

  setResponseHeaders(event, res.headers)
  setResponseStatus(event, res.status, res.statusText)
  await send(event, typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2))
}

export default errorHandler
