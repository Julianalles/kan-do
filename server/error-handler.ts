import { send, setResponseHeaders, setResponseStatus } from 'h3'
import type { NitroErrorHandler } from 'nitropack/types'
import { logServerError } from './utils/serverLog'

/**
 * Nitro's error handler for every route in a production build (#525). The built-in handler logs an unhandled throw as
 * `[request error] [unhandled] [METHOD] <full URL>` plus the raw error object, and the public Worker persists the
 * console (Workers Logs): the URL query holds database and page ids and property names, the error can quote a request.
 *
 * Setting `nitro.errorHandler` makes Nuxt skip its own handler (`@nuxt/nitro-server` registers it only when none is
 * set), and with it the `/__nuxt_error` page for a failing document request and the `vary` header. So this handler wraps
 * Nuxt's: it logs an unhandled or fatal error only through `logServerError` (route, status, code, like every route,
 * #511), hands Nuxt's handler a `defaultHandler` whose own log is switched off, and sends the built-in JSON response
 * itself where Nuxt's handler leaves a request unhandled (a JSON request) or throws. `nuxt.config.ts` wires Nuxt's
 * handler in (`kan-do:error-handler` virtual module); a build without one gets the JSON response only.
 *
 * Not registered under `nuxt dev`: Nuxt's own error page and full log stay there.
 */
export function createErrorHandler(nuxtHandler?: NitroErrorHandler): NitroErrorHandler {
  return async (error, event, { defaultHandler }) => {
    if (error.unhandled || error.fatal) logServerError(error, event)

    const silentHandler: typeof defaultHandler = (err, ev, opts) => defaultHandler(err, ev, { ...opts, silent: true })

    if (nuxtHandler) {
      // A throw inside Nuxt's handler would reach Nitro's chain, which logs the raw error: keep it away from there.
      try {
        await nuxtHandler(error, event, { defaultHandler: silentHandler })
      }
      catch {
        // fall through to the plain response
      }
      if (event.handled) return
    }

    const res = await silentHandler(error, event)
    setResponseHeaders(event, res.headers)
    setResponseStatus(event, res.status, res.statusText)
    await send(event, typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2))
  }
}

export default createErrorHandler()
