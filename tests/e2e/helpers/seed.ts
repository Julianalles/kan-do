/**
 * @module seed
 * @description Shared E2E seed helpers for Playwright tests.
 *
 * Provides reusable functions to seed localStorage with board + task state,
 * eliminating copy-pasted setup boilerplate across spec files.
 *
 * Prefer the context-based helpers (seedLocalBoard, seedNotionBoard)
 * which use addInitScript — they run before any page JS and require no extra navigation.
 * For reload-based specs prefer `seedLocalBoard(..., { once: true })`.
 */

import type { BrowserContext } from '@playwright/test'
import { NOTION_STUB_API_KEY } from './constants'
import { installTauriStub, type ReminderStub, type RemindersAccess, type RemindersListStub } from './tauriStub'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeedTask {
  id: string
  /** Where the task lives (#326); `buildTasksStore` fills it from the board's source when missing. */
  source?: 'local' | 'notion' | 'todoist' | 'reminders'
  externalId?: string | null
  title: string
  status: 0 | 1 | 2 | 3
  priority: number
  timeSpentSeconds: number
  timeBoxSeconds: number | null
  activity?: string | null
  topic?: string | null
  topicColorCode?: string | null
  notes?: string | null
  isUnplanned?: boolean
  /** Not planned for today (#353): held by kan-do but in no column. Only with `status: 0`. */
  notPlanned?: true
  custom: Record<string, unknown>
  completedAt?: string | null
  createdAt?: string
  updatedAt?: string
  /** Unsaved changes the source does not hold (#319); a `lastError` makes the card show the cloud. */
  pendingSync?: { since: number, attempts: number, lastError: string | null }
}

interface NotionSeedConfig {
  token: string
  databaseId: string
  dataSourceId: string | null
  propertyMapping: {
    title: string
    status: string
    dueDate: null
    priority: null
    timeBox: string | null
    timeSpent: string | null
    timeSpentUnit: string
    customProperties: unknown[]
  }
  statusMapping: {
    today: string
    doing: string
    done: string
    waiting: string
  }
}

// ---------------------------------------------------------------------------
// Default fixture tasks — covers all 4 columns (Offen / Jetzt / Wartet / Erledigt)
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString()
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString()

export const SEED_TASKS: SeedTask[] = [
  {
    // Rich task: activity + topic set, no timebox
    id: 'seed-open-1',
    title: 'Konzept ausarbeiten',
    status: 0,
    priority: 2,
    activity: 'Planung',
    topic: 'Design',
    topicColorCode: '#6366f1',
    notes: 'Entwurf bis Ende der Woche fertigstellen.',
    timeSpentSeconds: 0,
    timeBoxSeconds: null,
    custom: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    // Timebox set, no time used yet
    id: 'seed-open-2',
    title: 'Dokumentation lesen',
    status: 0,
    priority: 3,
    activity: null,
    topic: null,
    topicColorCode: null,
    timeSpentSeconds: 0,
    timeBoxSeconds: 2700,
    custom: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    // In progress: timebox with partial time already used (only 1 task in status 1)
    id: 'seed-progress-1',
    title: 'Review schreiben',
    status: 1,
    priority: 1,
    activity: 'Entwicklung',
    topic: 'Backend',
    topicColorCode: '#10b981',
    timeSpentSeconds: 1800,
    timeBoxSeconds: 3600,
    custom: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'seed-waiting-1',
    title: 'Blocker klären',
    status: 2,
    priority: 2,
    activity: null,
    topic: null,
    topicColorCode: null,
    notes: 'Warte auf Rückmeldung vom Team.',
    timeSpentSeconds: 0,
    timeBoxSeconds: null,
    custom: {},
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'seed-done-1',
    title: 'Retrospektive nachbereiten',
    status: 3,
    priority: 3,
    activity: 'Planung',
    topic: null,
    topicColorCode: null,
    timeSpentSeconds: 3600,
    timeBoxSeconds: 3600,
    custom: {},
    completedAt: NOW,
    createdAt: YESTERDAY,
    updatedAt: NOW,
  },
  {
    id: 'seed-done-2',
    title: 'CI Pipeline optimieren',
    status: 3,
    priority: 3,
    activity: null,
    topic: null,
    topicColorCode: null,
    timeSpentSeconds: 1800,
    timeBoxSeconds: 1800,
    custom: {},
    completedAt: YESTERDAY,
    createdAt: YESTERDAY,
    updatedAt: YESTERDAY,
  },
]

/**
 * `n` plain filler tasks in one column, for specs that need a column tall enough to scroll (#231).
 * Ids are `filler-<status>-<i>`, titles `Filler <i>`.
 */
export function fillerTasks(n: number, status: 0 | 1 | 2 | 3 = 0): SeedTask[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `filler-${status}-${i}`,
    title: `Filler ${i}`,
    status,
    priority: 2,
    timeSpentSeconds: 0,
    timeBoxSeconds: null,
    custom: {},
  }))
}

/** A sentence long enough to hit the card's line clamp when repeated (#282). */
export const LONG_TITLE = 'Dieser sehr lange Aufgabentitel läuft über mehrere Zeilen und erreicht die Zeilenbegrenzung der Karte sicher '

/** A title that wraps to three lines in a card (#270, #282); the clamp stays out of reach. */
export const LONG_TITLE_3_LINE = LONG_TITLE.slice(0, 66)

/**
 * A stack of three tasks whose front card has a long title (#282). `withTopic` stacks them by topic
 * (group by `topic`), otherwise they are topic-less and stack by group-by `priority`. Pass a
 * different `frontTitle` for other lengths.
 */
export function longTitleStackSeed(
  status: 0 | 1 | 2 | 3 = 0,
  { withTopic = true, frontTitle = LONG_TITLE_3_LINE }: { withTopic?: boolean, frontTitle?: string } = {},
): SeedTask[] {
  const at = new Date().toISOString()
  const task = (id: string, title: string): SeedTask => ({
    id,
    title,
    status,
    priority: 1,
    activity: null,
    topic: withTopic ? 'Design' : null,
    topicColorCode: null,
    timeSpentSeconds: 0,
    timeBoxSeconds: null,
    custom: {},
    createdAt: at,
    updatedAt: at,
  })
  return [task('s1', frontTitle), task('s2', 'Zwei'), task('s3', 'Drei')]
}

// ---------------------------------------------------------------------------
// Mixed board fixture (#326): Local tasks next to the Notion stub's own pages
// ---------------------------------------------------------------------------

const mixedTask = (task: Pick<SeedTask, 'id' | 'title' | 'status'> & Partial<SeedTask>): SeedTask => ({
  priority: 2,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  custom: {},
  createdAt: NOW,
  updatedAt: NOW,
  ...task,
})

/**
 * Local and Notion tasks with an explicit `source`/`externalId`. The Notion tasks are the stub's own
 * pages (`tests/fixtures/notion/tasks.json`, same ids, titles and statuses), so a Notion fetch keeps
 * them in place instead of replacing them. Only one task sits in Jetzt (the Notion one).
 */
export const MIXED_SEED_TASKS: SeedTask[] = [
  mixedTask({ id: 'page-1', title: 'Fokusaufgabe vorbereiten', status: 0, source: 'notion', externalId: 'page-1' }),
  mixedTask({ id: 'page-2', title: 'Review Team Updates', status: 1, source: 'notion', externalId: 'page-2' }),
  mixedTask({ id: 'page-3', title: 'Blocker klären', status: 2, source: 'notion', externalId: 'page-3' }),
  mixedTask({ id: 'page-4', title: 'Retrospektive nachbereiten', status: 3, source: 'notion', externalId: 'page-4', completedAt: NOW }),
  mixedTask({ id: 'local-open-1', title: 'Lokal: Einkauf planen', status: 0, source: 'local', externalId: null }),
  mixedTask({ id: 'local-waiting-1', title: 'Lokal: Antwort abwarten', status: 2, source: 'local', externalId: null }),
  mixedTask({ id: 'local-done-1', title: 'Lokal: Wäsche erledigt', status: 3, source: 'local', externalId: null, completedAt: NOW }),
]

/** Id of the worst-case footer card (#323). */
export const WORST_CASE_FOOTER_ID = 'worst-case-footer'

/**
 * The fullest card footer there is (#323): activity badge, priority 3, timebox, a Notion source with a
 * refused push (cloud) and a carried-over counter at the dot cap (6 dots, "+", numeral; pair it with
 * `WORST_CASE_FOOTER_CARRY_OVER`). It sits first in Offen of the mixed board, next to a plain card of the
 * same title length for height comparisons.
 */
export const WORST_CASE_FOOTER_TASKS: SeedTask[] = [
  mixedTask({
    id: WORST_CASE_FOOTER_ID,
    title: 'Worst Case: Footer voll',
    status: 0,
    priority: 3,
    activity: 'Konzeption und Abstimmung',
    timeBoxSeconds: 5400,
    source: 'notion',
    externalId: WORST_CASE_FOOTER_ID,
    pendingSync: { since: 1778925600000, attempts: 1, lastError: 'Notion lehnt die Änderung ab' },
  }),
  mixedTask({ id: 'plain-footer', title: 'Worst Case: Footer leer', status: 0, source: 'local', externalId: null }),
]

/** A carried-over counter that reads as `days` board days today (`displayDay === days`), so a board load adds none. */
export function carriedOverDays(days: number): SeedCarryOver {
  const key = (offsetDays: number) => {
    const d = new Date(Date.now() + offsetDays * 86_400_000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return { firstOn: key(-days), days, lastOn: key(0), keptAtDays: null }
}

/** Carry-over counters of `WORST_CASE_FOOTER_TASKS`: stored `days` 7 reads as board day 8 (6 dots, "+", the numeral). */
export const WORST_CASE_FOOTER_CARRY_OVER: Record<string, SeedCarryOver> = {
  [WORST_CASE_FOOTER_ID]: carriedOverDays(7),
}

// ---------------------------------------------------------------------------
// Store shape builders
// ---------------------------------------------------------------------------

/** Column grouping as persisted in board-store (key e.g. 'topic', 'priority', 'custom:<slug>'). */
export interface SeedGrouping {
  enabled: boolean
  key: string | null
}

const NO_GROUPING: SeedGrouping = { enabled: false, key: null }

/** Builds a board-store Pinia snapshot. `source` is the board's only source and its default (#326). */
export function buildBoardStore(
  source: 'local' | 'notion',
  tasks: SeedTask[] = SEED_TASKS,
  grouping: SeedGrouping = NO_GROUPING,
) {
  return boardStoreOf(source === 'local' ? { connected: [], default: 'local' } : { connected: ['notion'], default: 'notion' }, tasks, grouping)
}

/** Builds a board-store snapshot for a board with Local and Notion side by side (`default` is where new tasks go). */
export function buildMixedBoardStore(
  defaultSource: 'local' | 'notion' = 'notion',
  tasks: SeedTask[] = MIXED_SEED_TASKS,
  grouping: SeedGrouping = NO_GROUPING,
) {
  return boardStoreOf({ connected: ['notion'], default: defaultSource }, tasks, grouping)
}

function boardStoreOf(sources: { connected: string[]; default: string }, tasks: SeedTask[], grouping: SeedGrouping) {
  const byStatus = (s: number) => tasks.filter((t) => t.status === s).map((t) => t.id)
  return {
    boardConfig: { sources },
    columns: [
      { idClassSuffix: 'open', taskStatus: 0, taskOrder: byStatus(0), taskPositions: {} },
      { idClassSuffix: 'progress', taskStatus: 1, taskOrder: byStatus(1), taskPositions: {} },
      { idClassSuffix: 'waiting', taskStatus: 2, taskOrder: byStatus(2), taskPositions: {} },
      { idClassSuffix: 'done', taskStatus: 3, taskOrder: byStatus(3), taskPositions: {} },
    ],
    grouping,
  }
}

/**
 * settings-store snapshot (#394). The Fokus overlay is on by default in the app, but every seed turns it off
 * unless the spec opts in with `focus: true`: with a task in Jetzt it would swallow the first tap of every touch
 * spec and dim the board in screenshots and contrast checks.
 */
export function buildSettingsStore(focus = false) {
  return { focusEnabled: focus }
}

/** Carried-over counter entry (#99), as persisted in tasks-store. */
export interface SeedCarryOver {
  firstOn: string
  days: number
  lastOn: string
  keptAtDays: number | null
}

/** Builds a tasks-store Pinia snapshot; tasks without a source live in `source` (Notion tasks use their id as externalId). */
export function buildTasksStore(
  tasks: SeedTask[] = SEED_TASKS,
  carryOverByTaskId: Record<string, SeedCarryOver> = {},
  source: 'local' | 'notion' = 'local',
) {
  return {
    carryOverByTaskId,
    pendingDeletes: {},
    tasks: tasks.map((task) => {
      const own = task.source ?? source
      return { ...task, source: own, externalId: task.externalId !== undefined ? task.externalId : own === 'local' ? null : task.id }
    }),
    isLoading: false,
    lastSyncTimestamp: null,
    archivedTaskIds: [],
    deletedTaskIds: [],
    pendingTimeUpdates: {},
    customPropertyIndexes: {},
    taskOperationVersions: {},
    batchOperationInProgress: false,
    // The stamp of the marker model (#793, `MARKER_MODEL` in lib/taskPlanning.ts): a snapshot without it loads as data
    // from before, and its first load drops `notPlanned` from a waiting task
    markerModel: 2,
  }
}

// ---------------------------------------------------------------------------
// Default Notion stub config (uses sentinel token — no env var needed)
// ---------------------------------------------------------------------------

export const DEFAULT_NOTION_SEED_CONFIG: NotionSeedConfig = {
  token: NOTION_STUB_API_KEY,
  // Ids from tests/fixtures/notion/databases.json — the stub 404s on unknown database ids
  databaseId: 'db-123',
  dataSourceId: 'ds-123',
  propertyMapping: {
    title: 'Name',
    status: 'Status',
    dueDate: null,
    priority: null,
    timeBox: 'Timebox',
    timeSpent: 'Aufwand',
    timeSpentUnit: 'minutes',
    customProperties: [],
  },
  statusMapping: {
    today: 'Today',
    doing: 'Doing',
    done: 'Done',
    waiting: 'Waiting',
  },
}

/**
 * Returns a session-scoped stub token (`notion_test_stub:<random>`). The server treats it
 * like the sentinel but keeps a separate in-memory page state for it.
 */
export function notionStubSessionToken(): string {
  return `${NOTION_STUB_API_KEY}:${crypto.randomUUID()}`
}

// ---------------------------------------------------------------------------
// context.addInitScript helpers (preferred — run before page JS)
// ---------------------------------------------------------------------------

/** Options of `seedLocalBoard`. */
export interface SeedLocalOptions {
  /** Fokus overlay on (the app default); off in seeds unless set, see `buildSettingsStore` (#394). */
  focus?: boolean
  /**
   * Seed only on the first load of this tab. `addInitScript` runs on every navigation, so without it
   * a `page.reload()` overwrites the changes the test made. The guard is a sessionStorage flag keyed
   * per seed content, so two different seeds in one context stay independent.
   */
  once?: boolean
}

/** Short stable hash of a string, for the seed-once flag key. */
function hashSeed(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * Seeds local board mode via addInitScript.
 * No env var or stub needed — tasks live entirely in localStorage.
 * Use for all UI tests unrelated to external integrations. `grouping` turns on column grouping.
 * Pass `{ once: true }` when the test reloads and must keep its changes.
 *
 * @example
 * test.beforeEach(async ({ context }) => {
 *   await seedLocalBoard(context)
 * })
 * // reload-based spec: the second load keeps what the first one changed
 * await seedLocalBoard(context, tasks, {}, GROUPING, { once: true })
 */
export async function seedLocalBoard(
  context: BrowserContext,
  tasks: SeedTask[] = SEED_TASKS,
  carryOverByTaskId: Record<string, SeedCarryOver> = {},
  grouping: SeedGrouping = NO_GROUPING,
  options: SeedLocalOptions = {},
): Promise<void> {
  const board = buildBoardStore('local', tasks, grouping)
  const taskStore = buildTasksStore(tasks, carryOverByTaskId)
  const settings = buildSettingsStore(options.focus)
  const onceKey = options.once ? `e2e-seeded:${hashSeed(JSON.stringify({ board, taskStore, settings }))}` : null
  await context.addInitScript(
    ({ board: b, tasks: t, settings: st, onceKey: key }) => {
      if (key) {
        try {
          if (sessionStorage.getItem(key)) return
          sessionStorage.setItem(key, '1')
        } catch {
          // sessionStorage unavailable: fall through and seed every load
        }
      }
      localStorage.setItem('board-store', JSON.stringify(b))
      localStorage.setItem('tasks-store', JSON.stringify(t))
      localStorage.setItem('settings-store', JSON.stringify(st))
    },
    { board, tasks: taskStore, settings, onceKey },
  )
}

/**
 * Seeds Notion stub mode via addInitScript.
 * Uses a session variant of the sentinel token ('notion_test_stub:<uuid>') so no
 * E2E_NOTION_STUB env var is needed and stub writes never leak into other tests.
 * Also seeds tasks-store so the board is immediately populated.
 *
 * @example
 * test.beforeEach(async ({ context }) => {
 *   await seedNotionBoard(context)
 * })
 */
export async function seedNotionBoard(
  context: BrowserContext,
  tasks: SeedTask[] = SEED_TASKS,
  notionConfig: Partial<NotionSeedConfig> = {},
  carryOverByTaskId: Record<string, SeedCarryOver> = {},
  options: { focus?: boolean } = {},
): Promise<void> {
  // A unique session token per call isolates the stub's in-memory page state
  // (writes are read back on retrieve/query) between tests and parallel workers.
  const mergedConfig = {
    ...DEFAULT_NOTION_SEED_CONFIG,
    token: notionStubSessionToken(),
    ...notionConfig,
  }
  await context.addInitScript(
    ({ board, taskStore, notion, settings }) => {
      localStorage.setItem('board-store', JSON.stringify(board))
      localStorage.setItem('tasks-store', JSON.stringify(taskStore))
      localStorage.setItem('notionConfig', JSON.stringify({ config: notion }))
      localStorage.setItem('settings-store', JSON.stringify(settings))
    },
    {
      settings: buildSettingsStore(options.focus),
      board: buildBoardStore('notion', tasks),
      taskStore: buildTasksStore(tasks, carryOverByTaskId, 'notion'),
      notion: mergedConfig,
    },
  )
}

/** Options of `seedMixedBoard`. */
export interface SeedMixedOptions {
  /** Fokus overlay on (the app default); off in seeds unless set, see `buildSettingsStore` (#394). */
  focus?: boolean
  /** Where new tasks go; Local is always connected. Notion by default, like an upgraded Notion user. */
  defaultSource?: 'local' | 'notion'
  /** Seed only on the first load of this tab (see `SeedLocalOptions.once`). */
  once?: boolean
  notionConfig?: Partial<NotionSeedConfig>
  /** Carried-over counters by task id (#99), see `carriedOverDays`. */
  carryOverByTaskId?: Record<string, SeedCarryOver>
  /** Column grouping persisted in board-store (default: none). */
  grouping?: SeedGrouping
}

/**
 * Seeds a board with Local and Notion tasks side by side (epic #264): `sources.connected` is
 * `['notion']`, tasks carry an explicit `source`/`externalId`, and the session-scoped Notion stub token
 * of `seedNotionBoard` is used. The default tasks (`MIXED_SEED_TASKS`) are the stub's own pages plus
 * Local ones, so a Notion fetch leaves every task where it is.
 *
 * @example
 * await seedMixedBoard(context)                                   // default source: Notion
 * await seedMixedBoard(context, undefined, { defaultSource: 'local' })
 */
export async function seedMixedBoard(
  context: BrowserContext,
  tasks: SeedTask[] = MIXED_SEED_TASKS,
  options: SeedMixedOptions = {},
): Promise<void> {
  const mergedConfig = {
    ...DEFAULT_NOTION_SEED_CONFIG,
    token: notionStubSessionToken(),
    ...options.notionConfig,
  }
  const board = buildMixedBoardStore(options.defaultSource ?? 'notion', tasks, options.grouping)
  const taskStore = buildTasksStore(tasks, options.carryOverByTaskId)
  const settings = buildSettingsStore(options.focus)
  const onceKey = options.once ? `e2e-seeded:${hashSeed(JSON.stringify({ board, taskStore, settings }))}` : null
  await context.addInitScript(
    ({ board: b, taskStore: t, notion, settings: st, onceKey: key }) => {
      if (key) {
        try {
          if (sessionStorage.getItem(key)) return
          sessionStorage.setItem(key, '1')
        } catch {
          // sessionStorage unavailable: fall through and seed every load
        }
      }
      localStorage.setItem('board-store', JSON.stringify(b))
      localStorage.setItem('tasks-store', JSON.stringify(t))
      localStorage.setItem('notionConfig', JSON.stringify({ config: notion }))
      localStorage.setItem('settings-store', JSON.stringify(st))
    },
    { board, taskStore, notion: mergedConfig, settings, onceKey },
  )
}

// ---------------------------------------------------------------------------
// Apple Reminders source (#551, epic #481)
// ---------------------------------------------------------------------------

/** The three lists of the Reminders seed: two read (one of them stored with the legacy role, see below) and one Aus (never fetched). */
export const REMINDERS_SEED_LISTS: RemindersListStub[] = [
  { id: 'list-home', title: 'Zuhause' },
  { id: 'list-work', title: 'Arbeit' },
  { id: 'list-private', title: 'Privat' },
]

/** What a stored answer can read in a seed: `activity` is the role an app version before #575 wrote, which still loads as Thema */
export type SeedReminderRole = 'topic' | 'off' | 'activity'

export const REMINDERS_SEED_ROLES: Record<string, SeedReminderRole> = {
  'list-home': 'topic',
  'list-work': 'activity',
  'list-private': 'off',
}

/** Local `YYYY-MM-DD` of the day `daysAhead` days from now. */
export function dayKeyDaysAhead(daysAhead: number): string {
  return dayKeyDaysAgo(-daysAhead)
}

/**
 * The reminders of the seed (all dated today, so the date is the plan and each starts on today's board, #553): a one-off with notes, a one-off in the list stored as the legacy Aktivität (#575: read as Thema), a weekly recurring one (ticking it
 * leaves it open at the next date, the Reminders behaviour of the stub), one that was completed today, and one in the list
 * set to Off. Titles are unique so a spec finds a card by text.
 */
export function remindersSeedReminders(): ReminderStub[] {
  return [
    { id: 'rem-milk', listId: 'list-home', title: 'Milch kaufen', notes: 'Hafermilch', due: { date: dayKeyDaysAhead(0), time: null } },
    { id: 'rem-report', listId: 'list-work', title: 'Quartalsbericht schreiben', due: { date: dayKeyDaysAhead(0), time: '09:30' } },
    {
      id: 'rem-plants', listId: 'list-home', title: 'Pflanzen gießen', due: { date: dayKeyDaysAhead(0), time: null },
      recurrence: { rule: 'FREQ=WEEKLY' }, nextDue: { date: dayKeyDaysAhead(7), time: null },
    },
    { id: 'rem-trash', listId: 'list-home', title: 'Müll rausgebracht', completed: true, completedAt: Date.now() - 60_000, due: { date: dayKeyDaysAhead(0), time: null } },
    { id: 'rem-secret', listId: 'list-private', title: 'Geschenk verstecken', due: { date: dayKeyDaysAhead(1), time: null } },
  ]
}

/** Options of `seedRemindersBoard`. */
export interface SeedRemindersOptions {
  /** Local tasks that sit beside the Reminders ones (a mixed board shows the source icon); none by default. */
  tasks?: SeedTask[]
  /** The answer per list (`remindersConfig.lists`); the three roles of the seed by default. */
  roles?: Record<string, SeedReminderRole>
  lists?: RemindersListStub[]
  reminders?: ReminderStub[]
  /** The macOS permission at start; `granted` by default. */
  status?: RemindersAccess
}

/**
 * Seeds a desktop board with a connected Reminders source (`sources.connected: ['reminders']`, default Local) and the
 * Tauri stub that answers the `reminders_*` commands, so the Mac app's source runs without a Mac: the first fetch brings
 * the reminders in, the lists carry the roles of `remindersConfig`. Local tasks are optional. The board lives in the stub's
 * data envelope (what a desktop spec does, `.claude/rules/desktop.md`): the stub keeps it across a `page.reload()`, so no
 * `once` flag is needed, and a spec reads the persisted state with `stubState(page).data.envelope` (`remindersStores`).
 *
 * @example
 * await seedRemindersBoard(context)                                   // three lists, five reminders
 * const stores = await remindersStores(page)                          // what the app persisted so far
 */
export async function seedRemindersBoard(context: BrowserContext, options: SeedRemindersOptions = {}): Promise<void> {
  const tasks = options.tasks ?? []
  const lists = options.lists ?? REMINDERS_SEED_LISTS
  const config = {
    lists: Object.fromEntries(Object.entries(options.roles ?? REMINDERS_SEED_ROLES).map(([id, role]) => [id, { role, title: lists.find(list => list.id === id)?.title ?? id }])),
    doneOccurrences: {},
  }
  await installTauriStub(context, {
    reminders: { status: options.status ?? 'granted', lists, reminders: options.reminders ?? remindersSeedReminders() },
    data: {
      envelope: {
        schemaVersion: 2,
        writtenAt: new Date().toISOString(),
        writtenBy: 'device-e2e',
        appVersion: '0.1.0',
        stores: {
          'board-store': boardStoreOf({ connected: ['reminders'], default: 'local' }, tasks, NO_GROUPING),
          'tasks-store': buildTasksStore(tasks, {}, 'local'),
          'settings-store': buildSettingsStore(),
          remindersConfig: config,
        },
      },
    },
  })
}

// ---------------------------------------------------------------------------
// New-day recap (#385)
// ---------------------------------------------------------------------------

/** Local `YYYY-MM-DD` of the day `daysAgo` days back (same format as `day-recap-store.lastShownDay`). */
export function dayKeyDaysAgo(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** ISO time on the local day `daysAgo` days back. */
export function atDaysAgo(daysAgo: number, hour: number, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

const recapTask = (task: Partial<SeedTask> & Pick<SeedTask, 'id' | 'title' | 'status'>): SeedTask => ({
  priority: 3, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, ...task,
})

/** Four tasks done `daysAgo` days back (not archived), one Offen and one Wartet card: "4 von 6". */
export function newDayTasks(daysAgo = 1, options: { allDone?: boolean } = {}): SeedTask[] {
  const done = [
    recapTask({ id: 'nd-done-1', title: 'Angebot an Kunden schicken', status: 3, completedAt: atDaysAgo(daysAgo, 11, 15) }),
    recapTask({ id: 'nd-done-2', title: 'Kurze Rückfrage beantwortet', status: 3, completedAt: atDaysAgo(daysAgo, 13) }),
    recapTask({ id: 'nd-done-3', title: 'Steuerunterlagen sortieren', status: 3, completedAt: atDaysAgo(daysAgo, 14, 30) }),
    recapTask({ id: 'nd-done-4', title: 'Retrospektive nachbereiten', status: 3, completedAt: atDaysAgo(daysAgo, 15, 45) }),
  ]
  if (options.allDone) return done
  return [
    ...done,
    recapTask({ id: 'nd-open-1', title: 'Konzept ausarbeiten', status: 0 }),
    recapTask({ id: 'nd-waiting-1', title: 'Rückmeldung vom Vermieter', status: 2 }),
  ]
}

/**
 * A full board for the fresh start (#356, #387): `newDayTasks` plus a Jetzt card with time spent, a second Offen card and
 * a task that was not planned before. After "Neuen Tag planen" "Alle Aufgaben" holds nd-now-1, nd-open-2, nd-open-1 as the
 * group "Zuletzt geplant und nicht erledigt" (board order, Jetzt first), nd-waiting-1 after them (one panel "Zuletzt geplant und nicht erledigt") and nd-held-1
 * under "Weitere Aufgaben". Without the done tasks no recap is due and the board shows the notice instead.
 */
export function newDayBackTasks(daysAgo = 1): SeedTask[] {
  const base = newDayTasks(daysAgo)
  return [
    ...base.filter(task => task.status === 3),
    recapTask({ id: 'nd-now-1', title: 'Präsentation vorbereiten', status: 1, timeSpentSeconds: 1800, timeBoxSeconds: 3600 }),
    recapTask({ id: 'nd-open-2', title: 'Steuerberater anrufen', status: 0 }),
    recapTask({ id: 'nd-held-1', title: 'Regal für den Keller aussuchen', status: 0, notPlanned: true }),
    ...base.filter(task => task.status !== 3),
  ]
}

/** Options of `seedDayRecapStore`. */
export interface SeedDayRecapOptions {
  /**
   * The day the user last started fresh on (#387). Default: the same day as `lastShownDay`, so a fresh start is on
   * offer when that day is before today; nothing moves by itself. Today's key: the day is already started (no notice,
   * "Neuen Tag planen" moves nothing), the recap is still due. `null` stores no such field: data from before the fresh start
   * existed (the update from v0.16.0), which the day check gives its baseline.
   */
  lastNewDay?: string | null
  /** Stored marker; default: two days back, so the recap is due. `null` leaves the store out (baseline case). */
  lastShownDay?: string | null
  /** Seed only on the first load of this tab (the recap's own marker must survive a reload). */
  once?: boolean
}

/** Seeds `day-recap-store` via addInitScript. */
export async function seedDayRecapStore(context: BrowserContext, options: SeedDayRecapOptions = {}): Promise<void> {
  const lastShownDay = options.lastShownDay === undefined ? dayKeyDaysAgo(2) : options.lastShownDay
  const state = lastShownDay === null
    ? null
    : { lastShownDay, ...(options.lastNewDay === null ? {} : { lastNewDay: options.lastNewDay ?? lastShownDay }) }
  await context.addInitScript(
    ({ state: s, once }) => {
      if (once) {
        try {
          if (sessionStorage.getItem('e2e-seeded:day-recap')) return
          sessionStorage.setItem('e2e-seeded:day-recap', '1')
        } catch {
          // sessionStorage unavailable: seed every load
        }
      }
      if (s) localStorage.setItem('day-recap-store', JSON.stringify(s))
      else localStorage.removeItem('day-recap-store')
    },
    { state, once: options.once ?? false },
  )
}

/**
 * Local board on which the recap is due: the tasks of `newDayTasks()` and a `day-recap-store` marker before
 * the day they were done. Reload-safe by default (`once`), because leaving the recap moves the marker.
 */
export async function seedNewDayBoard(
  context: BrowserContext,
  options: SeedDayRecapOptions & { daysAgo?: number, allDone?: boolean, tasks?: SeedTask[], focus?: boolean } = {},
): Promise<void> {
  const daysAgo = options.daysAgo ?? 1
  const tasks = options.tasks ?? newDayTasks(daysAgo, { allDone: options.allDone ?? false })
  const once = options.once ?? true
  await seedLocalBoard(context, tasks, {}, NO_GROUPING, { once, ...(options.focus ? { focus: true } : {}) })
  await seedDayRecapStore(context, { lastShownDay: dayKeyDaysAgo(daysAgo + 1), ...options, once })
}

/**
 * The seconds a Jetzt timer counted after this morning's midnight while the user was away (#356): a note in
 * `tasks-store`, which the day check on the app's start turns into the question "Zeit abziehen / Zeit behalten" (#387:
 * without a fresh start, the task stays in Jetzt). Register it after
 * the board's seed (it patches the stored `tasks-store`); `once` as the board's.
 */
export async function seedAfterMidnight(context: BrowserContext, options: { taskId: string, seconds: number, once?: boolean }): Promise<void> {
  await context.addInitScript(
    ({ taskId, seconds, once }) => {
      if (once) {
        try {
          if (sessionStorage.getItem('e2e-seeded:after-midnight')) return
          sessionStorage.setItem('e2e-seeded:after-midnight', '1')
        } catch {
          // sessionStorage unavailable: patch every load
        }
      }
      const raw = localStorage.getItem('tasks-store')
      if (!raw) return
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
      const pad = (n: number) => String(n).padStart(2, '0')
      const day = `${midnight.getFullYear()}-${pad(midnight.getMonth() + 1)}-${pad(midnight.getDate())}`
      const state = JSON.parse(raw)
      state.afterMidnight = { taskId, day, seconds, spans: [[midnight.getTime(), midnight.getTime() + seconds * 1000]] }
      localStorage.setItem('tasks-store', JSON.stringify(state))
    },
    { taskId: options.taskId, seconds: options.seconds, once: options.once ?? true },
  )
}

// ---------------------------------------------------------------------------
// Trash (#422)
// ---------------------------------------------------------------------------

/** One entry of `trash-store` as a spec seeds it. */
export interface SeedTrashEntry {
  task: SeedTask
  /** How long ago it was deleted; 3 minutes by default. Day-bucket specs use `deletedAt` against a pinned clock instead (#449). */
  minutesAgo?: number
  /** Absolute deletion time (ms since epoch); wins over `minutesAgo` */
  deletedAt?: number
  /** The column it was deleted from; the task's own status by default */
  fromStatus?: 0 | 1 | 2 | 3
}

/**
 * Seeds `trash-store` via addInitScript (newest first as given). Pass `{ once: true }` in a spec that reloads and must
 * keep what it did to the trash, like `seedLocalBoard`. Tasks of the trash are not on the board: seed the board without them.
 */
export async function seedTrash(context: BrowserContext, entries: SeedTrashEntry[], options: { once?: boolean } = {}): Promise<void> {
  const store = {
    entries: entries.map(({ task, minutesAgo = 3, deletedAt, fromStatus }) => ({
      taskId: task.id,
      deletedAt: deletedAt ?? Date.now() - minutesAgo * 60_000,
      fromStatus: fromStatus ?? task.status,
      carryOver: null,
      task: { source: 'local', externalId: null, ...task, timerId: null },
    })),
  }
  const onceKey = options.once ? `e2e-seeded-trash:${hashSeed(JSON.stringify(entries))}` : null
  await context.addInitScript(
    ({ store: value, onceKey: key }) => {
      if (key) {
        try {
          if (sessionStorage.getItem(key)) return
          sessionStorage.setItem(key, '1')
        } catch {
          // sessionStorage unavailable: fall through and seed every load
        }
      }
      localStorage.setItem('trash-store', JSON.stringify(value))
    },
    { store, onceKey },
  )
}

/** A task of its own for the trash, not part of `SEED_TASKS`. */
export function trashTask(id: string, title: string, status: 0 | 1 | 2 | 3 = 0): SeedTask {
  return { id, title, status, priority: 1, timeSpentSeconds: 0, timeBoxSeconds: null, topic: null, custom: {} }
}

// ---------------------------------------------------------------------------
// Topic styles (#431)
// ---------------------------------------------------------------------------

/** `topic-styles` as a spec seeds it: topic name -> hue and/or symbol key. */
export type SeedTopicStyles = Record<string, { hue?: string | null; symbol?: string | null }>

/**
 * Seeds `topic-styles` via addInitScript. Pass `{ once: true }` in a spec that reloads and must keep what it did to
 * the styles, like `seedLocalBoard`.
 */
export async function seedTopicStyles(context: BrowserContext, styles: SeedTopicStyles, options: { once?: boolean } = {}): Promise<void> {
  const state = { styles: Object.fromEntries(Object.entries(styles).map(([name, s]) => [name, { hue: s.hue ?? null, symbol: s.symbol ?? null }])) }
  const onceKey = options.once ? `e2e-seeded-topic-styles:${hashSeed(JSON.stringify(state))}` : null
  await context.addInitScript(
    ({ state: value, onceKey: key }) => {
      if (key) {
        try {
          if (sessionStorage.getItem(key)) return
          sessionStorage.setItem(key, '1')
        } catch {
          // sessionStorage unavailable: fall through and seed every load
        }
      }
      localStorage.setItem('topic-styles', JSON.stringify(value))
    },
    { state, onceKey },
  )
}

/**
 * Tracked work sessions of the last `days` days before today, `hours` hours each (#132): the history the capacity
 * divider learns the day length from (5 days or more; 10 h is the longest day it learns, so a board with up to 600
 * minutes of planned work shows no divider). A spec that is not about the divider but seeds a long Offen list calls
 * `seedWorkHistory(context, 5, 10)` to keep the line out of its screenshots.
 */
export async function seedWorkHistory(context: BrowserContext, days: number, hours: number): Promise<void> {
  await context.addInitScript(({ days: n, hours: h }) => {
    const sessions = Array.from({ length: n }, (_, i) => {
      const start = new Date()
      start.setDate(start.getDate() - (i + 1))
      start.setHours(8, 0, 0, 0)
      return { start: start.getTime(), end: start.getTime() + h * 3_600_000 }
    })
    localStorage.setItem('taskStatistics', JSON.stringify({ workSessions: sessions }))
  }, { days, hours })
}
