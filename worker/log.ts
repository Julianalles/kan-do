/**
 * The one way the Worker logs a failure (#540). Workers Logs persist the console and the Worker stores nothing of a
 * visitor (epic #279, ADR 021), so a log line is a constant message from the call site plus the error's `name` when it
 * is a plain identifier: never the error object, its message, stack, `cause` or properties, which can quote request
 * data. Mirrors `server/utils/serverLog.ts`; `log.test.ts` fails when another worker file calls `console.`.
 * No Node-only imports: this runs in the Worker.
 */

/** An error class name such as `TypeError` or `DurableObjectResetError`; anything else is not trusted. */
const ERROR_NAME = /^[A-Za-z]{1,40}$/

function nameOf(error: unknown): string {
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined
  return typeof name === 'string' && ERROR_NAME.test(name) ? name : 'UnknownError'
}

/** Logs `<message> [<ErrorName>]`, or the message alone when there is no error. `message` must be a constant. */
export function logWorkerError(message: string, ...rest: [error?: unknown]): void {
  console.error(rest.length === 0 ? message : `${message} [${nameOf(rest[0])}]`)
}
