<!--
@component SettingsPage
@description "Einstellungen" (/settings, #394, #691): three groups behind a tab strip (`UTabs` `variant="link"`: an underline, lighter than the app bar's toggle, #308; rule candidate #318;
sized up to read as the page's navigation, #333: `size="xl"`, which the theme draws with 16 px labels, 44 px high at every width and a 2 px indicator; the other tab strips keep `md`),
one shown at a time, the active one in the URL as `?tab=board|sources|manage` (default board, unknown value = board):
Board (the Fokus option and the working hours of the capacity divider, #306), Speicherorte (the former "Aufgaben-Quellen" page, #324: every source with its health, the default
for new tasks, repair / configure / connect / disconnect) and System (hairline rows to Themen und Aktivitäten, Backup und
App-Reset, and on desktop Updates and GitHub-Zugriff).
`/settings/sources` redirects here.
@usage Board gear, command palette "Einstellungen", the sync popover's "Verbindung reparieren"
@responsibility
- Board and System sheets carry a `SectionHeader` h2 ("Fokus und Arbeitszeit", "System"), like the Speicherorte sheet (#596); the tab strip keeps its normal padded tabs, so the first tab label sits 16 px inside the sheet edge by design (#596 item 10)
- "Fokus": one switch row, "Jetzt-Karte im Fokus" (`settingsStore.focusEnabled`); takes effect on the board at once; on phone the 36×20 switch has a 44 px hit area (an invisible `::after`, kd#27)
- "Schwebender Fokus-Timer" (#383): a switch row below "Fokus", desktop only (`settingsStore.floatingNowEnabled`, default on); the main window pushes the setting to Rust at once, which hides or destroys the window
- Speicherorte is one sheet (#333: one concern): "Deine Speicherorte" (h2), the lead, the connected rows, then a separator and "Eine App verbinden" a level below (h3, the `sub` role); separator and heading drop out when nothing is left to connect
- List Lokal (always; on desktop its row carries `LocalStorageDetails`: data folder, last saved, storage problems and their actions, #438) and the connected integrations as hairline rows; the default carries the "Standard" badge; a row's name and actions share one line at every width (`SourceRow`: the "…" menu)
- "Als Standard festlegen" changes the default at once (`boardStore.setDefaultSource`)
- Repair of a broken Notion (rejected token, missing config) opens the Notion setup stage of /settings/notion at the token step
  (`?setup=repair`, so a new token can be entered); a merely degraded one opens it in settings mode (`?setup=settings`); no dialog (#652).
  "Notion-Einstellungen" goes to /settings/notion, "Trennen" opens the disconnect dialog of #320
  (`useSourceConnections` does the work)
- On the public web instance (#742) Notion reads "in der öffentlichen Cloud-Version nicht verfügbar" there, without a button, and a stored Notion source is a connected row with the note "Nur in der Desktop-App verfügbar…" and no action
- "Eine App verbinden": Notion with "Verbinden" while disconnected (opens the Notion setup stage of /settings/notion, `?setup=connect`; the stage connects the source when it ends),
  Erinnerungen with "Verbinden" in the Mac app (it opens /settings/reminders, which runs the setup there; the web build reads "nur in der Mac-App", #552),
  Todoist as "bald verfügbar"
- "System": `ListRow` link rows (`to`, kd#179; #683 sizing), every sub-page has one; a tab click `router.replace`s the query, so back from a sub-page returns to the tab it was opened from
- "Arbeitszeit pro Tag" (#306): a `USelect` under the Fokus row in the same sheet, hairline between the rows; "Automatisch" (the default: the day length is learned from tracked work) or 1-12 h in 30 min steps (`settingsStore.workingHoursMinutes`, minutes, null = automatic); the divider moves at once. Phone: label and help above, the select full width. Pattern: aligned with the Fokus switch row (label, help, control on the right)
- Known trade-off: the Board tab holds two rows only, Fokus and Arbeitszeit (accepted by the UX decision)
- No visible page header (#670): the app bar's third segment reads "Einstellungen"; the layout keeps the title as an sr-only h1
- Same sub-page pattern as /settings/updates: one flat column, no cards
-->
<template>
  <div>
    <NuxtLayout name="sub-page">
      <div class="space-y-8">
        <UTabs
          ref="tabsRef"
          :model-value="tab"
          :items="tabItems"
          :content="false"
          variant="link"
          size="xl"
          class="w-full"
          data-testid="settings-tabs"
          @update:model-value="onTabChange"
        />

        <section
          :aria-label="t(`settings.tabs.${tab}`)"
          class="space-y-6"
          :data-testid="`settings-panel-${tab}`"
        >
          <p class="text-body text-muted" data-testid="settings-tab-lead">{{ t(`settings.tabs.lead.${tab === 'manage' && !isDesktop ? 'manageWeb' : tab}`) }}</p>

          <PageSheet v-if="tab === 'board'" tag="section" data-testid="focus-settings" aria-labelledby="board-settings-heading">
            <SectionHeader id="board-settings-heading" tag="h2" class="pb-4">{{ t('settings.tabs.heading.board') }}</SectionHeader>
            <div class="flex items-center gap-4 pb-6">
              <div class="min-w-0 flex-1">
                <label id="focus-label" class="block text-default" for="focus-switch">{{ t('settings.focus.label') }}</label>
                <p id="focus-help" class="text-body text-muted">{{ t('settings.focus.help') }}</p>
              </div>
              <USwitch
                id="focus-switch"
                :model-value="settingsStore.focusEnabled"
                aria-describedby="focus-help"
                data-testid="focus-switch"
                @update:model-value="settingsStore.setFocusEnabled"
              />
            </div>
            <!-- The floating Now window (#383): a desktop-only window, so the row is not there on the web -->
            <div v-if="isDesktop" class="flex items-center gap-4 border-t border-default py-6" data-testid="floating-now-setting">
              <div class="min-w-0 flex-1">
                <label id="floating-now-label" class="block text-default" for="floating-now-switch">{{ t('settings.floatingNow.label') }}</label>
                <p id="floating-now-help" class="text-body text-muted">{{ t('settings.floatingNow.help') }}</p>
              </div>
              <USwitch
                id="floating-now-switch"
                :model-value="settingsStore.floatingNowEnabled"
                aria-describedby="floating-now-help"
                data-testid="floating-now-switch"
                @update:model-value="settingsStore.setFloatingNowEnabled"
              />
            </div>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-default pt-6" data-testid="working-hours-setting">
              <div class="min-w-0 flex-1 basis-56">
                <label id="working-hours-label" class="block text-default" for="working-hours-select">{{ t('settings.workingHours.label') }}</label>
                <p id="working-hours-help" class="text-body text-muted">{{ t('settings.workingHours.help') }}</p>
              </div>
              <USelect
                id="working-hours-select"
                :model-value="workingHoursValue"
                :items="workingHoursItems"
                aria-describedby="working-hours-help"
                class="w-full sm:w-40"
                data-testid="working-hours-select"
                @update:model-value="onWorkingHoursChange"
              />
            </div>
          </PageSheet>

          <template v-else-if="tab === 'sources'">
            <PageSheet tag="section" aria-labelledby="sources-connected-heading" class="space-y-1" data-testid="sources-sheet">
              <SectionHeader id="sources-connected-heading" tag="h2">
                {{ t('sources.page.connectedHeading') }}
              </SectionHeader>
              <p class="text-body text-muted" data-testid="sources-lead">
                {{ t('sources.page.help') }}
              </p>
              <ul class="divide-y divide-default pt-2" data-testid="sources-connected">
                <SourceRow
                  v-for="row in connected"
                  :key="row.id"
                  :ref="(el) => setRowRef(row.id, el)"
                  :row="row"
                  @set-default="onSetDefault"
                  @repair="onRepair"
                  @open-settings="onOpenSettings"
                  @disconnect="onDisconnect"
                >
                  <template v-if="row.id === 'local' && isDesktop" #details>
                    <LocalStorageDetails />
                  </template>
                </SourceRow>
              </ul>

              <!-- One sheet, one concern (#333): what can still be connected follows a separator, a level below -->
              <template v-if="more.length">
                <SectionHeader id="sources-more-heading" tag="h3" size="sub" class="mt-6 border-t border-default pt-6">
                  {{ t('sources.page.moreHeading') }}
                </SectionHeader>
                <ul class="divide-y divide-default" aria-labelledby="sources-more-heading" data-testid="sources-more">
                  <ListRow
                    v-for="row in more"
                    :key="row.id"
                    class="min-h-14 gap-y-3"
                    :data-testid="`source-more-${row.id}`"
                  >
                    <UIcon :name="row.icon" class="size-5 shrink-0 text-muted" aria-hidden="true" />
                    <p class="min-w-0 flex-1 text-default">{{ row.name }}</p>
                    <UButton
                      v-if="row.state === 'connectable'"
                      color="neutral"
                      variant="soft"
                      :aria-label="t('sources.row.connectNamed', { source: row.name })"
                      :data-testid="`source-connect-${row.id}`"
                      @click="onConnect(row.id)"
                    >
                      {{ t('sources.row.connect') }}
                    </UButton>
                    <span v-else class="max-w-56 min-w-0 shrink text-end text-sm text-muted">{{ t(MORE_STATE_KEYS[row.state]) }}</span>
                  </ListRow>
                </ul>
              </template>
            </PageSheet>
          </template>

          <PageSheet v-else tag="section" aria-labelledby="manage-settings-heading">
          <SectionHeader id="manage-settings-heading" tag="h2" class="pb-2">{{ t('settings.tabs.heading.manage') }}</SectionHeader>
          <ul class="divide-y divide-default" data-testid="settings-subpages">
            <ListRow v-for="link in manageLinks" :key="link.to" :to="link.to" button-testid="settings-subpage-link">
              <span class="flex items-center gap-4">
                <UIcon :name="link.icon" class="size-5 shrink-0 text-muted" aria-hidden="true" />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span data-testid="settings-subpage-link-label">{{ link.label }}</span>
                  <span class="text-sm text-muted">{{ link.description }}</span>
                </span>
                <UIcon :name="ICONS.goOn" class="size-4 shrink-0 text-muted" aria-hidden="true" />
              </span>
            </ListRow>
          </ul>
          </PageSheet>
        </section>
      </div>

      <!-- Disconnect (#320): the dialog states what leaves the board and what is discarded -->
      <DisconnectSourceDialog v-model:open="isDisconnectOpen" :source="disconnectTarget" />
    </NuxtLayout>
  </div>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import PageSheet from '~/components/ui/PageSheet.vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { navigateTo } from 'nuxt/app'
import { useRoute, useRouter } from 'vue-router'
import SourceRow from '~/components/settings/SourceRow.vue'
import LocalStorageDetails from '~/components/settings/LocalStorageDetails.vue'
import DisconnectSourceDialog from '~/components/settings/DisconnectSourceDialog.vue'
import { useBoardStore } from '~/store/board'
import { useSettingsStore } from '~/store/settings'
import { WORKING_MINUTES } from '~/lib/dayCapacity'
import { useSourceList, type MoreSourceRow } from '~/composables/useSourceList'
import { isTauri } from '~/utils/isTauri'
import { useDataFolder } from '~/composables/useDataFolder'
import ListRow from '~/components/ui/ListRow.vue'
import { ICONS } from '~/lib/icons'
import { isIntegrationSourceId } from '~/lib/taskSources'
import type { IntegrationSourceId, SourceId } from '~/types/taskSource'

defineOptions({ name: 'SettingsPage' })

definePageMeta({
  layout: false,
  pageWidth: 'narrow', // one 672 px column on the app bar's axis (#673)
  titleKey: 'settings.page.title',
  pageHeader: false, // the app bar's third segment reads "Einstellungen" (#670)
})

const { t, locale } = useI18n()
const boardStore = useBoardStore()
const settingsStore = useSettingsStore()
const { connected, more } = useSourceList()
/** The note of a row in "Eine App verbinden" that cannot be connected here */
const MORE_STATE_KEYS: Record<Exclude<MoreSourceRow['state'], 'connectable'>, string> = {
  soon: 'sources.page.soon',
  macOnly: 'sources.page.macOnly',
  cloudUnavailable: 'sources.page.cloudUnavailable',
}

// The Keychain and updater pages exist on desktop only.
const isDesktop = isTauri()
const dataFolder = useDataFolder()
const dataStatus = dataFolder.status

// The active group lives in the URL (`?tab=`): back from a sub-page re-opens the same tab, a link can point at one
const TAB_IDS = ['board', 'sources', 'manage'] as const
type TabId = (typeof TAB_IDS)[number]
const route = useRoute()
const router = useRouter()
const tab = computed<TabId>(() => {
  const q = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab
  return TAB_IDS.find((id) => id === q) ?? 'board'
})
const tabItems = computed(() =>
  TAB_IDS.map((id) => ({
    value: id,
    label: t(`settings.tabs.${id}`),
  })),
)
const onTabChange = (value: string | number) => {
  void router.replace({ query: { ...route.query, tab: String(value) } })
}

// Working hours (#306): "Automatisch" is 0 in the control (a select item needs a value) and null in the store
const workingHoursValue = computed(() => settingsStore.workingHoursMinutes ?? 0)
const workingHoursItems = computed(() => {
  const hours = new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 })
  const lengths: Array<{ label: string; value: number }> = []
  for (let minutes = WORKING_MINUTES.min; minutes <= WORKING_MINUTES.max; minutes += WORKING_MINUTES.step) {
    lengths.push({ label: `${hours.format(minutes / 60)} ${t('duration.unitHour')}`, value: minutes })
  }
  return [{ label: t('settings.workingHours.auto'), value: 0 }, ...lengths]
})
const onWorkingHoursChange = (value: number | null | undefined) => {
  settingsStore.setWorkingHoursMinutes(value ? value : null)
}

const manageLinks = computed(() => [
  { to: '/settings/topics', icon: 'i-ph-tag', label: t('settings.subpages.topics.label'), description: t('settings.subpages.topics.description') },
  { to: '/settings/data', icon: 'i-ph-database', label: t('settings.subpages.data.label'), description: t(isDesktop ? 'settings.subpages.data.descriptionDesktop' : 'settings.subpages.data.descriptionWeb') },
  ...(isDesktop
    ? [
        { to: '/settings/updates', icon: 'i-ph-arrow-circle-up', label: t('settings.subpages.updates.label'), description: t('settings.subpages.updates.description') },
        { to: '/settings/github', icon: 'i-ph-key', label: t('settings.subpages.github.label'), description: t('settings.subpages.github.description') },
      ]
    : []),
])

// UTabs has no prop for its list: name the tablist so a screen reader announces the group switch
const tabsRef = ref<{ $el: HTMLElement } | null>(null)
onMounted(() => {
  const list = tabsRef.value?.$el?.querySelector('[data-slot="list"]')
  list?.setAttribute('aria-label', t('settings.tabs.label'))
})

const isDisconnectOpen = ref(false)
const disconnectTarget = ref<IntegrationSourceId | null>(null)

// A board that never onboarded has no sources to manage: the welcome flow picks the first one
// Exception (#438): a data file that is missing, unreadable or unreachable hydrates an empty board, and the Lokal row is where that is fixed
onMounted(async () => {
  if (boardStore.isOnboarded) return
  if (isDesktop) await dataFolder.refresh().catch(() => undefined)
  if (!(isDesktop && dataStatus.value !== 'ok')) void navigateTo('/welcome')
})

const onSetDefault = (id: SourceId) => {
  boardStore.setDefaultSource(id)
}

// A broken connection needs its credentials again: the token step, never the mapping a dead token cannot serve
const onRepair = (id: SourceId) => {
  // Reminders has no credentials to enter: its repair is the permission, which the settings page shows (#552)
  if (id === 'reminders') return void navigateTo('/settings/reminders')
  if (id !== 'notion') return
  const row = connected.value.find((r) => r.id === id)
  void navigateTo({ path: '/settings/notion', query: { setup: row?.repairNeedsCredentials ? 'repair' : 'settings' } })
}

const onOpenSettings = (id: SourceId) => {
  if (id === 'notion') void navigateTo('/settings/notion')
  if (id === 'reminders') void navigateTo('/settings/reminders')
}

const onDisconnect = (id: SourceId) => {
  if (!isIntegrationSourceId(id)) return
  disconnectTarget.value = id
  isDisconnectOpen.value = true
}

// The disconnect dialog opens from a menu item that is gone when it closes: focus goes back to the row's menu button
type RowHandle = { focusMenu: () => void }
const rowRefs: Partial<Record<SourceId, RowHandle>> = {}
const setRowRef = (id: SourceId, el: unknown) => {
  if (el) rowRefs[id] = el as RowHandle
  else Reflect.deleteProperty(rowRefs, id)
}
watch(isDisconnectOpen, async (open) => {
  if (open || !disconnectTarget.value) return
  await nextTick()
  rowRefs[disconnectTarget.value]?.focusMenu()
})

const onConnect = (id: IntegrationSourceId) => {
  // Apple Reminders connects on its own page (the same setup as the welcome flow, #552)
  if (id === 'reminders') return void navigateTo('/settings/reminders')
  void navigateTo({ path: '/settings/notion', query: { setup: 'connect' } })
}
</script>
