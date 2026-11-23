/**
 * @module feedback/retention
 * @description How long relayed feedback is kept, and where its screenshots live (#744). No imports: the server relay,
 * the feedback form and `scripts/feedback-cleanup.mts` (plain Node) all read this file.
 *
 * Retention (maintainer's decision, 2026-11-23): an issue and its screenshot are deleted `FEEDBACK_RETENTION_DAYS` after
 * the issue is closed. An open issue is kept while it is being worked on. This is the one place to change the period:
 * the form states it before sending, the cleanup applies it, and the privacy notice on the homepage must say the same.
 *
 * Screenshots: each relayed image is the only file of its own parentless branch (`screenshot/<uuid>`), never a commit
 * on the default branch. Deleting that branch leaves the image in no reachable history (GDPR Art. 17), without
 * rewriting anything else.
 */
export const FEEDBACK_RETENTION_DAYS = 30

export const RELAY_SCREENSHOT_BRANCH_PREFIX = 'screenshot/'

/** `feedback/2026/11/<uuid>.png` → `screenshot/<uuid>`. */
export function relayScreenshotBranch(path: string): string {
  const file = path.split('/').pop() ?? path
  return `${RELAY_SCREENSHOT_BRANCH_PREFIX}${file.replace(/\.png$/, '')}`
}

/** An issue closed before this instant is due for deletion at `now`. */
export function retentionCutoff(now: Date, days = FEEDBACK_RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}
