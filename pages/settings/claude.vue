<!--
@component ClaudeSettingsPage
@description Desktop-only sub-page /settings/claude: connect Kan-do to the owner's MCP Worker so Claude on the phone can read the board and queue changes (ADR 023)
@usage Settings, "Verwalten", "Claude-Anbindung" (desktop only)
@responsibility
- Same sub-page pattern as /settings/github: PageHeader with back link, one flat column; the content is `ClaudeBridgeSection`
-->
<template>
  <NuxtLayout name="sub-page">
    <div class="space-y-10">
      <ClaudeBridgeSection />
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import ClaudeBridgeSection from '~/components/settings/ClaudeBridgeSection.vue';

defineOptions({ name: 'ClaudeSettingsPage' });

definePageMeta({
  layout: false,
  pageWidth: 'narrow', // one 672 px column on the app bar's axis (#673)
  middleware: 'desktop-only',
  titleKey: 'settings.claude.pageTitle',
  descriptionKey: 'settings.claude.pageDescription',
});
</script>
