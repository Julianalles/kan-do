<!--
@component NotionSetupFlow
@kind block
@category input
@description The Notion setup as page content, on the shared SetupShell (#649, #652, epic #607): guide rail (md and up) or progress bar (below md), one pane with the existing wizard steps, and a footer bar with Zurück and Weiter. No dialog: the welcome sheet and the stage of /settings/notion host the same component.
@usage <NotionSetupFlow @back="flow = null" @complete="onConnected" /> inside pages/welcome.vue; <NotionSetupFlow back-target="settings" :intro="false" @back="…" @complete="…" /> on /settings/notion (`mode="settings"` for the shorter steps of a merely degraded connection)
@avoid Not a dialog; the connected view of /settings/notion (tabs per section) is a different page.
@responsibility
- Fills SetupShell with the steps, the rail help, the footer state of WizardController (`canProceed`, `isValidating`, the step) and the primary action; hosts WizardController (steps, validation and saving unchanged) in its `mode`, `flush` (no padding of its own: the shell's content edge) and drives it: Weiter, Verbinden, Zurück
- Zurück goes one step; from the first step it emits `back`, labelled by `back-target`: "Zurück zur Auswahl" (`choice`, the welcome page) or "Zurück zu Einstellungen" (`settings`, the stage of /settings/notion, #652); the last step's button reads "Verbinden"
- Props: `mode` `setup` (default: intro, token, database, then the mapping steps) or `settings` (a configured connection that is only degraded: the mapping steps, no intro, no token); `intro` (default on; off where the run starts at the token step, the repair of a broken connection)
- The first step of a setup run is the intro "Vorbereitung" (NotionSetupIntro, #441): it says what Notion and Kan-do do and what to have at hand, writes nothing; its button reads "Weiter" and Zurück from the token step returns to it. The wizard stays mounted (hidden) behind it, so a typed token survives the trip back
- No step heading and no scroll area of its own: the rail names the step, the shell's pane follows each step's height (300 ms) and focus moves to the pane after a step change; a long database list grows the pane and the page scrolls
- Nothing is written to the connection before the last step: `WizardController.finishSetup` is the only `setConfig`
- Completion shows a short "Notion ist verbunden" beat (SetupShell `done`), then emits `complete`
- Pattern: setup flow, one component for the welcome page and settings (#562): a process the user stays in is a page, not a dialog; step progress via SetupRail, footer via SetupShell
-->
<template>
  <section class="notion-setup-flow" data-testid="notion-setup-flow" :aria-label="t('onboarding.flow.notion.label')">
    <SetupShell
      :steps="railSteps"
      :current="stepIndex"
      :help="t(`onboarding.flow.help.${stepKey}`)"
      :back-label="isFirst ? t(props.backTarget === 'settings' ? 'common.backToSettings' : 'onboarding.flow.backToChoice') : t('common.back')"
      :next-label="nextLabel"
      next-test-id="wizard-proceed"
      :next-disabled="!inIntro && !wizard?.canProceed"
      :loading="!inIntro && !!(wizard?.isValidating || wizard?.isLoadingDatabases || wizard?.isLoadingSchema)"
      :done="done"
      :done-title="t('onboarding.flow.notion.connected')"
      :done-hint="t('onboarding.flow.notion.loading')"
      @back="goBack"
      @next="proceed"
    >
      <NotionSetupIntro v-if="inIntro" />
      <!-- Mounted from the start and only hidden behind the intro: a token typed before Back to the intro stays -->
      <div v-show="!inIntro">
        <WizardController
          ref="wizard"
          :token="notionConfigStore.config?.token"
          :broken="isBroken"
          :mode="props.mode"
          :animate="false"
          flush
          @cancel="emit('back')"
          @next="wizard?.nextStep()"
          @complete="onComplete"
        />
      </div>
    </SetupShell>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import SetupShell from '~/components/setup/SetupShell.vue';
import NotionSetupIntro from '~/components/setup/NotionSetupIntro.vue';
import WizardController from '~/components/notion/setup/wizard/WizardController.vue';
import { useNotionConfigStore } from '~/store/notionConfig';
import { useIntegrationHealthStore } from '~/store/integrationHealth';

defineOptions({ name: 'NotionSetupFlow' });

const props = withDefaults(defineProps<{
  /** `settings`: a configured, merely degraded connection (the mapping steps only) */
  mode?: 'setup' | 'settings';
  /** Start with the intro "Vorbereitung" (setup mode only) */
  intro?: boolean;
  /** Where Zurück on the first step leads: the welcome choice or the settings */
  backTarget?: 'choice' | 'settings';
}>(), { mode: 'setup', intro: true, backTarget: 'choice' });

const emit = defineEmits<{ (e: 'back' | 'complete'): void }>();

const hasIntro = props.mode === 'setup' && props.intro;

const { t } = useI18n();
const notionConfigStore = useNotionConfigStore();
const isBroken = computed(() => useIntegrationHealthStore().isBroken('notion'));

const wizard = ref<InstanceType<typeof WizardController> | null>(null);
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

/** The steps of this run: the priority step exists only when a priority field is mapped */
const stepKeys = computed<string[]>(() => {
  // A configured connection may have a priority mapping stored already
  const hasPriority = !!(wizard.value?.propertyMapping?.priority || (props.mode === 'settings' && notionConfigStore.config?.propertyMapping?.priority));
  const lead = props.mode === 'settings' ? [] : [...(hasIntro ? ['intro'] : []), 'token', 'database'];
  return [...lead, 'mapping', 'custom-properties', ...(hasPriority ? ['priority-mapping'] : []), 'status-mapping'];
});
const railSteps = computed(() => stepKeys.value.map((key) => ({ key, label: t(STEP_LABEL[key] ?? key) })));
/** The intro comes before the wizard: it is not a wizard step, so the flow tracks it itself (#441) */
const inIntro = ref(hasIntro);
const stepKey = computed(() => (inIntro.value ? 'intro' : wizard.value?.step ?? (props.mode === 'settings' ? 'mapping' : 'token')));
const stepIndex = computed(() => Math.max(0, stepKeys.value.indexOf(stepKey.value)));
const isFirst = computed(() => stepIndex.value === 0);
const nextLabel = computed(() => {
  if (inIntro.value) return t('onboarding.flow.notion.start');
  return t(stepKey.value === 'status-mapping' ? 'onboarding.flow.notion.connect' : 'notion.modal.next');
});

function goBack() {
  if (isFirst.value) return emit('back');
  // The token is the wizard's first step: Back from it returns to the intro
  if (hasIntro && (wizard.value?.step === 'token' || !wizard.value)) {
    inIntro.value = true;
    return;
  }
  wizard.value?.back();
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
  doneTimer = setTimeout(() => emit('complete'), DONE_BEAT_MS);
}
</script>
