# ADR 023: A remote MCP server lets Claude on the phone read and change the board

## Status

Proposed (branch `claude/feat-mcp-server`, decided with the owner 2026-11-26). Slice 1 (the Worker and the command logic) is built; slice 2 (the desktop bridge transport) is open, see "Not built yet".

## Context

The owner wants to say to Claude on the phone "I'm working on X now" (X into Jetzt, timer running), "I worked on X for 45 minutes yesterday" (time added, board undisturbed), and to add tasks, set status or time box and ask what is on the plate. A remote server cannot reach the data: the desktop app keeps `kan-do-data.json` (ADR 008), the web app `localStorage`, Apple Reminders and local tasks never leave the Mac, and the public Worker `kando` stores nothing of the user's (ADR 021). Notion is the only server-side store, and the owner does not use it. A timer is runtime state of the open app (`lib/taskTimers.ts`), so "start the timer" can only mean "put the card into Jetzt" and let the app count.

Options weighed: (A) Notion as the shared backend (smallest, but only Notion tasks, and the owner would have to move there), (B) a full sync store as a new task source (large: adapter, conflicts, auth in the app), (C) a bridge to the Mac (works only while the Mac is on and the app is open). Chosen: **D, a command queue in a small Worker.**

## Decision

- **Worker `kando-mcp`** (`mcp/`, own `wrangler.jsonc`, D1 database, Workers Free), separate from `kando` so ADR 021's "stores nothing" stays true for the public instance. It holds: OAuth state, a queue of commands, and the last board snapshot (task titles, status, minutes). Never Notion or Todoist tokens, never notes.
- **Write tools queue, the app applies.** `start_work`, `log_time`, `add_task`, `set_status`, `set_timebox` store a command; `lib/remoteCommands.ts` applies it through the app's own operations (`useTaskSync`, `useTaskOperations`), so the one-task Jetzt rule, source push, pending-sync markers and ADR 011's conflict guard are the same as for a user's click. Jetzt occupied: the current task is paused to Wartet, never finished or dropped. Retroactive time adds to the task's total and moves nothing; a missing task is created as Erledigt on the given day (no work sessions are written for it, statistics keep only live tracking). Titles are matched exactly, then by one unique partial match; several candidates fail with the list instead of guessing. Each command carries a client id, the app applies an id once.
- **`get_board`** returns the snapshot, what is queued and the last results (ok or why not), so Claude can say "queued, the Mac is off" instead of claiming success.
- **Transport: outbound only.** The app (never Claude) calls the Worker's `/sync/*` endpoints with the bearer `SYNC_TOKEN`: PUT snapshot, GET commands, POST result. Nothing listens on the Mac. With the Mac off, commands wait and apply at the next start.
- **Auth for the Claude connector: OAuth 2.1, single user.** Claude's custom connector discovers `/.well-known/oauth-*`, registers itself (`/register`, dynamic client registration), sends the owner to `/authorize` (a page asking `OWNER_PASSWORD`, five failures lock it for 15 minutes), and exchanges the code with PKCE S256 (`/token`). Access tokens live 1 h, refresh tokens 90 days and rotate; both are opaque and stored only as SHA-256 hashes. Chosen over a secret-in-URL because the secret never sits in a URL (history, logs, shared screenshots), a token can lapse without changing the connector URL, and it is the flow every Claude client implements. `SYNC_TOKEN` is a different secret so Claude never holds the app's key and the app never holds an OAuth grant.
- **Stateless MCP** (Streamable HTTP, JSON responses, `@modelcontextprotocol/sdk` `WebStandardStreamableHTTPServerTransport`): one server per request, no session to lose between Worker invocations.

## Consequences

- Task titles of today sit in the owner's own D1 database. Delete the database or the Worker to remove them. Workers invocation logs are off.
- A Notion task and a local task behave alike; the bridge needs no integration of its own.
- The board Claude shows is as old as the last time the app synced.
- Commands apply in the order they were queued; an old queued command still applies when the Mac wakes up. `get_board` lists pending commands so the owner can see them.

## Not built yet (slice 2, the desktop bridge)

`lib/remoteCommands.ts` is complete and tested, but nothing in the app calls the Worker yet. What is missing: a composable that uploads `buildSnapshot` (debounced after store changes) and polls `/sync/commands` while the app is open; the `SYNC_TOKEN` in the Keychain (a fifth `SecretEntry` in `src-tauri/src/secrets.rs`, which also touches the identifier migration and its tests, ADR 007 and 019); the Worker origin in the desktop CSP `connect-src` (ADR 012); a settings section to enter the URL and token (copy through the copy-writer skill, both locales); a persisted ledger of applied command ids. Until then the connector reads an empty board and queues commands that nothing applies.
