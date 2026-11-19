import { createNotionClient } from '~/server/utils/notionClient'
import { defineEventHandler } from 'h3'
import { validateRequest, handleNotionError, parseMappings } from '~/server/utils/apiError'
import { getStubPages, isNotionStubEnabled } from '~/server/utils/notionStub'

export default defineEventHandler(async (event) => {
  // Validate required query parameters
  const query = validateRequest(event, ['token', 'databaseId', 'dataSourceId', 'propertyMapping', 'statusMapping'])
  const token = query.token as string
  const _databaseId = query.databaseId as string
  const dataSourceId = query.dataSourceId as string
  
  // Both mappings must be JSON objects: a `null` would throw below, outside any try (#525)
  const { propertyMapping, statusMapping } = parseMappings(query)

    if (isNotionStubEnabled(token)) {
      return getStubPages(token)
    }

    const notion = createNotionClient(token, '2025-09-03')
    
    // Build filter array with mapped status values
    const statusFilters = [
      {
        property: propertyMapping.status,
        select: {
          equals: statusMapping.today,
        },
      },
      {
        property: propertyMapping.status,
        select: {
          equals: statusMapping.doing,
        },
      },
      {
        property: propertyMapping.status,
        select: {
          equals: statusMapping.done,
        },
      },
    ]
    
    // Add waiting status if it's configured
    if (statusMapping.waiting) {
      statusFilters.push({
        property: propertyMapping.status,
        select: {
          equals: statusMapping.waiting,
        },
      });
    }

    let response: { results?: unknown[] } | undefined
    try {
      response = await notion.request({
        method: 'post',
        path: `data_sources/${dataSourceId}/query`,
        body: {
          filter: {
            or: statusFilters,
          },
        },
      }) as { results?: unknown[] }
    } catch (error) {
      handleNotionError(error, event)
    }

    return response?.results ?? [];
});
