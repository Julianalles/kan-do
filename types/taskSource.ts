/**
 * @module types/taskSource
 * @description Task sources (epic #264, decisions D1/D2). Terms: `GLOSSARY.md`.
 * Local is implicit and always available; integrations (Notion, Todoist, Apple Reminders) are connected on top of it.
 */

/** An integration that can be connected as a task source. */
export type IntegrationSourceId = 'notion' | 'todoist' | 'reminders';

/** Where a task lives. `local` is the app itself: no upstream, persisted through Pinia only. */
export type SourceId = 'local' | IntegrationSourceId;

export const INTEGRATION_SOURCE_IDS: readonly IntegrationSourceId[] = ['notion', 'todoist', 'reminders'];
export const SOURCE_IDS: readonly SourceId[] = ['local', ...INTEGRATION_SOURCE_IDS];

/**
 * `boardConfig.sources`: which integrations are connected and where new tasks go.
 * Local is not listed in `connected`. `null` on the board config means "never onboarded".
 * Credentials stay in `notionConfig` / the Keychain (ADR 007), never here.
 */
export interface TaskSourcesConfig {
  connected: IntegrationSourceId[];
  default: SourceId;
}

/**
 * What kan-do may do with a task of a source beyond reading it and ticking it (#551). Absent on an adapter = every
 * capability is there (Local, Notion, Todoist). A source that is read-only in kan-do (Apple Reminders) says `false`;
 * every consumer reads the flag, none switches on the source's name (`sourceCan` in `lib/taskSources.ts`).
 */
export interface SourceCapabilities {
  /** A task can be created in the source: the add form's "Speichern in", a move into it. */
  create: boolean
  /** A task can be deleted at the source: the card menu's and the sheet's "Löschen". */
  remove: boolean
  /** A task of the source can be moved to another one ("Verschieben zu …"). */
  moveOut: boolean
  /** Title, notes, Thema and Aktivität can be edited in kan-do (a source that owns them, Reminders, shows them as text). */
  editText: boolean
}
