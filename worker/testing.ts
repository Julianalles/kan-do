/** Test double for the `NOTION_LIMITER` Durable Object namespace (#508): answers every hit with `success`, or throws. */
import { vi } from 'vitest'

export function limiterNamespace(success: boolean | Error) {
  const keys: string[] = []
  const hit = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (success instanceof Error) throw success
    return Response.json({ success })
  })
  const namespace = {
    idFromName: (name: string) => {
      keys.push(name)
      return { name } as unknown as DurableObjectId
    },
    get: () => ({ fetch: hit }) as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace
  return { namespace, hit, keys }
}
