<!--
@component RemindersSetupFlow
@kind block
@category input
@description The Apple Reminders setup (#552, epic #481 slice 3) on the setup shell (#650, epic #607 slice 3): the rail (md and up) or progress bar (below md) beside three steps, Zugriff, Listen, Heute, one footer bar with Zurück and Weiter. No dialog. Both hosts render it: the welcome sheet (first run) and `/settings/reminders` while Reminders is not connected.
@usage <RemindersSetupFlow :also-notion="wantNotion" @back="leaveFlow" @complete="onRemindersConnected" /> inside pages/welcome.vue; `:first-run="false"` where the board is already set up (the settings page runs it to connect later)
@avoid Only the Reminders setup; changing the answers later is /settings/reminders, the Notion setup is NotionSetupFlow.
@responsibility
- Fills `SetupShell` (rail, pane, footer, done beat, error alert) and drives `useRemindersSetup`: the answers stay in the flow's state until the last button; Zurück connects and writes nothing
- No visible step heading (the rail names the step, rule "say it once"); no scroll area inside the page at any step: many lists scroll with the page, the pane eases to its content in 300 ms (loading line, lists, denied panel, connect failure)
- Footer: first run step 1 "Zurück zur Auswahl" (emits `back`); in the settings host step 1 has no Zurück of its own (the page's "Zurück zu Einstellungen" leads out, #596); later steps "Zurück"; the primary button is `reminders-proceed`
- Step 1 (RemindersAccessStep) announces the macOS permission and asks only after "Zugriff erlauben"; when access is granted but the lists cannot be read it says so and the primary button reads "Erneut versuchen"; step 2 lists every Reminders list with Thema (preselected), Aktivität or Aus (RemindersListChoices) and blocks "Weiter" while every list is Aus (loading: `LoadingLine`; no lists: `EmptyNote`); step 3 (RemindersTodayRules) explains the date, its last button is "Verbinden", or "Weiter zu Notion" when Notion is ticked too
- "Verbinden" writes the roles and connects through `useSourceConnections`; a failure leaves nothing connected (a revoked permission returns to step 1 with the denied panel, anything else shows `connectFailed` as the shell's subtle alert and the user stays on the step)
- Completion: Reminders alone shows the shell's "Erinnerungen ist verbunden" beat (`setup-done`) and emits `complete`; with Notion next it emits `complete` at once (no beat: the Notion setup follows)
- Pattern: first-run setup on SetupShell, aligned with the other setup flows (rail, footer, connected beat); step progress via SetupRail
-->
<template>
  <section class="reminders-setup-flow" data-testid="reminders-setup-flow" :aria-label="t('onboarding.flow.reminders.label')">
    <SetupShell
      :steps="railSteps"
      :current="setup.step.value"
      :help="help"
      :back-label="backLabel"
      :next-label="primaryLabel"
      next-test-id="reminders-proceed"
      :next-disabled="!primaryEnabled"
      :loading="primaryLoading"
      :error="setup.connectFailed.value ? t('onboarding.flow.reminders.connectFailed') : null"
      error-test-id="reminders-connect-failed"
      :done="done"
      :done-title="t('onboarding.flow.reminders.connected')"
      :done-hint="t('onboarding.flow.reminders.loadingBoard')"
      @back="goBack"
      @next="proceed"
    >
      <RemindersAccessStep
        v-if="setup.step.value === 0"
        :access="setup.access.value"
        :list-count="setup.listCount.value"
        :lists-failed="setup.listsFailed.value"
        @open-settings="setup.openSystemSettings"
      />

      <div v-else-if="setup.step.value === 1" class="flex flex-col gap-4" data-testid="reminders-lists-step">
        <p class="text-body text-default">{{ t('onboarding.flow.reminders.lists.lead') }}</p>
        <LoadingLine v-if="setup.loadingLists.value" data-testid="reminders-lists-loading">
          {{ t('onboarding.flow.reminders.lists.loading') }}
        </LoadingLine>
        <EmptyNote v-else-if="setup.noLists.value" data-testid="reminders-lists-none">
          {{ t('onboarding.flow.reminders.lists.none') }}
        </EmptyNote>
        <template v-else-if="setup.lists.value">
          <p v-if="setup.allOff.value" class="text-body text-highlighted" role="status" data-testid="reminders-lists-empty">
            {{ t('onboarding.flow.reminders.lists.empty') }}
          </p>
          <p class="text-sm text-muted">{{ t('onboarding.flow.reminders.lists.help') }}</p>
          <RemindersListChoices :lists="setup.lists.value" :roles="roles" @pick="setup.setRole" />
        </template>
      </div>

      <RemindersTodayRules v-else show-lead />
    </SetupShell>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import EmptyNote from '~/components/ui/EmptyNote.vue'
import LoadingLine from '~/components/ui/LoadingLine.vue'
import SetupShell from '~/components/setup/SetupShell.vue'
import RemindersAccessStep from '~/components/setup/RemindersAccessStep.vue'
import RemindersListChoices from '~/components/setup/RemindersListChoices.vue'
import RemindersTodayRules from '~/components/setup/RemindersTodayRules.vue'
import { useRemindersSetup } from '~/composables/useRemindersSetup'
import { DEFAULT_LIST_ROLE, type ReminderListRole } from '~/lib/remindersSource'

defineOptions({ name: 'RemindersSetupFlow' })

const props = withDefaults(defineProps<{
  /** Notion is ticked too: the last button reads "Weiter zu Notion" and no beat is shown (the Notion setup follows) */
  alsoNotion?: boolean
  /** The welcome flow's first run: the board is onboarded as Local when Reminders connects */
  firstRun?: boolean
}>(), { alsoNotion: false, firstRun: true })

const emit = defineEmits<{ (e: 'back' | 'complete'): void }>()

const { t } = useI18n()
const setup = useRemindersSetup({ firstRun: props.firstRun })

const done = ref(false)

/** How long the "connected" beat stays before the board loads (as the Notion setup) */
const DONE_BEAT_MS = 1000
let doneTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(doneTimer))

// The permission may already be given (an earlier run, a Back and forth): read it without prompting
onMounted(() => { void setup.refreshAccess() })

const STEPS = ['access', 'lists', 'today'] as const
const railSteps = computed(() => STEPS.map((key) => ({ key, label: t(`onboarding.flow.reminders.steps.${key}`) })))
const help = computed(() => {
  const key = STEPS[setup.step.value]
  return t(key === 'today' && props.alsoNotion ? 'onboarding.flow.reminders.help.todayNotion' : `onboarding.flow.reminders.help.${key}`)
})

/** The first step leads out only where the flow has somewhere to go: the welcome choice. The settings page's own link leaves it (#596) */
const backLabel = computed(() => {
  if (setup.step.value > 0) return t('common.back')
  return props.firstRun ? t('onboarding.flow.backToChoice') : undefined
})

const roles = computed<Record<string, ReminderListRole>>(() =>
  Object.fromEntries((setup.lists.value ?? []).map((list) => [list.id, setup.roleOf(list.id) ?? DEFAULT_LIST_ROLE])),
)

const primaryLabel = computed(() => {
  if (setup.step.value === 0) {
    if (setup.access.value === 'granted') return t(setup.listsFailed.value ? 'onboarding.flow.reminders.access.retry' : 'notion.modal.next')
    return t(setup.access.value === 'denied' ? 'onboarding.flow.reminders.access.recheck' : 'onboarding.flow.reminders.access.allow')
  }
  if (setup.step.value === 1) return t('notion.modal.next')
  return t(props.alsoNotion ? 'onboarding.flow.reminders.toNotion' : 'onboarding.flow.reminders.connect')
})
const primaryLoading = computed(() => (setup.step.value === 0 && (setup.access.value === 'asking' || setup.loadingLists.value)) || (setup.step.value === 2 && setup.connecting.value))
const primaryEnabled = computed(() => {
  // Step 1 always has an action: ask, continue or check again (continuing waits for the lists)
  if (setup.step.value === 0) return setup.access.value !== 'granted' || setup.listsFailed.value || setup.canProceed.value
  return setup.canProceed.value
})

function goBack() {
  if (!setup.back()) emit('back')
}

async function proceed() {
  const { step, access } = setup
  if (step.value === 0) {
    if (access.value === 'idle') return setup.requestAccess()
    if (access.value === 'denied') return setup.recheck()
    if (setup.listsFailed.value) return setup.loadLists()
    return setup.next()
  }
  if (step.value === 1) return setup.next()
  const outcome = await setup.connect()
  if (outcome !== 'connected') return
  if (props.alsoNotion) return emit('complete')
  done.value = true
  doneTimer = setTimeout(() => emit('complete'), DONE_BEAT_MS)
}
</script>
