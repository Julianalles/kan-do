/**
 * Storage behind the MCP Worker (ADR 023). One interface, two implementations: `D1Store` (production) and `MemoryStore`
 * (unit tests). The Worker keeps three things: a short-lived key/value area (OAuth clients, codes, tokens), the queue of
 * commands the desktop app applies, and the last board snapshot the app uploaded.
 */

export type CommandType = 'start_work' | 'log_time' | 'add_task' | 'set_status' | 'set_timebox'

export interface Command {
  /** Client-generated id; the app applies each id once (idempotent). */
  id: string
  type: CommandType
  /** Validated by the tool layer, interpreted by the app (`lib/remoteCommands.ts`). */
  payload: Record<string, unknown>
  createdAt: number
}

export interface CommandResult {
  ok: boolean
  /** Human readable outcome, shown back to Claude by `get_board`. */
  message: string
}

export interface StoredCommand extends Command {
  status: 'pending' | 'applied' | 'failed'
  result: CommandResult | null
  appliedAt: number | null
}

export interface Store {
  kvGet(key: string): Promise<string | null>
  kvPut(key: string, value: string, ttlSeconds: number): Promise<void>
  kvDelete(key: string): Promise<void>

  enqueue(command: Command): Promise<void>
  /** Oldest first. */
  pending(limit: number): Promise<StoredCommand[]>
  recent(limit: number): Promise<StoredCommand[]>
  /** Marks a pending command as finished; false when the id is unknown or was already finished. */
  settle(id: string, result: CommandResult, now: number): Promise<boolean>

  putSnapshot(json: string, now: number): Promise<void>
  getSnapshot(): Promise<{ json: string; updatedAt: number } | null>
}

/** Commands older than this are dropped from the queue's history. */
export const HISTORY_LIMIT = 50

export class MemoryStore implements Store {
  private kv = new Map<string, { value: string; expires: number }>()
  private commands: StoredCommand[] = []
  private snapshot: { json: string; updatedAt: number } | null = null
  /** Tests move the clock through this. */
  now: () => number = () => Date.now()

  async kvGet(key: string) {
    const hit = this.kv.get(key)
    if (!hit) return null
    if (hit.expires <= this.now()) {
      this.kv.delete(key)
      return null
    }
    return hit.value
  }

  async kvPut(key: string, value: string, ttlSeconds: number) {
    this.kv.set(key, { value, expires: this.now() + ttlSeconds * 1000 })
  }

  async kvDelete(key: string) {
    this.kv.delete(key)
  }

  async enqueue(command: Command) {
    if (this.commands.some(c => c.id === command.id)) return
    this.commands.push({ ...command, status: 'pending', result: null, appliedAt: null })
  }

  async pending(limit: number) {
    return this.commands.filter(c => c.status === 'pending').slice(0, limit)
  }

  async recent(limit: number) {
    return this.commands.slice(-limit).reverse()
  }

  async settle(id: string, result: CommandResult, now: number) {
    const command = this.commands.find(c => c.id === id)
    if (!command || command.status !== 'pending') return false
    command.status = result.ok ? 'applied' : 'failed'
    command.result = result
    command.appliedAt = now
    return true
  }

  async putSnapshot(json: string, now: number) {
    this.snapshot = { json, updatedAt: now }
  }

  async getSnapshot() {
    return this.snapshot
  }
}

/** Minimal D1 surface the store uses, so tests need no workers types. */
interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>
      all<T = unknown>(): Promise<{ results: T[] }>
      run(): Promise<{ meta: { changes?: number } }>
    }
  }
}

interface CommandRow {
  id: string
  type: CommandType
  payload: string
  created_at: number
  status: StoredCommand['status']
  result: string | null
  applied_at: number | null
}

const fromRow = (row: CommandRow): StoredCommand => ({
  id: row.id,
  type: row.type,
  payload: JSON.parse(row.payload) as Record<string, unknown>,
  createdAt: row.created_at,
  status: row.status,
  result: row.result === null ? null : (JSON.parse(row.result) as CommandResult),
  appliedAt: row.applied_at,
})

export class D1Store implements Store {
  constructor(private readonly db: D1Like) {}

  async kvGet(key: string) {
    const row = await this.db.prepare('SELECT v FROM kv WHERE k = ?1 AND exp > ?2').bind(key, Date.now()).first<{ v: string }>()
    return row?.v ?? null
  }

  async kvPut(key: string, value: string, ttlSeconds: number) {
    const now = Date.now()
    await this.db.prepare('INSERT INTO kv (k, v, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, exp = ?3')
      .bind(key, value, now + ttlSeconds * 1000).run()
    // Expired rows go with the next write: no cron needed for a single-user store.
    await this.db.prepare('DELETE FROM kv WHERE exp <= ?1').bind(now).run()
  }

  async kvDelete(key: string) {
    await this.db.prepare('DELETE FROM kv WHERE k = ?1').bind(key).run()
  }

  async enqueue(command: Command) {
    await this.db.prepare('INSERT OR IGNORE INTO commands (id, type, payload, created_at, status) VALUES (?1, ?2, ?3, ?4, \'pending\')')
      .bind(command.id, command.type, JSON.stringify(command.payload), command.createdAt).run()
  }

  async pending(limit: number) {
    const { results } = await this.db.prepare('SELECT * FROM commands WHERE status = \'pending\' ORDER BY seq ASC LIMIT ?1').bind(limit).all<CommandRow>()
    return results.map(fromRow)
  }

  async recent(limit: number) {
    const { results } = await this.db.prepare('SELECT * FROM commands ORDER BY seq DESC LIMIT ?1').bind(limit).all<CommandRow>()
    return results.map(fromRow)
  }

  async settle(id: string, result: CommandResult, now: number) {
    const run = await this.db.prepare('UPDATE commands SET status = ?2, result = ?3, applied_at = ?4 WHERE id = ?1 AND status = \'pending\'')
      .bind(id, result.ok ? 'applied' : 'failed', JSON.stringify(result), now).run()
    await this.db.prepare('DELETE FROM commands WHERE seq <= (SELECT MAX(seq) FROM commands) - ?1').bind(HISTORY_LIMIT).run()
    return (run.meta.changes ?? 0) > 0
  }

  async putSnapshot(json: string, now: number) {
    await this.db.prepare('INSERT INTO snapshot (id, json, updated_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET json = ?1, updated_at = ?2')
      .bind(json, now).run()
  }

  async getSnapshot() {
    const row = await this.db.prepare('SELECT json, updated_at FROM snapshot WHERE id = 1').bind().first<{ json: string; updated_at: number }>()
    return row ? { json: row.json, updatedAt: row.updated_at } : null
  }
}
