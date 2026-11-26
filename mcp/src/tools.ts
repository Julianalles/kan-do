/**
 * The MCP tools (ADR 023). Write tools do not touch the board: they queue a command that the desktop app applies through its
 * normal paths (`lib/remoteCommands.ts`), so the one-task-in-Jetzt rule, source sync and conflict safety stay in one place.
 * `get_board` reads the snapshot the app uploaded last and names what is still queued.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CommandType, Store } from './store'

export const STATUSES = ['open', 'progress', 'waiting', 'done'] as const
export type BoardStatus = (typeof STATUSES)[number]

const STATUS_LABEL: Record<BoardStatus, string> = { open: 'Offen', progress: 'Jetzt', waiting: 'Wartet', done: 'Erledigt' }

export const snapshotSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tasks: z.array(z.object({
    id: z.string().max(200),
    title: z.string().max(500),
    status: z.enum(STATUSES),
    timeBoxMinutes: z.number().nullable(),
    timeSpentMinutes: z.number(),
    topic: z.string().max(200).nullable(),
    source: z.string().max(50),
  })).max(300),
})
export type Snapshot = z.infer<typeof snapshotSchema>

const title = z.string().trim().min(1).max(500).describe('Task title as the user says it. Matched against existing tasks (exact, then contains, case-insensitive).')
const minutes = z.number().int().min(1).max(24 * 60)
const status = z.enum(STATUSES).describe('open = Offen, progress = Jetzt, waiting = Wartet, done = Erledigt')

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] })

export interface ToolContext {
  store: Store
  now: () => number
  newId: () => string
}

export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'kan-do', version: '1.0.0' })

  const queue = async (type: CommandType, payload: Record<string, unknown>, summary: string) => {
    const id = ctx.newId()
    await ctx.store.enqueue({ id, type, payload, createdAt: ctx.now() })
    const snapshot = await ctx.store.getSnapshot()
    const hint = snapshot === null
      ? 'kan-do has not synced yet.'
      : `kan-do last synced ${Math.round((ctx.now() - snapshot.updatedAt) / 60000)} min ago.`
    return text(`Queued: ${summary} (command ${id}). kan-do applies it the next time the app is open and online. ${hint} Check get_board to see the result.`)
  }

  server.registerTool('get_board', {
    description: "Today's kan-do board (columns Offen, Jetzt, Wartet, Erledigt) as the app last reported it, plus commands that are queued or recently finished. Use it to answer what is on the plate.",
    annotations: { readOnlyHint: true },
  }, async () => {
    const [snapshot, pending, recent] = await Promise.all([ctx.store.getSnapshot(), ctx.store.pending(20), ctx.store.recent(10)])
    const lines: string[] = []
    if (snapshot === null) {
      lines.push('No board yet: the kan-do app has not synced.')
    } else {
      const board = JSON.parse(snapshot.json) as Snapshot
      lines.push(`Board for ${board.day} (as of ${new Date(snapshot.updatedAt).toISOString()}):`)
      for (const s of STATUSES) {
        const tasks = board.tasks.filter(t => t.status === s)
        lines.push(`${STATUS_LABEL[s]} (${tasks.length})`)
        for (const t of tasks) {
          const bits = [t.timeBoxMinutes ? `box ${t.timeBoxMinutes} min` : null, t.timeSpentMinutes ? `spent ${t.timeSpentMinutes} min` : null, t.topic].filter(Boolean)
          lines.push(`- ${t.title}${bits.length ? ` (${bits.join(', ')})` : ''}`)
        }
      }
    }
    if (pending.length) lines.push(`Queued, not applied yet: ${pending.map(c => `${c.type} ${JSON.stringify(c.payload)}`).join('; ')}`)
    const finished = recent.filter(c => c.status !== 'pending')
    if (finished.length) lines.push(`Recent results: ${finished.map(c => `${c.type}: ${c.result?.ok ? 'ok' : 'FAILED'} ${c.result?.message ?? ''}`).join(' | ')}`)
    return text(lines.join('\n'))
  })

  server.registerTool('start_work', {
    description: 'The user is working on a task now: put it into Jetzt and start its timer. Creates the task when none matches. Jetzt holds one task, so a task already in Jetzt is paused to Wartet.',
    inputSchema: { title, timeBoxMinutes: minutes.optional().describe('Planned time box for a newly created task') },
  }, ({ title: name, timeBoxMinutes }) => queue('start_work', { title: name, ...(timeBoxMinutes ? { timeBoxMinutes } : {}) }, `start working on "${name}"`))

  server.registerTool('log_time', {
    description: 'Add time the user already spent on a task ("I worked on X for 45 minutes yesterday"). Adds to the time spent without moving the task; creates it as Erledigt on that day when no task matches.',
    inputSchema: {
      title,
      minutes,
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Local day YYYY-MM-DD the work happened on; only used when the task has to be created. Default today.'),
    },
  }, ({ title: name, minutes: m, day }) => queue('log_time', { title: name, minutes: m, ...(day ? { day } : {}) }, `add ${m} min to "${name}"`))

  server.registerTool('add_task', {
    description: 'Add a task to the board (default column Offen, planned for today).',
    inputSchema: {
      title,
      status: status.optional(),
      timeBoxMinutes: minutes.optional(),
      topic: z.string().trim().max(200).optional(),
      notes: z.string().max(5000).optional(),
    },
  }, ({ title: name, ...rest }) => queue('add_task', { title: name, ...rest }, `add task "${name}"`))

  server.registerTool('set_status', {
    description: 'Move a task to Offen, Jetzt, Wartet or Erledigt. Moving into Jetzt follows the one-task rule (the current Jetzt task is paused).',
    inputSchema: { title, status },
  }, ({ title: name, status: s }) => queue('set_status', { title: name, status: s }, `move "${name}" to ${STATUS_LABEL[s]}`))

  server.registerTool('set_timebox', {
    description: 'Set the planned time box of a task in minutes.',
    inputSchema: { title, minutes },
  }, ({ title: name, minutes: m }) => queue('set_timebox', { title: name, minutes: m }, `set time box of "${name}" to ${m} min`))

  return server
}
