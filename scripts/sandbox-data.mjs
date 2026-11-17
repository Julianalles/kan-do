#!/usr/bin/env node
/**
 * Writes a desktop data folder with a Local board and one task in Jetzt, for a sandboxed `tauri dev` run
 * (docs/testing/tauri-dev-sandbox.md "Reaching a Jetzt task", #457). A fresh sandbox HOME is a first run
 * (`needsInit`, welcome page) and `?seed` does nothing in the invisible window, so a run that needs a board
 * (overlay.rs `create_window`, window events) starts from this folder instead.
 *
 *   node scripts/sandbox-data.mjs <folder> [--no-jetzt]
 *
 * `<folder>` is the sandbox's app data folder, `$SANDBOX/Library/Application Support/<identifier>`. The script
 * refuses any folder outside the OS temp dir, so it can never write the user's real data. Plain Node, no imports
 * from the app: the envelope shape is `utils/dataFile/envelope.ts`, the stores are `tests/e2e/helpers/seed.ts`.
 */
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

const args = process.argv.slice(2)
const withJetzt = !args.includes('--no-jetzt')
const target = args.find((a) => !a.startsWith('--'))
if (!target) {
  console.error('usage: node scripts/sandbox-data.mjs <folder> [--no-jetzt]')
  process.exit(2)
}
const folder = resolve(target)
const roots = [tmpdir(), '/tmp', '/private/tmp', '/var/folders'].map((p) => { try { return realpathSync(p) } catch { return p } })
// check before creating anything: the nearest existing ancestor decides (symlinks resolved)
let probe = folder
while (!existsSync(probe)) probe = dirname(probe)
const real = realpathSync(probe)
if (!roots.some((root) => real === root || real.startsWith(root + sep))) {
  console.error(`refusing ${real}: not under the OS temp dir (this script writes sandbox folders only)`)
  process.exit(2)
}
mkdirSync(folder, { recursive: true })

const now = new Date().toISOString()
const task = (id, title, status, spent = 0) => ({
  id, source: 'local', externalId: null, title, status, priority: 2, activity: null, topic: null, topicColorCode: null,
  timeSpentSeconds: spent, timeBoxSeconds: status === 1 ? 3600 : null, custom: {}, createdAt: now, updatedAt: now,
})
const tasks = [task('sandbox-open-1', 'Offene Aufgabe', 0)]
if (withJetzt) tasks.push(task('sandbox-jetzt-1', 'Jetzt-Aufgabe', 1, 600))
const byStatus = (s) => tasks.filter((t) => t.status === s).map((t) => t.id)
const stores = {
  'board-store': {
    boardConfig: { sources: { connected: [], default: 'local' } },
    columns: [
      { idClassSuffix: 'open', taskStatus: 0, taskOrder: byStatus(0), taskPositions: {} },
      { idClassSuffix: 'progress', taskStatus: 1, taskOrder: byStatus(1), taskPositions: {} },
      { idClassSuffix: 'waiting', taskStatus: 2, taskOrder: byStatus(2), taskPositions: {} },
      { idClassSuffix: 'done', taskStatus: 3, taskOrder: byStatus(3), taskPositions: {} },
    ],
    grouping: { enabled: false, key: null },
  },
  'tasks-store': {
    carryOverByTaskId: {}, pendingDeletes: {}, tasks, isLoading: false, lastSyncTimestamp: null, archivedTaskIds: [],
    deletedTaskIds: [], pendingTimeUpdates: {}, customPropertyIndexes: {}, taskOperationVersions: {}, batchOperationInProgress: false,
  },
  'settings-store': { focusEnabled: false, floatingNowEnabled: true },
}
const envelope = { schemaVersion: 2, writtenAt: now, writtenBy: 'sandbox-data', appVersion: '0.0.0', stores }
writeFileSync(join(folder, 'kan-do-data.json'), JSON.stringify(envelope, null, 2))
writeFileSync(join(folder, 'data-location.json'), JSON.stringify({ folder, deviceId: 'sandbox-device' }))
console.log(`wrote ${folder} (${tasks.length} tasks${withJetzt ? ', one in Jetzt' : ''})`)
