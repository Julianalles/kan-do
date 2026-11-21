<!--
@component TaskSheetMenu
@kind component
@category action
@description The task menu of the task sheet (#705, reverses #244's footer row): one ⋯ button holding open in source, move to source and Delete
@usage <TaskSheetMenu :delete-label="…" :open-label="…" :move-targets="targets" @delete="…" @open="…" @move="…" /> in the title row of the task sheet, left of the close button on desktop, beside the title in the drawer
@avoid Only the task sheet's task-level actions; card actions are TaskCardContextMenu. Not for actions used all the time: those are rows of the sheet.
@responsibility
- One quiet ghost icon button (`i-ph-dots-three-bold`, aria label `task.detail.menuLabel`) that opens a dropdown, end-aligned: open in source, move to source (a sub-menu of the targets, disabled ones with their hint, as in the card menu), a separator, Delete last in the error tone
- Open and move only exist on boards with a connected source; a Local board's menu holds Delete alone
- No Delete for a task whose source is read-only (`deleteLabel` null); with no item left the button is not rendered
- Delete only emits: the host runs the one shared, confirmed delete flow (never deletes by itself); the label keeps the source consequence ("Löschen, auch in Notion")
- Keyboard and screen reader come from the dropdown (Enter/Space opens, arrows move, Escape closes and returns focus to the button); the sheet puts it after the title in the tab order
-->
<template>
  <UDropdownMenu v-if="groups.length > 0" :items="groups" :content="{ align: 'end', sideOffset: 4 }">
    <UButton
      color="neutral"
      variant="ghost"
      square
      icon="i-ph-dots-three-bold"
      :aria-label="t('task.detail.menuLabel')"
      data-testid="task-menu"
    />
  </UDropdownMenu>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DropdownMenuItem } from '@nuxt/ui'
import { ICONS } from '~/lib/icons'
import type { MoveTarget } from '~/composables/useTaskMoveTargets'
import type { SourceId } from '~/types/taskSource'

defineOptions({ name: 'TaskSheetMenu' })

const props = defineProps<{
  /** "In Notion öffnen"; null or empty when the task has no link to open */
  openLabel?: string | null
  /** The other sources the task can move to; empty on a single-source board */
  moveTargets: MoveTarget[]
  /** "Löschen" with its source consequence; null for a task that cannot be deleted from kan-do (Reminders, #551): no item */
  deleteLabel: string | null
}>()

const emit = defineEmits<{
  open: []
  move: [source: SourceId]
  delete: []
}>()

const { t } = useI18n()

/** The groups of the menu, empty ones left out: the source actions, then Delete on its own, set apart by the group's separator. */
const groups = computed<DropdownMenuItem[][]>(() => {
  const source: DropdownMenuItem[] = []
  if (props.openLabel) source.push({ label: props.openLabel, icon: ICONS.external, onSelect: () => emit('open') })
  if (props.moveTargets.length > 0) {
    source.push({
      label: t('task.contextMenu.moveToSource'),
      icon: 'i-ph-swap',
      children: props.moveTargets.map(target => ({
        label: target.name,
        icon: target.icon,
        ...(target.hint ? { description: target.hint } : {}),
        disabled: target.disabled,
        onSelect: () => emit('move', target.source),
      })),
    })
  }
  const destructive: DropdownMenuItem[] = props.deleteLabel
    ? [{ label: props.deleteLabel, icon: ICONS.delete, color: 'error', onSelect: () => emit('delete') }]
    : []
  return [source, destructive].filter(group => group.length > 0)
})
</script>
