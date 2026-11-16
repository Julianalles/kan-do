<!--
@page OverlayPage
@description The floating Now window's own route (#383, ADR 020): the pill, fed by Rust
@usage Opened only by the second Tauri window (`src-tauri/src/overlay.rs`) at `/overlay`; outside the desktop app it sends the visitor to the board
@responsibility
- Asks Rust for the current snapshot once mounted (`overlay_ready`, which also lets Rust show the window) and follows `overlay://state`
- Takes the UI language from the snapshot, so a language change in the main window reaches the pill
- Passes the pill's actions to Rust (`overlay_action`); reads no store and calls no data command
- Makes the page transparent: the window is transparent and only the capsule is drawn
-->
<template>
  <NowWindow :snapshot="snapshot" @action="onAction" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import NowWindow from '~/components/overlay/NowWindow.vue'
import { OVERLAY_STATE_EVENT, parseSnapshot, type NowSnapshot, type OverlayAction } from '~/lib/nowWindow'
import { isTauri } from '~/utils/isTauri'

definePageMeta({ layout: false })

const { locale, setLocale } = useI18n()
const snapshot = ref<NowSnapshot | null>(null)

function take(value: unknown): void {
  const next = parseSnapshot(value)
  snapshot.value = next
  if (next && (next.locale === 'de' || next.locale === 'en') && next.locale !== locale.value) void setLocale(next.locale)
}

async function onAction(kind: OverlayAction): Promise<void> {
  const taskId = snapshot.value?.taskId
  if (!taskId) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('overlay_action', { kind, taskId })
  } catch (error) {
    if (import.meta.dev) console.warn('[now-window] action failed:', error)
  }
}

let unlisten: (() => void) | null = null
let unmounted = false

onMounted(async () => {
  if (!isTauri()) {
    await navigateTo('/tasks', { replace: true })
    return
  }
  document.documentElement.classList.add('now-window-page')
  const { listen } = await import('@tauri-apps/api/event')
  const { invoke } = await import('@tauri-apps/api/core')
  const off = await listen<unknown>(OVERLAY_STATE_EVENT, (event) => take(event.payload))
  if (unmounted) {
    off()
    return
  }
  unlisten = off
  try {
    take(await invoke('overlay_ready'))
  } catch (error) {
    if (import.meta.dev) console.warn('[now-window] ready failed:', error)
  }
})

onBeforeUnmount(() => {
  unmounted = true
  unlisten?.()
})
</script>

<style>
html.now-window-page,
html.now-window-page body { background: transparent; overflow: hidden; }
</style>
