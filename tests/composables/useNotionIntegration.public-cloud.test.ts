/** #742: the factory never builds a Notion client on the public cloud, so a stored token cannot reach the server. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { setPublicCloud } from '../helpers/publicCloud'
import { useNotionIntegration } from '~/composables/useNotionIntegration'
import { useNotionConfigStore } from '~/store/notionConfig'

vi.mock('~/integrations/NotionIntegration', () => ({ NotionIntegration: vi.fn() }))

describe('useNotionIntegration.createInstance on the public cloud (#742)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useNotionConfigStore().setConfig({
      token: 't', databaseId: 'db', dataSourceId: 'ds', propertyMapping: { title: 'Name', status: 'Status' },
      statusMapping: { today: 'Today', doing: 'Doing', done: 'Done', waiting: null, archive: null },
    })
  })
  afterEach(() => setPublicCloud(false))

  it('builds the client where Notion is available', () => {
    expect(() => useNotionIntegration().createInstance()).not.toThrow()
  })

  it('throws on the public cloud even with a stored config', () => {
    setPublicCloud(true)
    expect(() => useNotionIntegration().createInstance()).toThrow()
  })
})
