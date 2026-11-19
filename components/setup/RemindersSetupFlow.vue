<!--
@component RemindersSetupFlow
@kind block
@category input
@description The Apple Reminders setup as page content inside the welcome sheet (#552, epic #481 slice 3), shaped like NotionSetupFlow: the guide rail (md and up) or progress bar (below md) beside three steps, Zugriff, Listen, Heute. No dialog.
@usage <RemindersSetupFlow :also-notion="wantNotion" @back="leaveFlow" @complete="onRemindersConnected" /> inside pages/welcome.vue; `:first-run="false"` where the board is already set up (the settings page runs it to connect later)
@avoid Only the Reminders setup; changing the answers later is /settings/reminders, the Notion setup is NotionSetupFlow.
@responsibility
- Drives `useRemindersSetup`: the answers stay in the flow's state until the last button; Back (`BackButton`, from the first step it emits `back`, "Zurück zur Auswahl") connects and writes nothing
- Step 1 (RemindersAccessStep) announces the macOS permission and asks only after "Zugriff erlauben"; when access is granted but the lists cannot be read it says so and the primary button reads "Erneut versuchen"; step 2 lists every Reminders list with Thema (preselected), Aktivität or Aus (RemindersListChoices) and blocks "Weiter" while every list is Aus; step 3 (RemindersTodayRules) explains the date, its last button is "Verbinden", or "Weiter zu Notion" when Notion is ticked too
- "Verbinden" writes the roles and connects through `useSourceConnections`; a failure leaves nothing connected (a revoked permission returns to step 1 with the denied panel, anything else shows `connectFailed`)
- Completion: Reminders alone shows the short "Erinnerungen ist verbunden" beat and emits `complete`; with Notion next it emits `complete` at once (no beat: the Notion setup follows)
- Step changes animate one pane (fade and 14px slide, direction by forward or back), instant under reduced motion; after each change focus moves to the step's heading. Many lists scroll inside the step
- Pattern: first-run setup, aligned with NotionSetupFlow (rail, back, one primary button; the connected beat); step progress via SetupRail
-->
<template>
  <section class="reminders-setup-flow flex flex-col gap-5" data-testid="reminders-setup-flow" :aria-label="t('onboarding.flow.reminders.label')">
    <div v-if="done" ref="doneRef" class="flex flex-col items-center gap-3 py-16 text-center" role="status" tabindex="-1" data-testid="reminders-done">
      <span class="flex size-16 items-center justify-center rounded-full bg-inverted">
        <UIcon name="i-ph-check-bold" class="size-8 text-inverted" aria-hidden="true" />
      </span>
      <SectionHeader tag="p" size="display">{{ t('onboarding.flow.reminders.connected') }}</SectionHeader>
      <p class="text-body text-muted">{{ t('onboarding.flow.reminders.loadingBoard') }}</p>
    </div>

    <template v-else>
      <BackButton v-if="firstRun || setup.step.value > 0" :label="setup.step.value === 0 ? t('onboarding.flow.backToChoice') : t('common.back')" @click="goBack" />

      <div class="flex flex-col gap-6 md:grid md:grid-cols-[13rem_1fr] md:gap-10">
        <SetupRail
          :steps="railSteps"
          :current="setup.step.value"
          :help="help"
          :label="t('notion.modal.stepsLabel')"
          :done-label="t('notion.modal.stepDone')"
        />
        <div class="min-w-0">
          <div ref="paneRef">
            <SectionHeader
              ref="headingRef"
              tag="h2"
              size="display"
              tabindex="-1"
              class="mb-5 text-balance outline-none"
              data-testid="reminders-step-title"
            >
              {{ stepTitle }}
            </SectionHeader>

            <div class="max-h-[60dvh] overflow-y-auto md:max-h-(--modal-height-wizard)">
              <RemindersAccessStep
                v-if="setup.step.value === 0"
                :access="setup.access.value"
                :list-count="setup.listCount.value"
                :lists-failed="setup.listsFailed.value"
                @open-settings="setup.openSystemSettings"
              />

              <div v-else-if="setup.step.value === 1" class="flex flex-col gap-4" data-testid="reminders-lists-step">
                <p class="text-body text-default">{{ t('onboarding.flow.reminders.lists.lead') }}</p>
                <p v-if="setup.loadingLists.value" class="text-body text-muted" role="status" data-testid="reminders-lists-loading">
                  {{ t('onboarding.flow.reminders.lists.loading') }}
                </p>
                <p v-else-if="setup.noLists.value" class="text-body text-muted" data-testid="reminders-lists-none">
                  {{ t('onboarding.flow.reminders.lists.none') }}
                </p>
                <template v-else-if="setup.lists.value">
                  <p v-if="setup.allOff.value" class="text-body text-highlighted" role="status" data-testid="reminders-lists-empty">
                    {{ t('onboarding.flow.reminders.lists.empty') }}
                  </p>
                  <p class="text-sm text-muted">{{ t('onboarding.flow.reminders.lists.help') }}</p>
                  <RemindersListChoices :lists="setup.lists.value" :roles="roles" @pick="setup.setRole" />
                </template>
              </div>

              <RemindersTodayRules v-else show-lead />
            </div>
          </div>

          <UAlert
            v-if="setup.connectFailed.value"
            class="mt-4"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-ph-warning"
            :description="t('onboarding.flow.reminders.connectFailed')"
            data-testid="reminders-connect-failed"
          />
          <div class="mt-6 flex items-center justify-end">
            <UButton
              color="primary"
              :loading="primaryLoading"
              :disabled="!primaryEnabled"
              data-testid="reminders-proceed"
              @click="proceed"
            >
              {{ primaryLabel }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BackButton from '~/components/ui/BackButton.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import SetupRail from '~/components/setup/SetupRail.vue'
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

const paneRef = ref<HTMLElement | null>(null)
const headingRef = ref<{ $el: HTMLElement } | null>(null)
const doneRef = ref<HTMLElement | null>(null)
const done = ref(false)

/** How long the "connected" beat stays before the board loads (as the Notion setup) */
const DONE_BEAT_MS = 1000
let doneTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(doneTimer))

// The permission may already be given (an earlier run, a Back and forth): read it without prompting
onMounted(() => { void setup.refreshAccess() })

const STEPS = ['access', 'lists', 'today'] as const
const railSteps = computed(() => STEPS.map((key) => ({ key, label: t(`onboarding.flow.reminders.steps.${key}`) })))
const stepTitle = computed(() => [
  t('onboarding.flow.reminders.access.title'),
  t('onboarding.flow.reminders.lists.title'),
  t('onboarding.flow.reminders.today.title'),
][setup.step.value])
const help = computed(() => {
  const key = STEPS[setup.step.value]
  return t(key === 'today' && props.alsoNotion ? 'onboarding.flow.reminders.help.todayNotion' : `onboarding.flow.reminders.help.${key}`)
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

const reducedMotion = () => import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches
let direction: 1 | -1 = 1

watch(() => setup.step.value, async (next, prev) => {
  direction = next >= prev ? 1 : -1
  await nextTick()
  if (!reducedMotion()) {
    paneRef.value?.animate(
      [{ opacity: 0, transform: `translateX(${direction * 14}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 240, easing: 'cubic-bezier(.3,.8,.3,1)' },
    )
  }
  // preventScroll: the sheet must not jump while the pane slides in
  headingRef.value?.$el?.focus({ preventScroll: true })
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
  await nextTick()
  doneRef.value?.focus()
  doneTimer = setTimeout(() => emit('complete'), DONE_BEAT_MS)
}
</script>
