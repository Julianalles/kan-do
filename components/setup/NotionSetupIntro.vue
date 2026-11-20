<!--
@component NotionSetupIntro
@kind block
@category display
@description The first pane of the Notion setup on the welcome page (#441): a picture of Notion and Kan-Do exchanging tasks, one sentence, and what the user needs at hand as three badges. It says; it asks for nothing.
@usage <NotionSetupIntro /> inside NotionSetupFlow while its "Vorbereitung" step is current.
@avoid Only the first step of the welcome page's Notion setup; the settings dialog has no intro. No heading (the stepper names the step; the flow keeps a visually hidden one for focus) and no folded details.
@responsibility
- Shows the Notion ⇄ Kan-Do diagram (decorative), the sentence "Deine Aufgaben bleiben in Notion …" and "Das brauchst du" with the neutral badges Notion-Konto, Aufgaben-Datenbank and Token
- Writes, saves and validates nothing; it is shown on every Notion setup run (no "seen" flag)
- Pattern: step content of the guided setup (SetupRail); facts via SetupFactList
-->
<template>
  <div class="flex flex-col gap-6" data-testid="notion-intro">
    <div class="flex items-center justify-center gap-4 rounded-lg bg-elevated px-4 py-6" aria-hidden="true">
      <span class="flex flex-col items-center gap-1 text-xs text-muted">
        <span class="flex size-14 items-center justify-center rounded-lg border border-default bg-default">
          <UIcon name="i-ph-notion-logo" class="size-6 text-highlighted" />
        </span>
        {{ t('onboarding.flow.notion.intro.diagramNotion') }}
      </span>
      <UIcon name="i-ph-arrows-left-right" class="size-6 text-muted" />
      <span class="flex flex-col items-center gap-1 text-xs text-muted">
        <span class="flex size-14 items-center justify-center rounded-lg border border-default bg-default">
          <UIcon name="i-ph-kanban" class="size-6 text-highlighted" />
        </span>
        {{ t('onboarding.flow.notion.intro.diagramKanDo') }}
      </span>
    </div>
    <p class="text-body text-default">{{ t('onboarding.flow.notion.intro.sentence') }}</p>
    <div>
      <SectionHeader tag="p" size="label" class="mb-2 text-highlighted">{{ t('onboarding.flow.notion.intro.needs') }}</SectionHeader>
      <SetupFactList :label="t('onboarding.flow.notion.intro.needs')" :items="needs" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import SetupFactList from '~/components/setup/SetupFactList.vue'

defineOptions({ name: 'NotionSetupIntro' })

const { t } = useI18n()
const needs = computed(() => [
  { label: t('onboarding.flow.notion.intro.account'), icon: 'i-ph-user-circle' },
  { label: t('onboarding.flow.notion.intro.database'), icon: 'i-ph-database' },
  { label: t('onboarding.flow.notion.intro.token'), icon: 'i-ph-key' },
])
</script>
