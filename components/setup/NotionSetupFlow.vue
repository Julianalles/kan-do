<!--
@component NotionSetupFlow
@kind block
@category input
@description The Notion setup as page content inside the welcome sheet (#43): guide rail (md and up) or progress bar (below md)
  next to the existing wizard steps, the back button and the proceed button. No dialog.
@usage <NotionSetupFlow @back="flow = null" @complete="onConnected" /> inside pages/welcome.vue
@avoid Only the Notion setup on the welcome page; reconfiguring later is NotionSetupModal.
@responsibility
- Hosts WizardController (steps, validation and saving unchanged) in setup mode and drives it: Weiter, Verbinden, Zurück
- Back (`BackButton`, with the arrow) goes one step, from the first step it emits `back` (the choice, "Zurück zur Auswahl")
- Step changes animate one pane (fade and 14px slide, direction by forward or back), instant under reduced motion
- The first step is the intro "Vorbereitung" (NotionSetupIntro, #441): it says what Notion and Kan-Do do and what to have at hand, writes nothing and shows on every run; its button reads "Los geht's" and Back from the token step returns to it. The wizard stays mounted (hidden) behind it, so a typed token survives the trip back
- Step headings are visually hidden (they repeat the stepper label and the field label, rule candidate #473); after each step change focus moves to the hidden heading so keyboard and screen-reader users keep their place
- Completion shows a short "Notion ist verbunden" status beat, then emits `complete`
- Pattern: first-run setup, diverged from the modal wizard (a process the user stays in); step progress via SetupRail
-->
<template>
  <section class="notion-setup-flow flex flex-col gap-5" data-testid="notion-setup-flow" :aria-label="t('onboarding.flow.notion.label')">
    <div
      v-if="done"
      ref="doneRef"
      class="flex flex-col items-center gap-3 py-16 text-center"
      role="status"
    >
      <span class="flex size-16 items-center justify-center rounded-full bg-inverted">
        <UIcon name="i-ph-check-bold" class="size-8 text-inverted" aria-hidden="true" />
      </span>
      <SectionHeader tag="p" size="display">{{ t('onboarding.flow.notion.connected') }}</SectionHeader>
      <p class="text-body text-muted">{{ t('onboarding.flow.notion.loading') }}</p>
    </div>

    <template v-else>
      <BackButton :label="isFirst ? t('onboarding.flow.backToChoice') : t('common.back')" @click="goBack" />

      <div class="flex flex-col gap-6 md:grid md:grid-cols-[13rem_1fr] md:gap-10">
        <SetupRail
          :steps="railSteps"
          :current="stepIndex"
          :help="t(`onboarding.flow.help.${stepKey}`)"
          :label="t('notion.modal.stepsLabel')"
          :done-label="t('notion.modal.stepDone')"
        />
        <div class="min-w-0">
          <div ref="paneRef">
            <h2
              ref="headingRef"
              tabindex="-1"
              class="sr-only outline-none"
            >
              {{ t(STEP_TITLE[stepKey] ?? STEP_TITLE.token!) }}
            </h2>
            <div v-if="inIntro" class="max-h-[60dvh] overflow-y-auto md:max-h-(--modal-height-wizard)">
              <NotionSetupIntro />
            </div>
            <!-- Mounted from the start and only hidden behind the intro: a token typed before Back to the intro stays -->
            <div v-show="!inIntro" class="max-h-[60dvh] overflow-y-auto md:max-h-(--modal-height-wizard)">
              <WizardController
                ref="wizard"
                :token="notionConfigStore.config?.token"
                :broken="isBroken"
                mode="setup"
                :animate="false"
                @cancel="emit('back')"
                @next="wizard?.nextStep()"
                @complete="onComplete"
              />
            </div>
          </div>
          <div class="mt-6 flex items-center justify-end">
            <UButton
              color="primary"
              :loading="!inIntro && !!wizard?.isValidating"
              :disabled="!inIntro && !wizard?.canProceed"
              data-testid="wizard-proceed"
              @click="proceed"
            >
              {{ inIntro ? t('onboarding.flow.notion.start') : stepKey === 'status-mapping' ? t('onboarding.flow.notion.connect') : t('notion.modal.next') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import BackButton from '~/components/ui/BackButton.vue';
import SetupRail from '~/components/setup/SetupRail.vue';
import NotionSetupIntro from '~/components/setup/NotionSetupIntro.vue';
import WizardController from '~/components/notion/setup/wizard/WizardController.vue';
import { useNotionConfigStore } from '~/store/notionConfig';
import { useIntegrationHealthStore } from '~/store/integrationHealth';

defineOptions({ name: 'NotionSetupFlow' });

const emit = defineEmits<{ (e: 'back' | 'complete'): void }>();

const { t } = useI18n();
const notionConfigStore = useNotionConfigStore();
const isBroken = computed(() => useIntegrationHealthStore().isBroken('notion'));

const wizard = ref<InstanceType<typeof WizardController> | null>(null);
const paneRef = ref<HTMLElement | null>(null);
const headingRef = ref<HTMLElement | null>(null);
const doneRef = ref<HTMLElement | null>(null);
const done = ref(false);

/** How long the "connected" beat stays before the board loads */
const DONE_BEAT_MS = 1000;
let doneTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(doneTimer));

const STEP_LABEL: Record<string, string> = {
  intro: 'notion.modal.steps.intro',
  token: 'notion.modal.steps.token',
  database: 'notion.modal.steps.database',
  mapping: 'notion.modal.steps.mapping',
  'custom-properties': 'notion.modal.steps.customProperties',
  'priority-mapping': 'notion.modal.steps.priority',
  'status-mapping': 'notion.modal.steps.status',
};

/** Heading per step, known before the wizard has mounted (no height change when it appears) */
const STEP_TITLE: Record<string, string> = {
  intro: 'notion.wizard.stepTitle.intro',
  token: 'notion.wizard.stepTitle.token',
  database: 'notion.wizard.stepTitle.database',
  mapping: 'notion.wizard.stepTitle.mapping',
  'custom-properties': 'notion.wizard.stepTitle.customProperties',
  'priority-mapping': 'notion.wizard.stepTitle.priority',
  'status-mapping': 'notion.wizard.stepTitle.status',
};

/** The steps of this run: the priority step exists only when a priority field is mapped */
const stepKeys = computed<string[]>(() => {
  const hasPriority = !!wizard.value?.propertyMapping?.priority;
  return ['intro', 'token', 'database', 'mapping', 'custom-properties', ...(hasPriority ? ['priority-mapping'] : []), 'status-mapping'];
});
const railSteps = computed(() => stepKeys.value.map((key) => ({ key, label: t(STEP_LABEL[key] ?? key) })));
/** The intro comes before the wizard: it is not a wizard step, so the flow tracks it itself (#441) */
const inIntro = ref(true);
const stepKey = computed(() => (inIntro.value ? 'intro' : wizard.value?.step ?? 'token'));
const stepIndex = computed(() => Math.max(0, stepKeys.value.indexOf(stepKey.value)));
const isFirst = computed(() => stepIndex.value === 0);

const reducedMotion = () => import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let direction: 1 | -1 = 1;

watch(stepIndex, async (next, prev) => {
  direction = next >= prev ? 1 : -1;
  await nextTick();
  if (!reducedMotion()) {
    paneRef.value?.animate(
      [{ opacity: 0, transform: `translateX(${direction * 14}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 240, easing: 'cubic-bezier(.3,.8,.3,1)' },
    );
  }
  // preventScroll: the sheet must not jump while the pane slides in
  headingRef.value?.focus({ preventScroll: true });
});

function goBack() {
  if (isFirst.value) return emit('back');
  // The token is the wizard's first step: Back from it returns to the intro
  if (wizard.value?.step === 'token' || !wizard.value) {
    inIntro.value = true;
    return;
  }
  wizard.value.back();
}

function proceed() {
  if (inIntro.value) {
    inIntro.value = false;
    return;
  }
  const w = wizard.value;
  if (!w) return;
  if (w.step === 'priority-mapping') w.priorityMappingStep?.save?.();
  else if (w.step === 'status-mapping') w.statusMappingStep?.save?.();
  else w.nextStep();
}

async function onComplete() {
  done.value = true;
  await nextTick();
  doneRef.value?.focus?.();
  doneTimer = setTimeout(() => emit('complete'), DONE_BEAT_MS);
}
</script>

<style scoped>
/* The flow shows the step title itself (and moves focus to it); TokenStep's own heading would be a second one */
.notion-setup-flow :deep(.notion-setup h2) {
  display: none;
}
</style>
