<!--
@component SettingSwitchRow
@kind component
@category input
@description One on/off setting as a row: label and one help line on the left, the switch on the right; takes effect at once. The same layout as the Fokus row on /settings.
@usage <SettingSwitchRow id="updates-auto" :label="t('…label')" :help="t('…help')" :model-value="store.flag" @update:model-value="store.setFlag" />
@avoid Not for a choice confirmed by a save button (UCheckbox) or several exclusive options (URadioGroup, USelect); the older switch rows on /settings still carry their own markup.
@responsibility
- The label names the switch (`for`), the help line describes it (`aria-describedby`); ids derive from `id`
- No border or padding of its own: the caller separates rows (a hairline `border-t` between them)
-->
<template>
  <div class="flex items-center gap-4">
    <div class="min-w-0 flex-1">
      <label :id="`${id}-label`" class="block text-default" :for="`${id}-switch`">{{ label }}</label>
      <p :id="`${id}-help`" class="text-body text-muted">{{ help }}</p>
    </div>
    <USwitch
      :id="`${id}-switch`"
      v-model="enabled"
      :aria-describedby="`${id}-help`"
      :data-testid="`${id}-switch`"
    />
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'SettingSwitchRow' })

interface Props {
  id: string
  label: string
  help: string
}

defineProps<Props>()
const enabled = defineModel<boolean>({ required: true })
</script>
