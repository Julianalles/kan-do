<!--
@component SourceRow
@kind component
@category display
@description One connected task source on the "Speicherorte" page (#324): icon, name with the quiet
"Standard" badge, a status line and the actions that source offers. A hairline-divided list item, no card.
@usage <SourceRow v-for="row in connected" :key="row.id" :row="row" @set-default="..." @repair="..." @open-settings="..." @disconnect="..." />
@avoid Only a connected source on the Speicherorte page.
@responsibility
- `#details` slot: extra content for one row (Lokal: `LocalStorageDetails`) on its own full-width line below, aligned with the name
- Show the badge as text on the default row, "Als Standard festlegen" on every other row
- Status line: muted, warning tone for "Verbindung prüfen" (never an error colour, never a toast); the time
  text is plain, a separate visually hidden live region announces only the warning, so the 30 s refresh of
  "vor 3 Min." never interrupts a screen reader
- Name and actions share one line at every width (#333): the name column shrinks (`min-w-0 flex-1`, no basis), nothing wraps under it
- "Als Standard festlegen", "<Source>-Einstellungen" and "Trennen" sit behind one "…" menu button (`UDropdownMenu`, a ghost
  icon-only trigger named "Aktionen für <Source>"), on phone and desktop alike; only what the row data allows (Local as the
  default has no action and no menu button). Accepted trade-off: these actions are one tap further away
- "Verbindung reparieren" stays a visible button before the menu button: a broken connection is the one thing the row asks for.
  On a phone it is the one part that takes a second line (under the name): 165 px of button do not fit beside name, badge and status in 310 px
- The "…" glyph sits within 2 px of the sheet's right edge, like "Verbinden" below it (negative end margin on the 4 px grid, the hit area stays); `focusMenu()` is exposed so the page returns focus to the button when the disconnect dialog closes
- Pattern: several secondary actions behind one trigger → reused UDropdownMenu (as the task sheet's move menu)
-->
<template>
  <ListRow
    class="gap-y-3"
    :data-testid="`source-row-${row.id}`"
  >
    <UIcon :name="row.icon" class="size-5 shrink-0 text-muted" aria-hidden="true" />
    <div class="min-w-0 flex-1">
      <p class="flex items-center gap-2 text-default">
        {{ row.name }}
        <UBadge
          v-if="row.isDefault"
          color="neutral"
          variant="soft"
          :data-testid="`source-default-${row.id}`"
        >
          {{ t('sources.row.default') }}
        </UBadge>
      </p>
      <p
        class="text-sm"
        :class="row.statusTone === 'warning' ? 'text-warning-700' : 'text-muted'"
        :data-testid="`source-status-${row.id}`"
      >
        {{ row.statusText }}
      </p>
      <span class="sr-only" role="status">{{ announcement }}</span>
    </div>
    <!-- Phone: the repair cannot share 310 px with name, badge and status, so it takes the line below (under the name) -->
    <div v-if="row.canRepair" class="max-md:order-1 max-md:basis-full max-md:ps-9">
      <UButton
        color="neutral"
        variant="soft"
        :aria-label="t('sources.row.repairNamed', { source: sourceCompound(row.name, locale) })"
        :data-testid="`source-repair-${row.id}`"
        @click="emit('repair', row.id)"
      >
        {{ t('sources.row.repair') }}
      </UButton>
    </div>
    <UDropdownMenu v-if="menuItems.length" :items="menuItems" :content="{ align: 'end', sideOffset: 4 }">
      <UButton
        ref="menuButton"
        color="neutral"
        variant="ghost"
        icon="i-ph-dots-three-bold"
        class="-me-2 shrink-0 max-md:-me-3"
        :aria-label="t('sources.row.actionsNamed', { source: row.name })"
        :data-testid="`source-actions-${row.id}`"
      />
    </UDropdownMenu>
    <!-- Local only (#438): where the data lives and its health, on a line of its own under the row, aligned with the name -->
    <div v-if="$slots.details" class="basis-full ps-9 pb-2" :data-testid="`source-details-${row.id}`">
      <slot name="details" />
    </div>
  </ListRow>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ListRow from '~/components/ui/ListRow.vue'
import { useI18n } from 'vue-i18n'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ConnectedSourceRow } from '~/composables/useSourceList'
import type { SourceId } from '~/types/taskSource'

import { sourceCompound } from '~/utils/sourceCompound'

defineOptions({ name: 'SourceRow' })

interface Props {
  row: ConnectedSourceRow
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'setDefault' | 'repair' | 'openSettings' | 'disconnect', id: SourceId): void
}>()

const { t, locale } = useI18n()

/** Only a warning is announced: the live region changes on a real status change, not when "vor 3 Min." counts up */
const announcement = computed(() => (props.row.statusTone === 'warning' ? props.row.statusText : ''))

/** The row's secondary actions, in the order the buttons had, "Trennen" in a group of its own below a divider; the row names the source, so the items do not repeat it */
const menuItems = computed<DropdownMenuItem[][]>(() => {
  const { id, name } = props.row
  const items: DropdownMenuItem[] = []
  const leaving: DropdownMenuItem[] = []
  if (props.row.canSetDefault) {
    items.push({ label: t('sources.row.setDefault'), icon: 'i-ph-check-circle', onSelect: () => emit('setDefault', id) })
  }
  if (props.row.canConfigure) {
    items.push({ label: t('sources.row.settings', { source: sourceCompound(name, locale.value) }), icon: 'i-ph-gear', onSelect: () => emit('openSettings', id) })
    leaving.push({ label: t('sources.row.disconnect'), icon: 'i-ph-plugs', onSelect: () => emit('disconnect', id) })
  }
  return [items, leaving].filter((group) => group.length)
})

/** The host returns focus here when a dialog the menu opened closes (the menu item it came from is gone by then) */
const menuButton = ref<{ $el: HTMLElement } | null>(null)
defineExpose({ focusMenu: () => menuButton.value?.$el?.focus() })
</script>
