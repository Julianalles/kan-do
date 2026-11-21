<!--
@component RemindersSettingsPage
@description "Erinnerungen-Einstellungen" (/settings/reminders, #552, epic #481 slice 3): what the setup asked, changeable any time: the answer per list (Listen), how the date decides the day (Heute) and the permission (Zugriff). Not connected yet (the sources tab's "Verbinden"): the same three-step setup as the welcome flow, in place.
@usage The "…" menu of the Erinnerungen row (sources tab), its "Verbindung reparieren", and "Verbinden" on the not-yet-connected row
@responsibility
- Mac app only: on the web the route redirects to the sources tab (`/settings?tab=sources`); the sub-page layout leads back to that tab
- Connected: one `PageSheet` with three sections (hairlines, `SectionHeader` h2): Listen (`RemindersListChoices`, the live lists of Reminders with the role from `remindersConfig`), Heute (`RemindersTodayRules`) and Zugriff (the permission as macOS holds it now, "Systemeinstellungen öffnen", "Trennen")
- A list to Aus asks first when tasks would leave Kan-do (a list holding only archived tasks switches without a question and drops them silently) (in place, under its row): how many and how many of them are on today's board, counted live from the store; Confirm takes them off the board (`tasksStore.dropSourceTasks`: nothing is written to Reminders, nothing is remembered as deleted), Cancel puts the choice back. Any other change applies at once and fetches the source
- Access revoked in macOS: the Zugriff section shows how to allow it and "Verbindung reparieren" (rechecks the permission, then fetches); nothing opens by itself (#319)
- "Trennen" (soft, error tone: the destructive action of the row, #596) opens the existing `DisconnectSourceDialog`; afterwards the page returns to the sources tab. Access that macOS granted stays: the dialog says nothing about revoking it
- Not connected: `RemindersSetupFlow` (on `SetupShell`, #650) with `first-run` off inside the sheet; the shell brings its own footer; the first step has no Zurück (the layout's "Zurück zu Einstellungen" leads to the sources tab, #596), the subtitle says "Verbinde Apple Erinnerungen mit Kan-do." (the layout's `sub-page-description-key` state) until something is set up, completion keeps the page and shows the settings; the stage widens the sheet to 768 px like the welcome flow (`useSetupStageWidth`, #652), the connected sections keep the 672 px column
- Pattern: settings page, aligned with the sources tab sheet and SourceRow (hairline sections, quiet buttons)
-->
<template>
  <NuxtLayout name="sub-page">
    <PageSheet v-if="showSetup" data-testid="reminders-settings-setup">
      <RemindersSetupFlow :first-run="false" @back="leaveToSources" @complete="onSetupComplete" />
    </PageSheet>

    <PageSheet v-else class="space-y-8" data-testid="reminders-settings">
      <section aria-labelledby="reminders-lists-heading" class="space-y-3" data-testid="reminders-section-lists">
        <SectionHeader id="reminders-lists-heading" tag="h2">{{ t('settings.reminders.lists') }}</SectionHeader>
        <p v-if="loadingLists" class="text-body text-muted" role="status">{{ t('settings.reminders.listsLoading') }}</p>
        <p v-else-if="listsFailed" class="text-body text-muted" role="status" data-testid="reminders-lists-failed">{{ t('settings.reminders.listsFailed') }}</p>
        <p v-else-if="access !== 'granted'" class="text-body text-muted" data-testid="reminders-lists-no-access">{{ t('settings.reminders.listsNoAccess') }}</p>
        <template v-else-if="lists.length > 0">
          <RemindersListChoices
            :lists="lists"
            :roles="shownRoles"
            :confirming="confirming"
            @pick="onPick"
            @confirm="onConfirmOff"
            @cancel="pendingOff = null"
          />
          <p class="text-sm text-muted">{{ t('onboarding.flow.reminders.lists.help') }}</p>
        </template>
        <p v-else class="text-body text-muted" data-testid="reminders-lists-none">{{ t('onboarding.flow.reminders.lists.none') }}</p>
      </section>

      <section aria-labelledby="reminders-today-heading" class="space-y-3 border-t border-default pt-8" data-testid="reminders-section-today">
        <SectionHeader id="reminders-today-heading" tag="h2">{{ t('settings.reminders.today') }}</SectionHeader>
        <RemindersTodayRules show-lead />
      </section>

      <section aria-labelledby="reminders-access-heading" class="space-y-3 border-t border-default pt-8" data-testid="reminders-section-access">
        <SectionHeader id="reminders-access-heading" tag="h2">{{ t('settings.reminders.access') }}</SectionHeader>
        <div aria-live="polite">
          <p v-if="access === 'granted'" class="flex items-center gap-2 text-body text-default" data-testid="reminders-access-granted">
            <UIcon name="i-ph-check-circle-fill" class="size-5 shrink-0 text-primary" aria-hidden="true" />
            {{ t('settings.reminders.accessGranted') }}
          </p>
          <UAlert
            v-else
            color="warning"
            variant="subtle"
            icon="i-ph-warning"
            :title="t('onboarding.flow.reminders.access.deniedTitle')"
            :description="t('onboarding.flow.reminders.access.deniedText')"
            data-testid="reminders-access-denied"
          />
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton v-if="needsRepair" color="neutral" variant="soft" :loading="repairing" data-testid="reminders-repair" @click="repair">
            {{ t('settings.reminders.repair') }}
          </UButton>
          <UButton color="neutral" variant="soft" :icon="ICONS.external" data-testid="reminders-open-settings" @click="openSystemSettings">
            {{ t('settings.reminders.openSettings') }}
          </UButton>
          <UButton color="error" variant="soft" data-testid="reminders-disconnect" @click="isDisconnectOpen = true">
            {{ t('settings.reminders.disconnect') }}
          </UButton>
        </div>
      </section>
    </PageSheet>

    <DisconnectSourceDialog v-model:open="isDisconnectOpen" source="reminders" @disconnected="leaveToSources" />
  </NuxtLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { useState, navigateTo } from 'nuxt/app'
import { useI18n } from 'vue-i18n'
import PageSheet from '~/components/ui/PageSheet.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import DisconnectSourceDialog from '~/components/settings/DisconnectSourceDialog.vue'
import RemindersListChoices from '~/components/setup/RemindersListChoices.vue'
import RemindersSetupFlow from '~/components/setup/RemindersSetupFlow.vue'
import RemindersTodayRules from '~/components/setup/RemindersTodayRules.vue'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { useRemindersConfigStore } from '~/store/remindersConfig'
import { useSetupStageWidth } from '~/composables/useSetupStageWidth'
import { useTasksStore } from '~/store/tasks'
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { isNotPlanned } from '~/lib/taskPlanning'
import { remindersAccessStatus, remindersLists, remindersOpenSettings, remindersSupported, type ReminderList } from '~/lib/reminders'
import type { ReminderListRole } from '~/lib/remindersSource'
import { isTauri } from '~/utils/isTauri'
import { ICONS } from '~/lib/icons'

defineOptions({ name: 'RemindersSettingsPage' })

definePageMeta({
  layout: false,
  pageWidth: 'narrow', // one 672 px column on the app bar's axis (#673)
  // The web build has no Reminders: back to the tab that lists the sources
  middleware: () => {
    if (import.meta.server) return
    if (!isTauri()) return navigateTo('/settings?tab=sources', { replace: true })
  },
  titleKey: 'settings.reminders.pageTitle',
  descriptionKey: 'settings.reminders.pageDescription',
})

const { t } = useI18n()
const board = useBoardStore()
const config = useRemindersConfigStore()
const tasksStore = useTasksStore()
const health = useIntegrationHealthStore()
const { fetchSource } = useIntegrationManager()

const sourcesTab = '/settings?tab=sources'
const leaveToSources = () => navigateTo(sourcesTab)

/** The setup runs here while Reminders is not connected (decided once on arrival, so its own "connected" beat can finish) */
const showSetup = ref(!board.isIntegrationConnected('reminders'))
// The subtitle says what was set up before: untrue until something is (#596)
const descriptionKey = useState<string | null>('sub-page-description-key', () => null)
watchEffect(() => { descriptionKey.value = showSetup.value ? 'settings.reminders.pageDescriptionNew' : null })
onBeforeUnmount(() => { descriptionKey.value = null })
useSetupStageWidth(showSetup) // the stage is as wide as the welcome sheet (#652)
const onSetupComplete = () => {
  showSetup.value = false
  void load()
}

// ---- Listen ----

const lists = ref<ReminderList[]>([])
const loadingLists = ref(false)
const listsFailed = ref(false)
const access = ref<'granted' | 'denied'>('granted')

const roles = computed<Record<string, ReminderListRole>>(() => Object.fromEntries(lists.value.map((list) => [list.id, config.roleOf(list.id)])))

/** The list whose switch to Aus waits for the answer; its segment already reads Aus while the question is open */
const pendingOff = ref<string | null>(null)
const shownRoles = computed(() => (pendingOff.value ? { ...roles.value, [pendingOff.value]: 'off' as const } : roles.value))

/** The tasks of one list that would leave, live from the store: all of them, and those on today's board */
function countsOf(listId: string): { leaving: number; onBoard: number } {
  const archived = new Set(tasksStore.archivedTaskIds)
  const held = tasksStore.tasks.filter((task) => task.source === 'reminders' && task.reminders?.listId === listId && !archived.has(task.id))
  return { leaving: held.length, onBoard: held.filter((task) => !isNotPlanned(task)).length }
}
const confirming = computed(() => (pendingOff.value ? { listId: pendingOff.value, ...countsOf(pendingOff.value) } : null))

const titleOf = (listId: string) => lists.value.find((list) => list.id === listId)?.title ?? config.lists[listId]?.title ?? ''

const dropListTasks = (listId: string) => tasksStore.dropSourceTasks('reminders', (task) => task.reminders?.listId === listId)

function onPick(listId: string, role: ReminderListRole) {
  if (role === config.roleOf(listId) && pendingOff.value !== listId) return
  if (role === 'off') {
    // Nothing leaves without a word: ask when tasks are on the board, else it is just a switch
    if (countsOf(listId).leaving > 0) {
      pendingOff.value = listId
      return
    }
    config.setList(listId, { role, title: titleOf(listId) })
    // Archived tasks of the list are not asked about but still leave the store, or the next fetch counts them in its sync-drop check
    dropListTasks(listId)
    return
  }
  pendingOff.value = null
  config.setList(listId, { role, title: titleOf(listId) })
  // A list switched on changes what the board shows: fetch it
  void fetchSource('reminders')
}

function onConfirmOff() {
  const listId = pendingOff.value
  if (!listId) return
  pendingOff.value = null
  config.setList(listId, { role: 'off', title: titleOf(listId) })
  // The tasks leave Kan-do only: Reminders is not written, and nothing is remembered as deleted (switching the list on brings them back)
  dropListTasks(listId)
}

// ---- Zugriff ----

const isDisconnectOpen = ref(false)
const repairing = ref(false)
const needsRepair = computed(() => health.needsAttention('reminders') || access.value !== 'granted')

const openSystemSettings = () => remindersOpenSettings().catch(() => undefined)

/** The permission as macOS holds it now: never prompts */
async function readAccess(): Promise<boolean> {
  try {
    const status = await remindersAccessStatus()
    config.setAccessStatus(status)
    access.value = status === 'granted' ? 'granted' : 'denied'
  } catch {
    access.value = 'denied'
  }
  return access.value === 'granted'
}

async function load() {
  loadingLists.value = true
  listsFailed.value = false
  try {
    if (!(await readAccess())) {
      lists.value = []
      return
    }
    lists.value = await remindersLists()
  } catch {
    listsFailed.value = true
  } finally {
    loadingLists.value = false
  }
}

/** "Verbindung reparieren": check the permission again, then fetch so the source is healthy again; opens nothing by itself */
async function repair() {
  repairing.value = true
  try {
    if (await readAccess()) {
      try {
        lists.value = await remindersLists()
        listsFailed.value = false
      } catch {
        // The earlier lists (or the failed note) stay; the source is still fetched below
      }
      await fetchSource('reminders')
    }
  } finally {
    repairing.value = false
  }
}

onMounted(async () => {
  // A route that is not the Mac app's (a Windows or Linux desktop) has no Reminders: back to the sources tab
  if (!(await remindersSupported())) return void leaveToSources()
  if (!showSetup.value) void load()
})
</script>
