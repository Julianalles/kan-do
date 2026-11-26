# kando-mcp

Remote MCP server for Claude (phone, web, desktop), see [ADR 023](../docs/adr/023-mcp-server-for-claude.md). Tools: `get_board`, `start_work`, `log_time`, `add_task`, `set_status`, `set_timebox`.

```
Claude ── OAuth + MCP over HTTPS ──▶ kando-mcp (Worker + D1) ◀── snapshot / commands, bearer SYNC_TOKEN ── kan-do desktop app
```

## Deploy (by hand, once)

Nothing here deploys automatically and nothing has been created yet. You need a Cloudflare account and `wrangler login` (or `CLOUDFLARE_API_TOKEN`).

```bash
npx wrangler d1 create kando-mcp
```

Copy the printed `database_id` into `mcp/wrangler.jsonc` (replace `REPLACE_WITH_D1_ID`).

```bash
npx wrangler d1 migrations apply kando-mcp --remote -c mcp/wrangler.jsonc
```

```bash
npx wrangler secret put OWNER_PASSWORD -c mcp/wrangler.jsonc
```

```bash
openssl rand -base64 32 | npx wrangler secret put SYNC_TOKEN -c mcp/wrangler.jsonc
```

```bash
npx wrangler deploy -c mcp/wrangler.jsonc
```

The URL is `https://kando-mcp.<your-subdomain>.workers.dev`; the MCP endpoint is `/mcp`. Keep the `SYNC_TOKEN` value: you paste it into Kan-do (below); `OWNER_PASSWORD` is only typed on the consent page.

Local run: put both secrets in `mcp/.dev.vars` (git-ignored), then `npx wrangler d1 migrations apply kando-mcp --local -c mcp/wrangler.jsonc` and `npx wrangler dev -c mcp/wrangler.jsonc`.

## Connect the desktop app

In Kan-do (desktop app), Einstellungen, Verwalten, "Claude-Anbindung": paste the Worker address and the `SYNC_TOKEN`, then "Verbinden". The token goes to the macOS Keychain and is never shown again. The app polls the Worker every 30 seconds while it is open, applies what Claude queued and uploads today's board. "Anbindung aktiv" switches it off, "Trennen" forgets address and token. Commands wait in the queue while the app is closed.

## Add it as a connector

Custom connectors are added on the web or desktop and then show up on the phone with the same account (a Pro, Max, Team or Enterprise plan; Team and Enterprise owners add it for the organisation first).

1. claude.ai, Settings, Connectors, "Add custom connector".
2. Name `kan-do`, URL `https://kando-mcp.<your-subdomain>.workers.dev/mcp`. Leave the OAuth client fields empty (the server registers the client itself).
3. Connect: a page opens asking for the password (`OWNER_PASSWORD`). Enter it once.
4. In the Claude app on the phone the connector is available in a chat via the tools menu. Try "What is on my plate?" or "I'm working on the Müller quote now".

Revoke: remove the connector in Claude and rotate `OWNER_PASSWORD`; tokens already issued expire on their own (access 1 h, refresh 90 days). Rotating is also wise when the password has been shown anywhere.

## Checks

`npx vitest run tests/mcp tests/lib/remoteCommands.test.ts` and `npm run typecheck` (includes `tsc -p mcp`).
