/** Worker `kando-mcp` (ADR 023): remote MCP server for Claude plus the sync endpoints of the desktop app. */
import { handle, type AppEnv } from './app'
import { D1Store } from './store'

interface Env extends AppEnv {
  DB: ConstructorParameters<typeof D1Store>[0]
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, { store: new D1Store(env.DB), env })
  },
}
