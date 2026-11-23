<!--
@component LocalSetupFlow
@kind block
@category input
@description Step 2 of the welcome sheet (#294): says that tasks live on this device by default and offers further apps as choice cards, then starts the board or the Reminders or Notion setup
@usage <LocalSetupFlow v-model:notion="wantNotion" v-model:reminders="wantReminders" @back="flow = null" @connect-reminders="openReminders" @connect-notion="openNotion" @complete="onLocalDone" /> inside pages/welcome.vue
@avoid Only the second step on the welcome page; Notion is NotionSetupFlow, Apple Reminders is RemindersSetupFlow, the trial board is SamplesSetupFlow.
@responsibility
- Explains that tasks stay on this device, local tasks are always possible and services can be connected now or later in Einstellungen
- Lists Notion, Erinnerungen (Apple Reminders, #552) and Todoist as checkbox cards (`ChoiceCard` with `v-model`, #651): the service icon, the name and a one-line description; Erinnerungen has no official icon in the bundled sets, so a list glyph stands in (known trade-off until an asset exists); Todoist is disabled with "Bald verfügbar"; Erinnerungen is enabled only in the Mac app (`useRemindersSupported`), in the web build it is disabled and its line reads "Nur in der Mac-App"
- One primary action whose label follows the checkboxes: none checked empties the task store and emits `complete` ("Zum Board"); Notion only emits `connect-notion` ("Mit Notion einrichten"); Erinnerungen emits `connect-reminders` ("Mit Erinnerungen einrichten", with Notion also "Weiter mit Erinnerungen und Notion": the host runs the Reminders setup first, then Notion); the store is left alone for both
- Back returns to the start view: the shared `BackButton` ("Zurück zur Auswahl")
- Pattern: first-run setup, diverged from the modal wizard; the apps are choice cards, diverged from the circle checkboxes (the UX decision of #607)
-->
<template>
  <section class="flex flex-col gap-4 sm:gap-5" data-testid="local-setup-flow" :aria-label="t('onboarding.flow.local.label')">
    <BackButton :label="t('onboarding.flow.backToChoice')" @click="emit('back')" />
    <div>
      <SectionHeader ref="headingRef" tag="h2" size="display" tabindex="-1" class="text-balance outline-none">
        {{ t('onboarding.flow.local.title') }}
      </SectionHeader>
      <p class="mt-2 text-body text-default">{{ t('onboarding.flow.local.intro') }}</p>
    </div>

    <fieldset class="flex flex-col gap-2" data-testid="local-sources">
      <SectionHeader tag="legend" size="label" class="mb-2">{{ t('onboarding.flow.local.legend') }}</SectionHeader>
      <ChoiceCard v-model="notion" icon="i-ph-notebook" data-testid="local-source-notion">
        {{ t('onboarding.flow.local.notion') }}
        <template #hint>{{ t('onboarding.flow.local.notionHint') }}</template>
      </ChoiceCard>
      <ChoiceCard v-model="reminders" icon="i-ph-list-checks" :disabled="!remindersSupported" data-testid="local-source-reminders">
        {{ t('onboarding.flow.local.reminders') }}
        <template #hint>{{ remindersSupported || isDesktop ? t('onboarding.flow.local.remindersHint') : t('onboarding.flow.local.remindersWebOnly') }}</template>
      </ChoiceCard>
      <ChoiceCard :model-value="false" icon="i-ph-check-square" disabled data-testid="local-source-todoist">
        {{ t('onboarding.flow.local.todoist') }}
        <template #hint>{{ t('onboarding.flow.local.todoistSoon') }}</template>
      </ChoiceCard>
    </fieldset>

    <UButton color="primary" block aria-live="polite" data-testid="local-confirm" @click="confirm">
      {{ confirmLabel }}
    </UButton>
  </section>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { computed, ref } from 'vue';
import { isTauri } from '~/utils/isTauri';
import { useRemindersSupported } from '~/composables/useRemindersSupported';
import BackButton from '~/components/ui/BackButton.vue';
import ChoiceCard from '~/components/ui/ChoiceCard.vue';
import { useI18n } from 'vue-i18n';
import { useTasksStore } from '~/store/tasks';

defineOptions({ name: 'LocalSetupFlow' });

const emit = defineEmits<{ (e: 'back' | 'complete' | 'connect-notion' | 'connect-reminders'): void }>();
/** Whether Notion is ticked: the host keeps it, so Back from the Notion setup finds it set */
const notion = defineModel<boolean>('notion', { default: false });
/** Whether Erinnerungen is ticked (#552); the same keeping rule as Notion */
const reminders = defineModel<boolean>('reminders', { default: false });

const { t } = useI18n();
const tasksStore = useTasksStore();
const headingRef = ref<{ $el: HTMLElement } | null>(null);
const remindersSupported = useRemindersSupported();
const isDesktop = isTauri();

const confirmLabel = computed(() => {
  if (reminders.value && remindersSupported.value) return t(notion.value ? 'onboarding.flow.local.confirmRemindersNotion' : 'onboarding.flow.local.confirmReminders');
  return t(notion.value ? 'onboarding.flow.local.confirmNotion' : 'onboarding.flow.local.confirm');
});

defineExpose({ focusHeading: () => headingRef.value?.$el.focus({ preventScroll: true }) });

function confirm() {
  if (reminders.value && remindersSupported.value) return emit('connect-reminders');
  if (notion.value) return emit('connect-notion');
  tasksStore.setTasks([]);
  emit('complete');
}
</script>
