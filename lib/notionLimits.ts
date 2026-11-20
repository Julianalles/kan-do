/**
 * @module lib/notionLimits
 * @description Limits of the Notion connection that the UI names too, kept apart from `NotionIntegration` so a
 * component can read them without importing the integration.
 */

/**
 * The most "not planned" pages one fetch loads (#357, D3): the most recently edited ones. A status mapped as "not
 * planned" may be an archive of thousands; without a limit every sync would read all of it. When Notion has more,
 * "Alle Aufgaben" and the settings say so (`notionConfig.notPlannedLimited`). The list of such a fetch is a part:
 * the merge keeps a held task it lacks (`FetchedTasks.partialNotPlanned`).
 */
export const NOT_PLANNED_PAGE_LIMIT = 500
