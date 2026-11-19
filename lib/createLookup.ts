/**
 * The lookup of a page that a create with an unknown outcome may have made (#528), shared by the two places that
 * look: `NotionIntegration.findLandedPage` (a query before a create) and `tasksStore.mergeTasks` (a fetched list
 * that holds the page already). One rule, so a page the fetch hands over and a page the push finds are the same one.
 */
import type { CreateUncertain } from '~/types/task'

/** A page counts when it was created this long before the first doubtful create: the clock of Notion and the one here differ. */
export const CREATE_LOOKUP_SLACK_MS = 5 * 60 * 1000

/**
 * How long after its last doubtful attempt a create may still land. The browser gives up after 10 s, but the proxy
 * keeps waiting on Notion (`@notionhq/client`: 60 s per request, its own retries on a 429 or 529 on top), so the page
 * can appear a minute or more later. Until then a lookup that finds nothing proves nothing and must not create.
 */
export const CREATE_LANDING_WAIT_MS = 2 * 60 * 1000

/** The earliest creation time (epoch ms) a page of this doubt may have. */
export const landedPageFrom = (doubt: Pick<CreateUncertain, 'since'>): number => Math.max(0, doubt.since - CREATE_LOOKUP_SLACK_MS)

/** When a lookup that finds nothing may stop waiting and create (epoch ms). Without `at` (an older marker) `since` stands in. */
export const createMayLandUntil = (doubt: Pick<CreateUncertain, 'since' | 'at'>): number => (doubt.at ?? doubt.since) + CREATE_LANDING_WAIT_MS

/** Whether a page with this `title` and creation time can be the one the doubtful create made. */
export const isLandedCandidate = (page: { title: string; createdAtMs: number | null }, doubt: CreateUncertain): boolean =>
  page.createdAtMs !== null && Number.isFinite(page.createdAtMs) && page.createdAtMs >= landedPageFrom(doubt) && page.title === doubt.title
