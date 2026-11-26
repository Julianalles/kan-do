import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref } from 'vue'
import { pruneLedger, sanitizeLedger, type AppliedLedger } from '~/lib/remoteBridge'

/**
 * State of the MCP bridge (ADR 023) that survives a restart: whether it is switched on, and the ledger of command ids this
 * app has already applied, so a result that could not be reported (the Worker still lists the command) never applies twice.
 * The Worker address and token are not here: Rust keeps them (`bridge_*`, Keychain entry `mcp-sync-token`).
 *
 * Additive and tolerant (persistence rules): nothing stored reads as off with an empty ledger, a malformed value reads
 * the same in memory, and nothing is written at hydration (#273).
 */
export const useRemoteBridgeStore = defineStore('remoteBridge', () => {
  const enabled = ref(false)
  const applied = ref<AppliedLedger>({})

  function setEnabled(value: boolean): void {
    enabled.value = value
  }

  function wasApplied(id: string): boolean {
    const ledger: unknown = applied.value
    return !!ledger && typeof ledger === 'object' && Object.hasOwn(ledger, id)
  }

  /** Records a command as applied and prunes old entries; a malformed stored ledger is replaced here, on the first write. */
  function markApplied(id: string, now: number): void {
    applied.value = pruneLedger({ ...sanitizeLedger(applied.value), [id]: now }, now)
  }

  return { enabled, applied, setEnabled, wasApplied, markApplied }
}, {
  persist: {
    key: 'remote-bridge-store',
    pick: ['enabled', 'applied'],
    // A stored value of the wrong shape reads as off / empty in memory; the next write replaces it.
    afterHydrate: (ctx: { store: { enabled: unknown; applied: unknown } }) => {
      if (typeof ctx.store.enabled !== 'boolean') ctx.store.enabled = false
      const ledger = sanitizeLedger(ctx.store.applied)
      if (JSON.stringify(ledger) !== JSON.stringify(ctx.store.applied)) ctx.store.applied = ledger
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRemoteBridgeStore, import.meta.hot))
}
