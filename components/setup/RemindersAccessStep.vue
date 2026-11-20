<!--
@component RemindersAccessStep
@kind block
@category input
@description Step 1 of the Apple Reminders setup (#552): says what macOS will ask and what Kan-Do does and never does with the access, before the prompt appears, then shows the answer (asking, granted with the list count, granted but the lists unreadable, denied with the way out).
@usage <RemindersAccessStep :access="access" :list-count="n" :lists-failed="failed" @open-settings="…" /> as the first step's pane content of RemindersSetupFlow (SetupShell; no heading and no scroll area of its own, the rail names the step); the buttons "Zugriff erlauben", "Weiter" and "Erneut prüfen" are the flow's one primary button
@avoid Only the access step of the Reminders setup; the later state of the permission is the "Zugriff" section of /settings/reminders.
@responsibility
- Before the click: the intro, the preview of the macOS dialog (its usage string, until the Mac check of slice 1 confirms the real wording), and three facts (why full access, what Kan-Do never does, how to revoke)
- After it: one live region (`aria-live="polite"`) at the top of the step holds the waiting line, the granted line ("Kan-Do sieht {n} Listen") or the denied panel, so the answer is always at the top of the pane; once access is granted the announcement folds away
- Granted but the lists could not be read: a warning alert instead of the count (never "0 Listen"); the flow's primary button reads "Erneut versuchen"
- Denied (also restricted or write-only): a warning alert with how to allow it and "Systemeinstellungen öffnen" (the flow's primary button reads "Erneut prüfen"); never a toast, never a dialog
- Pattern: explain before a system permission, new (no existing pattern; searched: permission, access, prompt); denied panel aligned with the disconnect dialog's UAlert
-->
<template>
  <div class="flex flex-col" data-testid="reminders-access-step">
    <!-- The live region stays mounted (it announces the answer); its gap to the intro exists only while it holds something, so the first line of the pane aligns with the rail -->
    <div aria-live="polite" class="flex flex-col gap-3" :class="{ 'has-[*]:mb-5': access !== 'granted' }">
      <p v-if="access === 'asking'" class="text-body text-muted" data-testid="reminders-asking">
        {{ t('onboarding.flow.reminders.access.waiting') }}
      </p>
      <UAlert
        v-else-if="access === 'granted' && listsFailed"
        color="warning"
        variant="subtle"
        icon="i-ph-warning"
        :title="t('onboarding.flow.reminders.access.listsFailedTitle')"
        :description="t('onboarding.flow.reminders.access.listsFailedText')"
        data-testid="reminders-lists-failed"
      />
      <p v-else-if="access === 'granted'" class="flex items-center gap-2 text-body text-highlighted" data-testid="reminders-granted">
        <UIcon name="i-ph-check-circle-fill" class="size-5 shrink-0 text-primary" aria-hidden="true" />
        {{ t('onboarding.flow.reminders.access.granted', { n: listCount }, listCount) }}
      </p>
      <UAlert
        v-else-if="access === 'denied'"
        color="warning"
        variant="subtle"
        icon="i-ph-warning"
        orientation="vertical"
        :title="t('onboarding.flow.reminders.access.deniedTitle')"
        :description="t('onboarding.flow.reminders.access.deniedText')"
        data-testid="reminders-denied"
      >
        <template #actions>
          <UButton color="neutral" variant="soft" :icon="ICONS.external" data-testid="reminders-open-settings" @click="emit('open-settings')">
            {{ t('onboarding.flow.reminders.access.openSettings') }}
          </UButton>
        </template>
      </UAlert>
    </div>
    <div v-if="access !== 'granted'" class="flex flex-col gap-5">
      <p class="text-body text-default">{{ t('onboarding.flow.reminders.access.intro') }}</p>

      <div class="flex items-start gap-3 rounded-lg bg-muted p-4" data-testid="reminders-prompt-preview">
        <span class="flex size-10 shrink-0 items-center justify-center rounded-md border border-default bg-default">
          <UIcon name="i-ph-list-checks" class="size-5 text-highlighted" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <p class="text-sm text-muted">{{ t('onboarding.flow.reminders.access.previewLabel') }}</p>
          <p class="font-medium text-highlighted">{{ t('onboarding.flow.reminders.access.previewText') }}</p>
        </div>
      </div>

      <dl class="flex flex-col gap-4">
        <div v-for="fact in facts" :key="fact">
          <dt class="text-sm font-medium text-highlighted">{{ t(`onboarding.flow.reminders.access.${fact}Title`) }}</dt>
          <dd class="text-body text-muted">{{ t(`onboarding.flow.reminders.access.${fact}Text`) }}</dd>
        </div>
      </dl>
    </div>

  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SetupAccess } from '~/composables/useRemindersSetup'
import { ICONS } from '~/lib/icons'

defineOptions({ name: 'RemindersAccessStep' })

defineProps<{
  access: SetupAccess
  /** How many lists Reminders has (the granted line) */
  listCount: number
  /** Access is granted but reading the lists failed: the step says so (the flow's primary button reads "Erneut versuchen") */
  listsFailed?: boolean
}>()

const emit = defineEmits<{ (e: 'open-settings'): void }>()

const { t } = useI18n()
const facts = ['why', 'never', 'later'] as const
</script>
