<!--
@component DataSettingsPage
@description Sub-page /settings/data (web: only the export/import section, #238), listed as "Backup und App-Reset": its backups, cloud conflict copies,
the portable JSON export/import (#224, ADR 011) and the app reset. The data folder, last-saved time and every storage problem moved to the Lokal row on
/settings?tab=sources (#438); on desktop this page opens with one line pointing there.
@usage The "System" list, the sync conflict notice's "Details" link, command palette "Daten exportieren/importieren" and "App zurücksetzen"
@responsibility
- Desktop: the persistent storage notice (it hosts the conflict modal that restore and import depend on), then one muted line with a link to Speicherorte › Lokal for the folder and its status
- Backups and conflict copies (hidden while the folder is unreachable), export/import
- Hosts the one confirmation modal for restore (backup or conflict copy) and import; ends with the "App zurücksetzen" section (kd#227, asks in place)
-->
<template>
  <div>
    <NuxtLayout name="sub-page">
      <div class="space-y-8">
        <p v-if="desktop" class="-mt-4 text-body text-muted" data-testid="data-folder-moved">
          {{ t('settings.data.movedToConnections') }}
          <ULink to="/settings?tab=sources" data-testid="data-folder-moved-link">{{ t('settings.data.movedLink') }}</ULink>
        </p>

        <DataStorageNotice v-if="desktop" :show-details="false" />

        <template v-if="desktop && status !== 'folder-unavailable'">
          <DataBackupList @restore="onRestoreBackup" />
          <DataConflictCopies @restore="onRestoreCopy" />
        </template>
        <DataExportImport @import="onImport" />
        <DataResetSection />
      </div>

      <DataRestoreModal v-model:open="restoreOpen" :request="restoreRequest" @after:leave="restoreImportFocus" />
    </NuxtLayout>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import DataBackupList from '~/components/settings/DataBackupList.vue';
import DataConflictCopies from '~/components/settings/DataConflictCopies.vue';
import DataExportImport from '~/components/settings/DataExportImport.vue';
import DataResetSection from '~/components/settings/DataResetSection.vue';
import DataStorageNotice from '~/components/settings/DataStorageNotice.vue';
import DataRestoreModal, { type RestoreRequest } from '~/components/settings/DataRestoreModal.vue';
import { useDataFolder, type ImportPreview } from '~/composables/useDataFolder';
import { useWebDataTransfer } from '~/composables/useWebDataTransfer';
import { useLocaleFormat } from '~/composables/useLocaleFormat';
import { isTauri } from '~/utils/isTauri';
import type { BackupEntry, ConflictCopy } from '~/types/dataFile';

defineOptions({ name: 'DataSettingsPage' });

definePageMeta({
  layout: false,
  pageWidth: 'narrow', // one 672 px column on the app bar's axis (#673)
  titleKey: 'settings.data.pageTitle',
  descriptionKey: 'settings.data.pageDescription',
});

const { t } = useI18n();
const { formatDateTime } = useLocaleFormat();
const dataFolder = useDataFolder();
const { status } = dataFolder;
const desktop = isTauri();
const webTransfer = useWebDataTransfer();

const restoreOpen = ref(false);
const restoreRequest = ref<RestoreRequest | null>(null);

/** Only the web import opens after an async chooser; restores keep the modal's own focus return to their row. */
const focusImportOnLeave = ref(false);

function askRestore(request: RestoreRequest, options: { focusImport?: boolean } = {}) {
  focusImportOnLeave.value = options.focusImport ?? false;
  restoreRequest.value = request;
  restoreOpen.value = true;
}

function onRestoreBackup(entry: BackupEntry) {
  askRestore({
    title: t('settings.data.restore.title', { time: formatDateTime(entry.ts, 'mediumDateShortTime') }),
    sourceLabel: t('settings.data.restore.source'),
    sourceCount: entry.taskCount,
    run: () => dataFolder.restore(entry.name),
  });
}

function onRestoreCopy(copy: ConflictCopy) {
  askRestore({
    title: t('settings.data.restore.title', { time: formatDateTime(copy.writtenAt, 'mediumDateShortTime') }),
    sourceLabel: t('settings.data.restore.source'),
    sourceCount: copy.taskCount,
    run: () => dataFolder.restore(copy.name),
  });
}

/** The modal opens after the async file chooser, so focus would fall back to the body. */
function restoreImportFocus() {
  if (!focusImportOnLeave.value) return;
  void nextTick(() => document.querySelector<HTMLElement>('[data-testid="data-import"]')?.focus());
}

function onImport(preview: ImportPreview) {
  askRestore({
    title: t('settings.data.exportImport.importTitle'),
    sourceLabel: preview.fileName,
    sourceCount: preview.taskCount,
    ...(desktop
      ? { confirmLabel: t('settings.data.exportImport.importConfirm'), run: () => dataFolder.applyImport(preview) }
      : {
          confirmLabel: t('settings.data.exportImport.webConfirm'),
          note: t('settings.data.exportImport.webNote'),
          safetyOption: true,
          run: ({ safetyDownload }) => webTransfer.applyImport(preview, { safetyDownload }),
        }),
  }, { focusImport: !desktop });
}

onMounted(() => { if (desktop) void dataFolder.refresh().catch(() => undefined); });
</script>
