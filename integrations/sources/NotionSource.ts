/**
 * @module integrations/sources/NotionSource
 * @description Thin adapter over `NotionIntegration`. The class is created per call from the current
 * Notion config (`useNotionIntegration`), so a changed config is picked up without a new adapter.
 */
import type { Task } from '~/types/task'
import type { IntegrationHealth } from '~/types/integration'
import type { NotionIntegration } from '~/integrations/NotionIntegration'
import { externalIdOf, sourceSyncsTime } from '~/lib/taskSources'
import { CreateLookupError, CreateWaitingError } from '~/lib/integrationHealth'
import { createMayLandUntil } from '~/lib/createLookup'
import { SourceNotConfiguredError, type CreateContext, type FetchedTasks, type TaskSourceAdapter } from './types'

export interface NotionSourceDeps {
  isConfigured: () => boolean
  /** Resolves a missing data source selection for a legacy config; `false` when it cannot. */
  ensureDataSource: () => Promise<boolean>
  createInstance: () => NotionIntegration
  /** The Notion status an archived task is written as; `null` when none is mapped. */
  archiveStatus: () => string | null
  /** The Notion status a put-back is written as (#357: the first mapped "not planned" status); `null` when none is mapped. */
  notPlannedStatus: () => string | null
  /** Told after every fetch whether Notion holds more "not planned" pages than were loaded. */
  onNotPlannedLimit?: (limited: boolean) => void
  health: () => IntegrationHealth
}

const NOT_CONFIGURED = 'Notion integration is not properly configured'

export class NotionSource implements TaskSourceAdapter {
  readonly id = 'notion' as const
  readonly syncsTime = sourceSyncsTime('notion')

  constructor(private readonly deps: NotionSourceDeps) {}

  isConfigured(): boolean {
    return this.deps.isConfigured()
  }

  private instance(): NotionIntegration {
    if (!this.deps.isConfigured()) throw new SourceNotConfiguredError('notion', NOT_CONFIGURED)
    return this.deps.createInstance()
  }

  async fetchActive(): Promise<Task[]> {
    return (await this.fetchActiveList()).tasks
  }

  /** The "not planned" pages are capped (#357): the list names the statuses it holds only in part. */
  async fetchActiveList(): Promise<FetchedTasks> {
    if (!this.deps.isConfigured()) throw new SourceNotConfiguredError('notion', NOT_CONFIGURED)
    if (!(await this.deps.ensureDataSource())) {
      throw new Error('Notion data source is not configured')
    }
    // One instance per fetch: what it says about its list belongs to this fetch alone
    const notion = this.deps.createInstance()
    const tasks = await notion.fetchActiveBoardTasks()
    this.deps.onNotPlannedLimit?.(notion.notPlannedLimited)
    return { tasks, partialNotPlanned: notion.notPlannedPartial, readInParts: notion.listReadInParts }
  }

  /** Planning is written to Notion only once the user mapped a "not planned" status (#357). */
  notPlannedHold(): string | null {
    return this.deps.isConfigured() ? this.deps.notPlannedStatus() : null
  }

  timeHolding(): (seconds: number) => number {
    const notion = this.deps.createInstance()
    return (seconds) => notion.heldTimeSeconds(seconds)
  }

  async timeWritable(): Promise<boolean> {
    if (!this.deps.isConfigured()) return true
    return this.deps.createInstance().timeIsWritable()
  }

  async create(draft: Partial<Task>, ctx?: CreateContext): Promise<Task> {
    // `createInstance` rejects an unconfigured Notion with the localized setup error the add form shows
    const notion = this.deps.createInstance()
    // An earlier create ended with an unknown outcome (#528): the page may exist. Look for it first and adopt it; a
    // failed lookup rejects (the task stays queued), it never falls through to a create that could duplicate the page.
    const doubt = draft.externalId == null ? draft.pendingSync?.createUncertain : undefined
    if (doubt) {
      let pageId: string | null
      try {
        pageId = await notion.findLandedPage(doubt.title, doubt.since, ctx?.claimedExternalIds)
      } catch (error) {
        throw new CreateLookupError(error)
      }
      if (pageId !== null) {
        // The page holds the draft as it was sent; the task may have changed since, so its current state goes onto it
        let held: Task
        try {
          held = await notion.updateTask({ ...draft, externalId: pageId } as Task)
        } catch (error) {
          // No create was sent: the doubt (and the title it was made under) stays, so the next try finds the page again
          throw new CreateLookupError(error)
        }
        return { ...draft, ...held, id: draft.id ?? pageId, source: 'notion', externalId: pageId } as Task
      }
      // Nothing found, but a request that timed out in the browser can still be running at the proxy: it may land
      // after this lookup. Until the wait is over a create could make the second page.
      if (Date.now() < createMayLandUntil(doubt)) throw new CreateWaitingError()
    }
    return notion.createTask(draft)
  }

  async update(task: Task, change: { timeEdited?: boolean } = {}): Promise<Task | null> {
    return change.timeEdited ? this.instance().updateTask(task, { timeEdited: true }) : this.instance().updateTask(task)
  }

  async remove(task: Task): Promise<void> {
    await this.instance().archiveTask(externalIdOf(task))
  }

  /**
   * Un-archives the task's page and writes the snapshot onto it (the page kept the properties of the last
   * upstream write, which may differ from the snapshot). A page Notion no longer has (404) is created anew.
   */
  async restore(task: Task): Promise<Task> {
    const notion = this.instance()
    if (task.externalId !== null) {
      let gone = false
      try {
        await notion.unarchiveTask(externalIdOf(task))
      } catch (error) {
        // Only the un-archive says "gone"; a 404 from the write below must not create a second page
        if ((error as { statusCode?: number } | null)?.statusCode !== 404) throw error
        gone = true
      }
      if (!gone) {
        const held = await notion.updateTask(task)
        return { ...task, ...(held ?? {}), id: task.id, source: 'notion', externalId: task.externalId }
      }
    }
    const created = await notion.createTask(task)
    return { ...task, ...created, id: task.id, source: 'notion', externalId: created.externalId ?? created.id }
  }

  /** Without a configuration the mapping is unknown: answer yes, so the write fails once as not configured. */
  archivesAsStatus(): boolean {
    return !this.deps.isConfigured() || this.deps.archiveStatus() !== null
  }

  health(): IntegrationHealth {
    return this.deps.health()
  }
}
