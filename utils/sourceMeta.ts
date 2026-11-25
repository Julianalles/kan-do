/**
 * @module utils/sourceMeta
 * @description What the UI shows of a source (#322, #323): the i18n key of its name and its bundled icon
 * (all `ph`, no remote fetch, ADR 012; never a Notion or Todoist logo: plain-text names only, #745). One map for the card's source
 * icon and the "Verschieben zu …" entries, so the two never drift. A move names its target with its own keys
 * (#841: "zum lokalen Speicher", "zu Notion"); the plain name ("Lokal") stays everywhere else.
 */
import type { SourceId } from '~/types/taskSource'

export interface SourceMeta {
  /** i18n key of the source's display name ("Lokal", "Notion", "Todoist", "Erinnerungen") */
  nameKey: string
  /** i18n key of the move target phrase ("zum lokalen Speicher", "zu Notion"), for the command palette (#841) */
  moveTargetKey: string
  /** i18n key of the child label under "Verschieben zu …" ("lokalem Speicher", "Notion") (#841) */
  moveMenuNameKey: string
  /** i18n key of the toast after a move ("Zum lokalen Speicher verschoben") (#841) */
  moveDoneKey: string
  /** Iconify name from a bundled collection */
  icon: string
}

const moveKeys = (id: SourceId) => ({
  moveTargetKey: `source.moveTarget.${id}`,
  moveMenuNameKey: `source.moveMenuName.${id}`,
  moveDoneKey: `source.moveDone.${id}`,
})

export const SOURCE_META: Record<SourceId, SourceMeta> = {
  local: { nameKey: 'source.name.local', ...moveKeys('local'), icon: 'i-ph-desktop' },
  notion: { nameKey: 'source.name.notion', ...moveKeys('notion'), icon: 'i-ph-notebook' },
  todoist: { nameKey: 'source.name.todoist', ...moveKeys('todoist'), icon: 'i-ph-check-square' },
  reminders: { nameKey: 'source.name.reminders', ...moveKeys('reminders'), icon: 'i-ph-list-checks' },
}

/** Meta of a source; a missing or unknown one (a task added without `source`) degrades to Local instead of throwing (#360) */
export function sourceMetaOf(source: string | null | undefined): SourceMeta {
  return (source != null && Object.hasOwn(SOURCE_META, source) ? SOURCE_META[source as SourceId] : undefined) ?? SOURCE_META.local
}

/** True for a source the app knows; a task without a valid one counts toward no source (#360) */
export function isKnownSource(source: string | null | undefined): source is SourceId {
  return source != null && Object.hasOwn(SOURCE_META, source)
}
