<!--
@component LocalSetupFlow
@kind block
@category input
@description Step 2 of the welcome sheet (#294): says that tasks live on this device by default and offers further services as a checkbox list, then starts the board or the Reminders or Notion setup
@usage <LocalSetupFlow v-model:notion="wantNotion" v-model:reminders="wantReminders" @back="flow = null" @connect-reminders="openReminders" @connect-notion="openNotion" @complete="onLocalDone" /> inside pages/welcome.vue
@avoid Only the second step on the welcome page; Notion is NotionSetupFlow, Apple Reminders is RemindersSetupFlow, the trial board is SamplesSetupFlow.
@responsibility
- Explains that tasks stay on this device, local tasks are always possible and services can be connected now or later in Einstellungen
- Lists Erinnerungen (Apple Reminders, #552) and Notion as checkboxes (`UCheckbox`, neutral) and Todoist as a disabled one with "(bald verfügbar)"; Erinnerungen is enabled only in the Mac app (`useRemindersSupported`), in the web build it is disabled and reads "(nur in der Mac-App)"
- One primary action whose label follows the checkboxes: none checked empties the task store and emits `complete` ("Zum Board"); Notion only emits `connect-notion` ("Mit Notion einrichten"); Erinnerungen emits `connect-reminders` ("Mit Erinnerungen einrichten", with Notion also "Weiter mit Erinnerungen und Notion": the host runs the Reminders setup first, then Notion); the store is left alone for both
- Back returns to the start view: the shared `BackButton` ("Zurück zur Auswahl")
- Pattern: first-run setup, diverged from the modal wizard; checkbox list aligned with the feedback dialog's context list
-->
<template>
  <section class="flex flex-col gap-6" data-testid="local-setup-flow" :aria-label="t('onboarding.flow.local.label')">
    <BackButton :label="t('onboarding.flow.backToChoice')" @click="emit('back')" />
    <div>
      <SectionHeader ref="headingRef" tag="h2" size="display" tabindex="-1" class="text-balance outline-none">
        {{ t('onboarding.flow.local.title') }}
      </SectionHeader>
      <p class="mt-2 text-body text-default">{{ t('onboarding.flow.local.intro') }}</p>
    </div>

    <fieldset class="flex flex-col gap-1 md:gap-3" data-testid="local-sources">
      <legend class="mb-3 text-sm font-medium text-highlighted">{{ t('onboarding.flow.local.legend') }}</legend>
      <UCheckbox
        v-model="reminders"
        :disabled="!remindersSupported"
        color="neutral"
        :label="remindersSupported || isDesktop ? t('onboarding.flow.local.reminders') : t('onboarding.flow.local.remindersWebOnly')"
        data-testid="local-source-reminders"
      />
      <UCheckbox v-model="notion" color="neutral" :label="t('onboarding.flow.local.notion')" data-testid="local-source-notion" />
      <UCheckbox
        :model-value="false"
        disabled
        color="neutral"
        :label="t('onboarding.flow.local.todoist')"
        data-testid="local-source-todoist"
      />
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
