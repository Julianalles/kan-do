-- kando-mcp (ADR 023): OAuth state, the command queue and the last board snapshot.
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS commands (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  applied_at INTEGER
);
CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at INTEGER NOT NULL);
