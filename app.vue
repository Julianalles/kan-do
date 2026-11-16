<!--
@component AppRoot
@description Root of the app: the floating Now window's pill in its own window, the whole app shell everywhere else
@usage Always rendered as the top-level component
@responsibility
- Switch on `isOverlayWindow()` (#383, ADR 020): the second Tauri window loads this same bundle at `/overlay` and must run
  none of the shell (no data file, timers, menu or updater), so the shell is a component of its own (`components/AppShell.vue`)
  that the pill window never mounts
-->
<template>
  <NuxtPage v-if="overlay" />
  <AppShell v-else />
</template>

<script setup lang="ts">
import AppShell from '~/components/AppShell.vue'
import { isOverlayWindow } from '~/lib/overlayWindow'

const overlay = isOverlayWindow()
</script>
