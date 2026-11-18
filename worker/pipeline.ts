/**
 * The Worker's request path (#502, #503): gate, then origin check, then rate limit, then the app. The entry
 * (`index.ts`) only supplies Nitro's handler, so the order is unit-testable without the built bundle.
 */
import { handle, type AppHandler, type GateEnv } from './gate'
import { guard, type GuardEnv } from './guards'

export type WorkerEnv = GateEnv & GuardEnv

export function handleRequest(request: Request, env: WorkerEnv, app: AppHandler): Promise<Response> {
  return handle(request, env, req => guard(req, env, app))
}
