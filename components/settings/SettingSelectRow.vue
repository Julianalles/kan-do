<!--
@component SettingSelectRow
@kind component
@category input
@description One setting picked from a short fixed list, as a row: label and one help line on the left, the select on the right; takes effect at once. First used for "Arbeitszeit pro Tag" (#306) and "Größe der Anzeige" (#845) on /settings.
@usage <SettingSelectRow id="ui-scale" :label="t('…label')" :help="t('…help')" :items="[{ label: '100 %', value: 100 }]" :model-value="store.uiScale" @update:model-value="store.setUiScale" />
@avoid Not for one on/off setting (SettingSwitchRow), not for a choice confirmed by a save button and not for a value the user types (UInput in a form field).
@responsibility
- The label names the select (`for`), the help line describes it (`aria-describedby`); ids and test ids derive from `id` (`<id>-select`, `<id>-label`, `<id>-help`, the row `<id>-setting`)
- The select is 12rem wide beside the text, so a label like "100 % (Standard)" is not cut, and every select row of a page ends on the same left edge; on a phone the row wraps and the select takes the full width below the text
- No border or padding of its own: the caller separates rows (a hairline `border-t` between them)
- Pattern: pick one of a short fixed list in the settings, aligned with SettingSwitchRow (label and help left, control right; the control is a `USelect`)
-->
<template>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-3" :data-testid="`${id}-setting`">
    <div class="min-w-0 flex-1 basis-56">
      <label :id="`${id}-label`" class="block text-default" :for="`${id}-select`">{{ label }}</label>
      <p :id="`${id}-help`" class="text-body text-muted">{{ help }}</p>
    </div>
    <USelect
      :id="`${id}-select`"
      v-model="value"
      :items="items"
      :aria-describedby="`${id}-help`"
      class="w-full sm:w-48"
      :data-testid="`${id}-select`"
    />
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'SettingSelectRow' })

interface Props {
  id: string
  label: string
  help: string
  items: Array<{ label: string, value: number }>
}

defineProps<Props>()
const value = defineModel<number>({ required: true })
</script>
