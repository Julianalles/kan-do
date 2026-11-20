<!--
@component RemindersListChoices
@kind block
@category input
@description The answer per Apple Reminders list (#552): one row per list with its colour, name, a count or "Wird nicht gelesen", and a quiet segmented group Thema, Aktivität, Aus. The setup step and the Erinnerungen-Einstellungen both render it.
@usage <RemindersListChoices :lists="lists" :roles="roles" :confirming="ask" @pick="(id, role) => …" @confirm="…" @cancel="…" /> where `roles` maps every list id to its role and `confirming` (settings only) is the list that waits for the answer to "nicht mehr lesen?"
@avoid Only the lists of Apple Reminders; Notion's mapping steps are their own wizard steps.
@responsibility
- A list of rows (`ul`) with hairlines: a colour dot (the list's own colour as Reminders holds it, a mark only and not a status: the one place a data colour appears outside topic hues; quieter when Aus), the name (truncates, `data-private`), the detail line, and the per-list `SegmentedChoice` (one radio group per list, named "<list> zählt als")
- An Aus list is dimmed: its dot and name go muted and the detail reads "Wird nicht gelesen"
- Never a scroll area of its own: in the setup the page scrolls (the shell's pane follows the content's height), in the settings it is a section of the sheet
- Phone: the group takes its own line under the name (44 px targets); desktop: it sits at the end of the row
- `confirming` opens the in-place question under that row (Ask in place, DESIGN.md "Behaviour": no modal): the counts, "Nicht mehr lesen" and "Abbrechen"; the panel is a labelled group that takes focus when it opens, Cancel returns focus to the row's picked segment; the host decides when to ask and owns the counts
- Emits the picked role and never writes a store: the setup keeps a draft, the settings page writes `remindersConfig`
- Pattern: per-list answer, diverged from ChoiceChip (see SegmentedChoice); in-place question aligned with the day-close and delete questions of DESIGN.md "Ask in place"
-->
<template>
  <ul class="divide-y divide-default" :aria-label="t('onboarding.flow.reminders.lists.groupLabel')" data-testid="reminders-list-choices">
    <li
      v-for="list in lists"
      :key="list.id"
      :ref="(el) => setRowRef(list.id, el)"
      class="flex flex-col gap-3 py-3"
      :data-testid="`reminders-list-${list.id}`"
    >
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span
          class="size-3 shrink-0 rounded-full"
          :class="{ 'opacity-40': roles[list.id] === 'off' }"
          :style="{ background: list.color ?? 'var(--ui-border-accented)' }"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1">
          <span class="block truncate" :class="roles[list.id] === 'off' ? 'text-muted' : 'text-default'" data-private>{{ list.title }}</span>
          <span class="block text-sm text-muted" :data-testid="`reminders-list-detail-${list.id}`">
            {{ roles[list.id] === 'off' ? t('onboarding.flow.reminders.lists.notRead') : t('onboarding.flow.reminders.lists.open', { n: list.openCount }) }}
          </span>
        </span>
        <SegmentedChoice
          :model-value="roles[list.id] ?? 'topic'"
          :options="options"
          :label="t('onboarding.flow.reminders.lists.choiceLabel', { list: list.title })"
          :item-testid="`reminders-role-${list.id}`"
          class="max-sm:ms-7 max-sm:basis-full"
          @update:model-value="(role) => emit('pick', list.id, role)"
        />
      </div>

      <div
        v-if="confirming?.listId === list.id"
        :ref="(el) => setPanelRef(el)"
        tabindex="-1"
        role="group"
        :aria-label="t('settings.reminders.excludeTitle', { list: list.title })"
        class="ms-7 flex flex-col gap-3 rounded-lg bg-muted p-4 outline-none"
        data-testid="reminders-exclude-confirm"
      >
        <p class="text-body text-default" aria-live="polite">
          <span data-private>{{ t('settings.reminders.excludeTitle', { list: list.title }) }}</span>
          {{ t('settings.reminders.excludeLeaving', { n: confirming.leaving }, confirming.leaving) }},
          {{ t('settings.reminders.excludeOnBoard', { m: confirming.onBoard }, confirming.onBoard) }}
          {{ t('settings.reminders.excludeStays') }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton color="primary" data-testid="reminders-exclude-confirm-yes" @click="emit('confirm')">{{ t('settings.reminders.excludeConfirm') }}</UButton>
          <UButton color="neutral" variant="ghost" data-testid="reminders-exclude-confirm-cancel" @click="cancel(list.id)">{{ t('settings.reminders.excludeCancel') }}</UButton>
        </div>
      </div>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SegmentedChoice from '~/components/ui/SegmentedChoice.vue'
import type { ReminderList } from '~/lib/reminders'
import type { ReminderListRole } from '~/lib/remindersSource'

defineOptions({ name: 'RemindersListChoices' })

const props = defineProps<{
  lists: ReminderList[]
  /** The role per list id; a list not named reads Thema */
  roles: Record<string, ReminderListRole>
  /** The list whose switch to Aus waits for the answer, with the live counts; `null` asks nothing */
  confirming?: { listId: string; leaving: number; onBoard: number } | null
}>()

const emit = defineEmits<{
  (e: 'pick', listId: string, role: ReminderListRole): void
  (e: 'confirm' | 'cancel'): void
}>()

const { t } = useI18n()

const options = computed<{ value: ReminderListRole; label: string }[]>(() => [
  { value: 'topic', label: t('onboarding.flow.reminders.lists.topic') },
  { value: 'activity', label: t('onboarding.flow.reminders.lists.activity') },
  { value: 'off', label: t('onboarding.flow.reminders.lists.off') },
])

const rows = new Map<string, HTMLElement>()
const setRowRef = (listId: string, el: unknown) => {
  if (el instanceof HTMLElement) rows.set(listId, el)
  else rows.delete(listId)
}
let panel: HTMLElement | null = null
const setPanelRef = (el: unknown) => {
  panel = el instanceof HTMLElement ? el : null
}

// The question opens under the row the user just changed: focus follows it so a keyboard user answers it next
watch(() => props.confirming?.listId, async (listId) => {
  if (!listId) return
  await nextTick()
  panel?.focus({ preventScroll: false })
})

/** Cancel: the host puts the choice back, focus returns to the row's picked segment */
async function cancel(listId: string) {
  emit('cancel')
  await nextTick()
  rows.get(listId)?.querySelector<HTMLElement>('[role="radio"][data-state="checked"]')?.focus()
}
</script>
