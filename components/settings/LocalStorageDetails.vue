<!--
@component LocalStorageDetails
@kind block
@category display
@description Where the "Lokal" source keeps its tasks (#438, desktop only): the data folder, last-saved time, the iCloud
upload line, "Ordner ändern…" and "Im Finder zeigen", and, when the data file is not healthy, the one sentence that says
so with the few actions that state allows. Moved here from /settings/data so a storage notice sits next to the Lokal row it is about.
@usage Inside the Lokal row of the Verbindungen tab (`SourceRow` `#details` slot), only when `isTauri()`.
@avoid Not on the web (no folder there); backups, export/import and reset stay on /settings/data.
@responsibility
- Show the folder (middle-ellipsised, full path in the tooltip), last-saved time and schema version; for an iCloud folder one muted line with the upload state (#271)
- "Ordner ändern…" opens the native picker, then DataFolderChangeModal; focus returns to the button
- Every non-ok state: one sentence (error colour only for a failure, the raw error line) and its actions (start fresh, retry, resolve, choose folder)
- Sync-client conflict copies on a healthy file: one muted line pointing to the copies on /settings/data
- Starts with `DataStorageNotice` (no "Details" link here), which also hosts the conflict modal
-->
<template>
  <div class="space-y-3 text-sm" data-testid="local-storage-details">
    <!-- The persistent notice (conflict modal host, "Ausblenden" for the late iCloud upload) lives with the data it is about -->
    <DataStorageNotice :show-details="false" />
    <p class="min-w-0 font-mono wrap-break-word text-default" :title="state.folder" data-selectable data-testid="data-folder-path">
      <span aria-hidden="true">{{ shortFolder }}</span>
      <span class="sr-only">{{ state.folder }}</span>
    </p>
    <p class="text-muted" data-testid="data-folder-saved">{{ savedLine }}</p>
    <div v-if="cloudLine" class="space-y-1" data-testid="data-folder-cloud">
      <p class="text-muted">{{ cloudLine }}</p>
      <p v-if="state.cloudSync?.state === 'error' && state.cloudSync.message" data-selectable class="font-mono text-xs wrap-break-word text-muted">{{ state.cloudSync.message }}</p>
    </div>
    <p v-if="status === 'ok' && conflictCopies.length > 0" class="text-muted" data-testid="data-folder-copies">
      <ULink to="/settings/data">{{ t('settings.data.notice.details') }}</ULink>
    </p>
    <div class="flex flex-wrap gap-2">
      <!-- A problem that already offers "Ordner wählen…" below is the only folder button (no two of the same job) -->
      <UButton v-if="!choosesBelow" ref="changeButton" variant="soft" color="neutral" data-testid="data-folder-change" @click="onChangeFolder">
        {{ t('settings.data.changeFolder') }}
      </UButton>
      <UButton variant="ghost" color="neutral" icon="i-ph-folder-open" :class="choosesBelow ? '' : 'max-sm:-ms-2'" data-testid="data-folder-reveal" @click="onReveal">
        {{ t('settings.data.reveal') }}
      </UButton>
    </div>

    <div v-if="problemText" class="space-y-3" data-testid="data-folder-problem">
      <UAlert
        :color="isFailure ? 'error' : 'neutral'"
        variant="subtle"
        :icon="isFailure ? 'i-ph-warning-circle' : 'i-ph-info'"
        role="status"
        :description="problemText"
      />
      <p v-if="isFailure && state.error" data-selectable class="font-mono text-xs wrap-break-word text-muted">{{ state.error }}</p>
      <div v-if="problemActions" class="flex flex-wrap gap-2">
        <UButton v-if="status === 'missing-file'" variant="soft" color="neutral" data-testid="data-folder-start-fresh" @click="onStartFresh">
          {{ t('settings.data.startFresh') }}
        </UButton>
        <UButton v-if="status === 'folder-unavailable'" variant="soft" color="neutral" :loading="retrying" data-testid="data-folder-retry" @click="onRetry">
          {{ t('settings.data.notice.retry') }}
        </UButton>
        <UButton v-if="status === 'conflict'" variant="soft" color="neutral" data-testid="data-folder-resolve" @click="openConflict">
          {{ t('settings.data.notice.resolve') }}
        </UButton>
        <UButton v-if="status === 'read-only-corrupt'" to="/settings/data" variant="soft" color="neutral" data-testid="data-folder-backups">
          {{ t('settings.data.backups.open') }}
        </UButton>
        <UButton v-if="status !== 'conflict'" ref="chooseButton" variant="soft" color="neutral" data-testid="data-folder-choose" @click="onChangeFolder">
          {{ t('settings.data.chooseFolder') }}
        </UButton>
      </div>
    </div>

    <DataFolderChangeModal v-model:open="modalOpen" :choice="choice" @after:leave="restoreFocus" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import DataStorageNotice from '~/components/settings/DataStorageNotice.vue';
import DataFolderChangeModal from '~/components/settings/DataFolderChangeModal.vue';
import { openConflict } from '~/composables/useDataConflictFlow';
import { useDataFolder, type FolderChoice } from '~/composables/useDataFolder';
import { useLocaleFormat } from '~/composables/useLocaleFormat';
import { middleEllipsis } from '~/utils/middleEllipsis';

defineOptions({ name: 'LocalStorageDetails' });

const { t } = useI18n();
const { formatDateTime } = useLocaleFormat();
const dataFolder = useDataFolder();
const { state, status, conflictCopies } = dataFolder;

const modalOpen = ref(false);
const choice = ref<FolderChoice | null>(null);
const changeButton = ref<{ $el?: HTMLElement } | null>(null);
const chooseButton = ref<{ $el?: HTMLElement } | null>(null);

const shortFolder = computed(() => middleEllipsis(state.folder));

const savedLine = computed(() => {
  const version = state.schemaVersion ?? 1;
  return state.writtenAt
    ? t('settings.data.lastSaved', { time: formatDateTime(state.writtenAt, 'mediumDateShortTime'), version })
    : t('settings.data.notSavedYet', { version });
});

/** iCloud folders only (the field is null for every other folder and on web); live, also inside the grace. */
const cloudLine = computed(() => {
  const sync = state.cloudSync;
  return sync ? t(`settings.data.cloud.${sync.state}`) : null;
});

const PROBLEMS = {
  'read-only-newer-schema': 'newerSchema',
  'read-only-corrupt': 'corrupt',
  'missing-file': 'missing',
  'write-failed': 'writeFailed',
  conflict: 'conflict',
  'folder-unavailable': 'folderUnavailable',
} as const;

/** The problem block below offers the folder picker itself. */
const choosesBelow = computed(() => problemActions.value && status.value !== 'conflict');

/** Failed, as opposed to "needs a decision": raspberry text and the raw error line. */
const isFailure = computed(() => status.value === 'write-failed' || status.value === 'folder-unavailable');

/** Which states offer actions below the sentence; write-failed retries on its own. */
const problemActions = computed(() => ['missing-file', 'read-only-corrupt', 'folder-unavailable', 'conflict'].includes(status.value));

const problemText = computed(() => {
  const key = PROBLEMS[status.value as keyof typeof PROBLEMS];
  return key ? t(`settings.data.state.${key}`) : null;
});

/** The picker's cancel changes nothing: no modal, no state. */
async function onChangeFolder() {
  const picked = await dataFolder.chooseFolder();
  if (!picked) return;
  choice.value = picked;
  modalOpen.value = true;
}

/** The modal opens after the native picker, not from a trigger, so focus would fall back to the body. */
function restoreFocus() {
  void nextTick(() => (changeButton.value ?? chooseButton.value)?.$el?.focus());
}

async function onReveal() {
  await dataFolder.revealInFinder().catch(() => undefined);
}

async function onStartFresh() {
  await dataFolder.startFresh().catch(() => undefined);
}

const retrying = ref(false);

async function onRetry() {
  retrying.value = true;
  try {
    await dataFolder.retry();
  } catch {
    // The status event keeps the page truthful.
  } finally {
    retrying.value = false;
  }
}

onMounted(() => { void dataFolder.refresh().catch(() => undefined); });
</script>
