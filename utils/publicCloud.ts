/**
 * @module utils/publicCloud
 * @description The public web instance is local-only (#742, ADR 021 "Local-only"): it offers no Notion, because a
 * server that relays a user's Notion token is what Notion's developer terms forbid. The desktop app keeps Notion (it
 * calls `api.notion.com` itself, the token stays in the Keychain); dev, the E2E build and every other build keep it too.
 */
import { isTauri } from '~/utils/isTauri'
import type { SourceId } from '~/types/taskSource'

/** The build serves the public web instance (`npm run build:cloudflare`). */
export function isPublicCloud(): boolean {
  return __PUBLIC_CLOUD__
}

/** Whether Notion can be set up and synced here: everywhere but the public web instance. */
export function isNotionAvailable(): boolean {
  return isTauri() || !isPublicCloud()
}

/**
 * Whether a source can be synced in this build. False only for a Notion source stored on the public instance (an
 * earlier setup, an import): it stays in the stored config, untouched, and the app treats it as paused (#742).
 */
export function isSourceAvailable(source: SourceId): boolean {
  return source !== 'notion' || isNotionAvailable()
}
