import { defineEventHandler } from 'h3'
import { getTokenFromEvent, handleNotionError } from '~/server/utils/apiError'
import { isNotionStubEnabled, stubFailureError, stubFailureStatus } from '~/server/utils/notionStub'

/**
 * Lets E2E specs and agents exercise Notion error paths without a real failure:
 * a stub token with `fail=<status>` fails every `/api/notion/*` request.
 * See `stubFailureStatus` in `server/utils/notionStub.ts`.
 */
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/notion/')) return
  const token = getTokenFromEvent(event)
  if (!token || !isNotionStubEnabled(token)) return
  const status = stubFailureStatus(token)
  if (status !== null) handleNotionError(stubFailureError(status))
})
