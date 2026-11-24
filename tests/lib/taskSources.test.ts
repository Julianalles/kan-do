import { describe, expect, it } from 'vitest'
import {
  deleteLabelKey,
  externalIdOf,
  normalizeBoardConfig,
  normalizePendingSync,
  normalizePendingDeletes,
  normalizeSources,
  normalizeTasks,
  sourcesFromLegacyService,
  singleSource,
  sourceCan,
  sourceCanCreate,
  sourceHomeUrl,
  sourceSyncsTime,
  sourceTaskUrl,
  SETUP_ERROR_CONTEXTS,
} from '~/lib/taskSources'

describe('sourcesFromLegacyService', () => {
  it('maps notion and todoist to a connected default', () => {
    expect(sourcesFromLegacyService('notion')).toEqual({ connected: ['notion'], default: 'notion' })
    expect(sourcesFromLegacyService('todoist')).toEqual({ connected: ['todoist'], default: 'todoist' })
  })

  it('maps local and example to Local with nothing connected', () => {
    expect(sourcesFromLegacyService('local')).toEqual({ connected: [], default: 'local' })
    expect(sourcesFromLegacyService('example')).toEqual({ connected: [], default: 'local' })
  })

  it('keeps "never onboarded" and drops unknown services (removed Linear)', () => {
    expect(sourcesFromLegacyService(null)).toBeNull()
    expect(sourcesFromLegacyService(undefined)).toBeNull()
    expect(sourcesFromLegacyService('linear')).toBeNull()
  })
})

describe('normalizeSources', () => {
  it('keeps a valid shape unchanged', () => {
    const sources = { connected: ['notion'], default: 'local' }
    expect(normalizeSources(sources)).toEqual(sources)
  })

  it('drops unknown and duplicate connections and repairs a default that is not usable', () => {
    expect(normalizeSources({ connected: ['notion', 'notion', 'linear', 'local'], default: 'todoist' }))
      .toEqual({ connected: ['notion'], default: 'local' })
  })

  it('repairs an imported default of Reminders to Local: it is never the default source', () => {
    expect(normalizeSources({ connected: ['reminders'], default: 'reminders' }))
      .toEqual({ connected: ['reminders'], default: 'local' })
  })

  it('returns null for anything that is not an object', () => {
    expect(normalizeSources(null)).toBeNull()
    expect(normalizeSources('notion')).toBeNull()
  })
})

describe('normalizeBoardConfig', () => {
  it('migrates a legacy notion config and drops taskService', () => {
    const migrated = normalizeBoardConfig({ taskService: 'notion', notionDatabaseId: 'db' })
    expect(migrated).toEqual({ sources: { connected: ['notion'], default: 'notion' }, notionDatabaseId: 'db' })
    expect('taskService' in migrated).toBe(false)
  })

  it('migrates local and example to Local', () => {
    expect(normalizeBoardConfig({ taskService: 'local' }).sources).toEqual({ connected: [], default: 'local' })
    expect(normalizeBoardConfig({ taskService: 'example' }).sources).toEqual({ connected: [], default: 'local' })
  })

  it('keeps never onboarded as sources: null', () => {
    expect(normalizeBoardConfig({ taskService: null })).toEqual({ sources: null })
    expect(normalizeBoardConfig(undefined)).toEqual({ sources: null })
    expect(normalizeBoardConfig({})).toEqual({ sources: null })
  })

  it('drops removed Linear state', () => {
    expect(normalizeBoardConfig({ taskService: 'linear', linearApiKey: 'lin_secret' })).toEqual({ sources: null })
  })

  it('prefers an existing sources shape over a stale taskService', () => {
    const migrated = normalizeBoardConfig({ taskService: 'local', sources: { connected: ['notion'], default: 'notion' } })
    expect(migrated.sources).toEqual({ connected: ['notion'], default: 'notion' })
  })

  it('treats a half-written sources value as absent and falls back to taskService', () => {
    expect(normalizeBoardConfig({ taskService: 'notion', sources: {} }).sources)
      .toEqual({ connected: ['notion'], default: 'notion' })
    expect(normalizeBoardConfig({ taskService: 'todoist', sources: { connected: ['notion'] } }).sources)
      .toEqual({ connected: ['todoist'], default: 'todoist' })
  })

  it('keeps pendingSourceSwitch only as true next to an integration default, absent stays absent', () => {
    const notion = { sources: { connected: ['notion'], default: 'notion' } }
    expect(normalizeBoardConfig({ ...notion, pendingSourceSwitch: true })).toEqual({ ...notion, pendingSourceSwitch: true })
    expect(normalizeBoardConfig(notion)).not.toHaveProperty('pendingSourceSwitch')
    expect(normalizeBoardConfig({ ...notion, pendingSourceSwitch: 'yes' })).not.toHaveProperty('pendingSourceSwitch')
    expect(normalizeBoardConfig({ sources: { connected: [], default: 'local' }, pendingSourceSwitch: true })).not.toHaveProperty('pendingSourceSwitch')
    expect(normalizeBoardConfig({ taskService: null, pendingSourceSwitch: true })).not.toHaveProperty('pendingSourceSwitch')
  })

  it('is idempotent', () => {
    for (const raw of [{ sources: { connected: ['notion'], default: 'notion' }, pendingSourceSwitch: true }, { taskService: 'notion' }, { taskService: 'local' }, { taskService: null }, {}, undefined]) {
      const once = normalizeBoardConfig(raw)
      expect(normalizeBoardConfig(once)).toEqual(once)
    }
  })
})

describe('normalizeTasks', () => {
  it('stamps legacy notion tasks with their id as externalId', () => {
    const [task] = normalizeTasks([{ id: 'page-1', title: 'A' }], 'notion')
    expect(task).toMatchObject({ id: 'page-1', source: 'notion', externalId: 'page-1' })
  })

  it('stamps legacy local tasks without an externalId', () => {
    const [task] = normalizeTasks([{ id: 'abc', title: 'A' }], 'local')
    expect(task).toMatchObject({ id: 'abc', source: 'local', externalId: null })
  })

  it('leaves tasks that already carry a source alone, including their externalId', () => {
    const task = { id: 'abc', source: 'notion', externalId: 'page-9' }
    expect(normalizeTasks([task], 'local')).toEqual([task])
  })

  it('completes a half-migrated task from its own source', () => {
    const [notion] = normalizeTasks([{ id: 'p', source: 'notion' }], 'local')
    const [local] = normalizeTasks([{ id: 'l', source: 'local', externalId: 'stale' }], 'notion')
    expect(notion).toMatchObject({ source: 'notion', externalId: 'p' })
    expect(local).toMatchObject({ source: 'local', externalId: null })
  })

  it('returns the same array when nothing changes, so hydration can skip the write', () => {
    const tasks = [{ id: 'a', source: 'local', externalId: null }]
    expect(normalizeTasks(tasks, 'local')).toBe(tasks)
  })

  it('is idempotent', () => {
    const once = normalizeTasks([{ id: 'a' }, { id: 'b' }], 'notion')
    expect(normalizeTasks(once, 'local')).toBe(once)
  })
})

describe('legacy sourceData (#334)', () => {
  const upstream = { id: 'page-1', properties: { Name: { title: [] } } }

  it('drops the raw upstream payload of a stored task and keeps the rest', () => {
    const [task] = normalizeTasks([{ id: 'page-1', source: 'notion', externalId: 'page-1', title: 'A', sourceData: upstream }], 'notion')
    expect(task).not.toHaveProperty('sourceData')
    expect(task).toEqual({ id: 'page-1', source: 'notion', externalId: 'page-1', title: 'A' })
  })

  it('drops it together with the source stamp of a legacy task, and from other sources', () => {
    const [legacy, todoist] = normalizeTasks([
      { id: 'a', title: 'A', sourceData: upstream },
      { id: 't', source: 'todoist', externalId: 't', sourceData: { id: 't' } },
    ], 'notion')
    expect(legacy).toMatchObject({ source: 'notion', externalId: 'a' })
    expect(legacy).not.toHaveProperty('sourceData')
    expect(todoist).not.toHaveProperty('sourceData')
  })

  it('is idempotent and returns the same array once it is gone, so hydration does not write', () => {
    const once = normalizeTasks([{ id: 'a', source: 'notion', externalId: 'a', sourceData: upstream }], 'notion')
    expect(normalizeTasks(once, 'notion')).toBe(once)
    const clean = [{ id: 'b', source: 'notion', externalId: 'b' }]
    expect(normalizeTasks(clean, 'notion')).toBe(clean)
  })

  it('also cleans the task snapshot of a pending delete', () => {
    const result = normalizePendingDeletes(
      { a: { taskId: 'a', task: { id: 'a', source: 'notion', externalId: 'a', sourceData: upstream }, state: 'queued' } },
      'notion',
    )
    expect(result.a?.task).toEqual({ id: 'a', source: 'notion', externalId: 'a' })
  })
})

describe('normalizePendingDeletes', () => {
  it('derives the snapshot source from the legacy service field and drops the field', () => {
    const result = normalizePendingDeletes(
      { 'p-1': { taskId: 'p-1', service: 'notion', task: { id: 'p-1' }, state: 'queued' } },
      'local',
    )
    expect(result['p-1']).toEqual({ taskId: 'p-1', task: { id: 'p-1', source: 'notion', externalId: 'p-1' }, state: 'queued' })
  })

  it('is a no-op on the new shape', () => {
    const pending = { a: { taskId: 'a', task: { id: 'a', source: 'local', externalId: null }, state: 'waiting' } }
    expect(normalizePendingDeletes(pending, 'local')).toBe(pending)
  })
})

describe('helpers', () => {
  it('singleSource builds the config for one source', () => {
    expect(singleSource('local')).toEqual({ connected: [], default: 'local' })
    expect(singleSource('notion')).toEqual({ connected: ['notion'], default: 'notion' })
  })

  it('singleSource never makes Reminders the default source (#552)', () => {
    expect(singleSource('reminders')).toEqual({ connected: ['reminders'], default: 'local' })
  })

  it('externalIdOf returns the id an integration receives and fails loudly for Local tasks', () => {
    expect(externalIdOf({ id: 'a', source: 'notion', externalId: 'page' })).toBe('page')
    expect(() => externalIdOf({ id: 'a', source: 'local', externalId: null })).toThrow(/externalId/)
  })
})

describe('pendingSync marker (#319)', () => {
  const marker = { since: 1700000000000, attempts: 2, lastError: 'offline' }

  it('keeps a valid marker and returns the very same array, so hydration does not write', () => {
    const tasks = [{ id: 'a', source: 'notion', externalId: 'a', pendingSync: marker }]
    expect(normalizeTasks(tasks, 'notion')).toBe(tasks)
    expect(normalizePendingSync(marker)).toBe(marker)
  })

  it('keeps upstreamDone (#344) without a write, and drops a value that is not a boolean', () => {
    const withNote = { ...marker, upstreamDone: true }
    const tasks = [{ id: 'a', source: 'todoist', externalId: 'a', pendingSync: withNote }]
    expect(normalizeTasks(tasks, 'todoist')).toBe(tasks)
    expect(normalizePendingSync(withNote)).toBe(withNote)
    expect(normalizePendingSync({ ...marker, upstreamDone: 'yes' })).toEqual(marker)
  })

  it('keeps createUncertain (#528) without a write, and reads a malformed one as none', () => {
    const withDoubt = { ...marker, createUncertain: { since: 1700000000000, title: 'Rückruf' } }
    const tasks = [{ id: 'a', source: 'notion', externalId: null, pendingSync: withDoubt }]
    expect(normalizeTasks(tasks, 'notion')).toBe(tasks)
    expect(normalizePendingSync(withDoubt)).toBe(withDoubt)
    const lastAttempt = { ...marker, createUncertain: { since: 1700000000000, at: 1700000009000, title: 'Rückruf' } }
    expect(normalizePendingSync(lastAttempt)).toBe(lastAttempt)
    expect(normalizePendingSync({ ...marker, createUncertain: { since: 1, at: 'x', title: 'a' } })).toEqual(marker)
    expect(normalizePendingSync({ ...marker, createUncertain: { since: 'x', title: 'a' } })).toEqual(marker)
    expect(normalizePendingSync({ ...marker, createUncertain: { since: 5 } })).toEqual(marker)
    expect(normalizePendingSync({ ...marker, createUncertain: 'yes' })).toEqual(marker)
  })

  it('keeps dateWrite (#553) with its day without a write, and reads a malformed one as none', () => {
    const withDate = { ...marker, dateWrite: '2026-11-19' }
    const tasks = [{ id: 'a', source: 'reminders', externalId: 'a', pendingSync: withDate }]
    expect(normalizeTasks(tasks, 'reminders')).toBe(tasks)
    expect(normalizePendingSync(withDate)).toBe(withDate)
    // a repaired marker keeps the day too: a failed date write is retried after a restart
    expect(normalizePendingSync({ since: 5, dateWrite: '2026-11-19' })).toEqual({ since: 5, attempts: 0, lastError: null, dateWrite: '2026-11-19' })
    // an older `true`, a non-day string or any other type never writes
    expect(normalizePendingSync({ ...marker, dateWrite: true })).toEqual(marker)
    expect(normalizePendingSync({ ...marker, dateWrite: 'today' })).toEqual(marker)
    expect(normalizePendingSync({ ...marker, dateWrite: 5 })).toEqual(marker)
  })

  it('repairs a half-written marker so the task still gets pushed', () => {
    const [task] = normalizeTasks([{ id: 'a', source: 'notion', externalId: 'a', pendingSync: { since: 5 } }], 'notion') as Array<{ pendingSync: unknown }>
    expect(task?.pendingSync).toEqual({ since: 5, attempts: 0, lastError: null })
  })

  it('drops a marker on a Local task (no upstream) but keeps its move (the origin copy is still to be removed)', () => {
    const pendingMove = { fromSource: 'notion', fromExternalId: 'p1', toSource: 'local' }
    const [local] = normalizeTasks([
      { id: 'l', source: 'local', externalId: null, pendingSync: marker, pendingMove },
    ], 'local') as Array<Record<string, unknown>>
    expect(local).not.toHaveProperty('pendingSync')
    expect(local).toHaveProperty('pendingMove', pendingMove)
  })

  it('keeps a move without a marker (the page is created, the origin copy is queued for removal)', () => {
    const pendingMove = { fromSource: 'local', fromExternalId: null, toSource: 'notion' }
    const tasks = [{ id: 'm', source: 'notion', externalId: 'page-9', pendingMove }]
    expect(normalizeTasks(tasks, 'notion')).toBe(tasks)
  })

  it('does not stamp an externalId on a moved task whose page is not created yet', () => {
    const pendingMove = { fromSource: 'local', fromExternalId: null, toSource: 'notion' }
    const [moved] = normalizeTasks([{ id: 'm', source: 'notion', externalId: null, pendingMove }], 'notion')
    expect(moved).toMatchObject({ externalId: null, pendingMove })
  })

  it('keeps the doubt of a move\'s origin create (#538) without a write; older moves load as before', () => {
    const withDoubt = { fromSource: 'notion', fromExternalId: null, toSource: 'todoist', fromCreateUncertain: { since: 1700000000000, at: 1700000009000, title: 'Rückruf' } }
    const tasks = [{ id: 'm', source: 'todoist', externalId: null, pendingMove: withDoubt }]
    expect(normalizeTasks(tasks, 'todoist')).toBe(tasks)
    const old = [{ id: 'o', source: 'todoist', externalId: null, pendingMove: { fromSource: 'notion', fromExternalId: null, toSource: 'todoist' } }]
    expect(normalizeTasks(old, 'todoist')).toBe(old)
  })

  it('reads a malformed origin doubt as none, and drops one once the origin page has an id', () => {
    const base = { fromSource: 'notion', toSource: 'todoist' }
    const bad = [
      { id: 'a', source: 'todoist', externalId: null, pendingMove: { ...base, fromExternalId: null, fromCreateUncertain: { since: 'x', title: 'a' } } },
      { id: 'b', source: 'todoist', externalId: null, pendingMove: { ...base, fromExternalId: null, fromCreateUncertain: 'yes' } },
      { id: 'c', source: 'todoist', externalId: null, pendingMove: { ...base, fromExternalId: 'P', fromCreateUncertain: { since: 1, title: 'a' } } },
    ]
    for (const task of normalizeTasks(bad, 'todoist') as Array<{ pendingMove: Record<string, unknown> }>) {
      expect(task.pendingMove).not.toHaveProperty('fromCreateUncertain')
    }
  })

  it('keeps the origin\'s "not planned" value of a move through the read (#357)', () => {
    const tasks = [{ id: 'm', source: 'local', externalId: null, pendingMove: { fromSource: 'notion', fromExternalId: 'P', toSource: 'local', fromSourceNotPlanned: 'Backlog' } }]
    expect(normalizeTasks(tasks, 'local')).toBe(tasks)
  })

  it('keeps the origin\'s held done state of a move through the read and drops a malformed one (#781)', () => {
    const pendingMove = { fromSource: 'todoist', fromExternalId: 'T', toSource: 'local', fromUpstreamDone: false }
    const tasks = [{ id: 'm', source: 'local', externalId: null, pendingMove }]
    expect(normalizeTasks(tasks, 'local')).toBe(tasks)
    const [bad] = normalizeTasks([{ ...tasks[0], pendingMove: { ...pendingMove, fromUpstreamDone: 'yes' } }], 'local') as Array<{ pendingMove: Record<string, unknown> }>
    expect(bad?.pendingMove).toEqual({ fromSource: 'todoist', fromExternalId: 'T', toSource: 'local' })
  })

  it('keeps a valid move next to its marker', () => {
    const pendingMove = { fromSource: 'local', fromExternalId: null, toSource: 'notion' }
    const tasks = [{ id: 'm', source: 'notion', externalId: 'm', pendingSync: marker, pendingMove }]
    expect(normalizeTasks(tasks, 'notion')).toBe(tasks)
  })

  it('leaves the externalId of a task created offline null, but still stamps a legacy task without a marker', () => {
    const [created] = normalizeTasks([{ id: 'n', source: 'notion', externalId: null, pendingSync: marker }], 'notion')
    const [legacy] = normalizeTasks([{ id: 'p', source: 'notion', externalId: null }], 'notion')
    expect(created).toMatchObject({ externalId: null, pendingSync: marker })
    expect(legacy).toMatchObject({ externalId: 'p' })
  })

  it('only Notion stores time spent', () => {
    expect(['local', 'notion', 'todoist'].map((id) => sourceSyncsTime(id as 'local'))).toEqual([false, true, false])
  })
})

describe('deleteLabelKey', () => {
  it('names the upstream for Notion and Todoist and stays plain for Local', () => {
    expect(deleteLabelKey('local')).toBe('task.delete.local')
    expect(deleteLabelKey('notion')).toBe('task.delete.notion')
    expect(deleteLabelKey('todoist')).toBe('task.delete.todoist')
  })
})

describe('sourceTaskUrl (#296)', () => {
  it('builds the Notion page URL from the external id, dashes removed', () => {
    expect(sourceTaskUrl({ source: 'notion', externalId: '1a2b3c4d-1111-2222-3333-444455556666' })).toBe('https://www.notion.so/1a2b3c4d111122223333444455556666')
  })

  it('builds the Todoist task URL from the external id', () => {
    expect(sourceTaskUrl({ source: 'todoist', externalId: '6Xc9Q' })).toBe('https://app.todoist.com/app/task/6Xc9Q')
  })

  it('has none for a Local task or a task whose create is still pending', () => {
    expect(sourceTaskUrl({ source: 'local', externalId: null })).toBeNull()
    expect(sourceTaskUrl({ source: 'local', externalId: 'x' })).toBeNull()
    expect(sourceTaskUrl({ source: 'notion', externalId: null })).toBeNull()
    expect(sourceTaskUrl({ source: 'todoist', externalId: null })).toBeNull()
  })
})

describe('sourceHomeUrl (#369)', () => {
  it('links Notion\'s database page, dashes removed, and nothing without a database id', () => {
    expect(sourceHomeUrl('notion', { notionDatabaseId: '1a2b3c4d-1111-2222-3333-444455556666' })).toBe('https://www.notion.so/1a2b3c4d111122223333444455556666')
    expect(sourceHomeUrl('notion')).toBeNull()
    expect(sourceHomeUrl('notion', { notionDatabaseId: null })).toBeNull()
  })

  it('links the Todoist app and has none for Local', () => {
    expect(sourceHomeUrl('todoist')).toBe('https://app.todoist.com/app/today')
    expect(sourceHomeUrl('local')).toBeNull()
  })
})

describe('Apple Reminders as a source (#551)', () => {
  it('normalizeSources keeps a connected reminders source and its default', () => {
    expect(normalizeSources({ connected: ['reminders'], default: 'local' })).toEqual({ connected: ['reminders'], default: 'local' })
    expect(normalizeSources({ connected: ['notion', 'reminders', 'reminders'], default: 'notion' })).toEqual({ connected: ['notion', 'reminders'], default: 'notion' })
  })

  it('a tasks list keeps Task.reminders through the hydrate normaliser', () => {
    const reminders = { due: { date: '2026-11-19', time: null }, recurrence: null, listId: 'L1' }
    const tasks = [{ id: 'r', source: 'reminders', externalId: 'r', reminders }]
    expect(normalizeTasks(tasks, 'local')).toBe(tasks)
    expect(normalizeTasks([{ id: 'r', source: 'reminders', reminders }], 'local')[0]).toMatchObject({ externalId: 'r', reminders })
  })

  it('sourceCan: Reminders cannot create, delete, move out or edit text; Local and Notion can do all four; Todoist cannot create', () => {
    for (const capability of ['create', 'remove', 'moveOut', 'editText'] as const) {
      expect(sourceCan('reminders', capability)).toBe(false)
      expect(sourceCan('local', capability)).toBe(true)
      expect(sourceCan('notion', capability)).toBe(true)
    }
    expect(sourceCan('todoist', 'create')).toBe(false)
    expect(sourceCan('todoist', 'remove')).toBe(true)
    expect(sourceCanCreate('reminders')).toBe(false)
  })

  it('names the source by its source name key, and reports its access problems under the reminders_access context', () => {
    expect(SETUP_ERROR_CONTEXTS.reminders).toBe('reminders_access')
    expect(SETUP_ERROR_CONTEXTS.notion).toBe('notion_setup')
    expect(sourceTaskUrl({ source: 'reminders', externalId: 'r' })).toBeNull()
    expect(deleteLabelKey('reminders')).toBe('task.delete.local')
  })
})
