<!--
@component SyncWarningModal
@kind block
@category overlay
@description The question a source's sync raises when it returns nothing (or far less than the board holds): one calm lead sentence, "nothing has been changed yet" and "Was trifft zu?" with two answers; the footer follows the answer (apply the sync, or keep the board). Names the source (#318, #369)
@usage Mounted once in pages/tasks.vue, opened by useSyncValidation; `action` carries the answer, closing the dialog counts as "keep the board"
@avoid Only for a suspiciously empty or small sync result; a broken source is repaired through the sync popover, never a dialog.
@responsibility
- Say in one sentence (the dialog's description) what the app suspects, that nothing was changed yet, and let the user answer what happened; no answer is preselected and the footer button stays disabled until there is one (nothing destructive is the default)
- Emit `action` once per warning: 'confirm' for "Ja, das habe ich so gemacht" (the caller applies the fetched tasks), 'cancel' for "Nein oder nicht sicher" and for every close (Esc, the X, a click outside); the caller applies or drops the fetched tasks
- Offer "<Source> öffnen" so the user can check first; it opens the source outside the app and leaves the dialog open
- Fold the possible causes behind a native `<details>`, the same fold as the day close's open tasks; the stored count and the last sync are not shown, the lead sentence names the case
-->
<script setup lang="ts">
import { RadioGroupRoot } from 'reka-ui'
import { useI18n } from 'vue-i18n'
import AppDialog from '~/components/ui/AppDialog.vue'
import ChoiceCard from '~/components/ui/ChoiceCard.vue'
import ExternalLink from '~/components/ui/ExternalLink.vue'
import { ICONS } from '~/lib/icons'
import { integrationLabel, sourceHomeUrl } from '~/lib/taskSources'
import { useNotionConfigStore } from '~/store/notionConfig'
import type { SourceId } from '~/types/taskSource'

defineOptions({ name: 'SyncWarningModal' })

interface Props {
  open: boolean
  /** The source whose sync looks suspicious */
  source: SourceId | null
  /** Why it looks suspicious: an empty result, or a drop of more than 80% */
  reason: string | null
  /** Stored tasks of that source */
  currentTaskCount: number
  /** Tasks the sync returned for it */
  fetchedCount: number
}

interface Emits {
  (e: 'update:open', value: boolean): void
  (e: 'action', action: 'confirm' | 'cancel'): void
}

type Answer = 'yes' | 'no'

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { t } = useI18n()

/** Nothing is preselected: the footer button waits for the user's answer */
const answer = ref<Answer | null>(null)
// A queued warning of another source (or a newer one of the same) starts without an answer
watch(() => [props.open, props.source, props.reason, props.currentTaskCount, props.fetchedCount], () => { answer.value = null })

// The dialog is closed from outside only by the caller answering the warning; Esc, the X and a click outside land here
// and count as "keep the board"
const localOpen = computed({
  get: () => props.open,
  set: (value) => {
    if (!value) emit('action', 'cancel')
    emit('update:open', value)
  },
})

const submit = () => {
  if (answer.value === null) return
  emit('action', answer.value === 'yes' ? 'confirm' : 'cancel')
}

const sourceName = computed(() => (props.source && props.source !== 'local' ? integrationLabel(props.source) : ''))
const isDrop = computed(() => props.reason === 'significant_task_count_drop')
const notionConfig = useNotionConfigStore()
const sourceUrl = computed(() => (props.source ? sourceHomeUrl(props.source, { notionDatabaseId: notionConfig.config?.databaseId }) : null))
const answerLabelId = useId()
</script>

<template>
  <AppDialog
    v-model:open="localOpen"
    :title="t('sync.warning.title')"
    :description="isDrop ? t('sync.warning.leadDrop', { source: sourceName, fetched: fetchedCount, count: currentTaskCount }) : t('sync.warning.leadEmpty', { source: sourceName })"
    close
    size="sm"
  >
    <template #body>
      <div class="space-y-4" data-testid="sync-warning">
        <p class="text-sm text-toned">{{ t('sync.warning.untouched') }}</p>

        <div class="space-y-2">
          <p :id="answerLabelId" class="text-sm font-medium text-highlighted">{{ t('sync.warning.question') }}</p>
          <RadioGroupRoot v-model="answer" class="space-y-2" :aria-labelledby="answerLabelId">
            <ChoiceCard value="yes" icon="i-ph-check-circle" data-testid="sync-warning-yes">
              {{ t('sync.warning.choiceYes') }}
              <template #hint>{{ t('sync.warning.choiceYesHint', { source: sourceName }) }}</template>
            </ChoiceCard>
            <ChoiceCard value="no" icon="i-ph-question" data-testid="sync-warning-no">
              {{ t('sync.warning.choiceNo') }}
              <template #hint>{{ t('sync.warning.choiceNoHint') }}</template>
            </ChoiceCard>
          </RadioGroupRoot>
        </div>

        <details class="group" data-testid="sync-warning-causes">
          <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-sm text-toned hover:text-highlighted focus-ring">
            <UIcon :name="ICONS.forward" class="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
            {{ t('sync.warning.causesTitle') }}
          </summary>
          <ul class="ml-6 list-disc space-y-1 text-sm text-toned">
            <li>{{ t('sync.warning.causeEmpty', { source: sourceName }) }}</li>
            <li>{{ t('sync.warning.causeReach', { source: sourceName }) }}</li>
            <li>{{ t('sync.warning.causeFilter', { source: sourceName }) }}</li>
          </ul>
        </details>
      </div>
    </template>

    <template #footer>
      <ExternalLink
        v-if="sourceUrl"
        :href="sourceUrl"
        class="mr-auto inline-flex min-h-11 items-center gap-1.5 text-sm text-toned underline underline-offset-2 hover:text-highlighted"
        data-testid="sync-warning-open"
      >
        <UIcon :name="ICONS.external" class="size-4" aria-hidden="true" />
        {{ t('sync.warning.open', { source: sourceName }) }}
      </ExternalLink>
      <UButton
        :label="answer === 'yes' ? t('sync.warning.apply') : answer === 'no' ? t('sync.warning.keep') : t('sync.warning.choose')"
        :color="answer === null ? 'neutral' : 'primary'"
        size="lg"
        :disabled="answer === null"
        data-testid="sync-warning-submit"
        @click="submit"
      />
    </template>
  </AppDialog>
</template>
