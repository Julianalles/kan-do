<!--
@component StatsTile
@kind compound
@category display
@description Disclosure tile of the Statistik page: a question as heading, one line and a mini chart; its detail opens in place (the wide tile inside itself, the others as a row the parent renders below the tiles)
@usage Q2 to Q4 and the work-rhythm tile (5) in StatsTiles
@avoid Only the disclosure tiles of the Statistik page; a one-question verdict that stays open is StatsVerdict.
@responsibility
- Heading `<h2>` holding one toggle `<button aria-expanded aria-controls>` with the trailing `DisclosureCaret` (#610: one chevron for every block that opens in place, it replaces the round expand/close button); Enter / Space toggles, Esc closes an open tile
- A `PageSheet` (kd#180: the one sheet shape, 16 px radius and the resting shadow; no tones) that never changes its size on its own account: the grid gives it its cell and the open state moves nothing (#610); a `wide` tile is always full width and puts its line left and its chart right at `md+` (about 20rem, #600), open or closed: the summary never changes with the open state, so the tile stays put and only its detail moves
- Summary slot is always shown. The `detail` slot is the wide tile's own panel (a `UCollapsible` over `--duration-slow`, no tab stops while closed); the other tiles have none, their detail is a sheet of the parent's, named by `panelId`
- Without `toggleable` (no timeboxes at all) the heading is plain text and there is no panel
- Expose `focus()` so a host can return focus to the toggle
- Disclosure tile (moved from DESIGN.md, kd#176): closed panels have no tab stops; the toggle row is at least 44px; reduced motion removes any motion. No tile carries a step label
-->
<template>
  <PageSheet
    tag="section"
    :aria-labelledby="headingId"
    :class="[wide ? 'md:col-span-6' : '', open ? 'ring-1 ring-accented' : '']"
    :data-testid="`stats-tile-${n}`"
  >
    <h2 :id="headingId" class="m-0">
      <button
        v-if="toggleable"
        ref="button"
        type="button"
        class="group flex min-h-11 w-full items-start justify-between gap-4 text-left focus-ring"
        :aria-expanded="open"
        :aria-controls="panelRef"
        :data-testid="`stats-tile-${n}-toggle`"
        @click="emit('toggle')"
        @keydown.esc="open && emit('toggle')"
      >
        <SectionHeader tag="span" class="block flex-1">{{ question }}</SectionHeader>
        <DisclosureCaret :open="open" class="mt-1.5 group-hover:text-highlighted" />
      </button>
      <SectionHeader v-else tag="span" class="block">{{ question }}</SectionHeader>
    </h2>
    <div :class="wide ? 'md:flex md:items-center md:justify-between md:gap-10' : ''">
      <div :class="wide ? 'md:flex-1' : ''">
        <p class="mt-3 text-pretty text-default" data-private>{{ line }}</p>
        <slot name="under-line" />
      </div>
      <div class="mt-5" :class="wide ? 'md:mt-3 md:w-80 md:shrink-0' : ''">
        <slot />
      </div>
    </div>

    <UCollapsible v-if="toggleable && $slots.detail" :open="open">
      <template #content>
        <div :id="ownPanelId" class="mt-8 border-t border-default pt-6">
          <slot name="detail" />
        </div>
      </template>
    </UCollapsible>
  </PageSheet>
</template>

<script setup lang="ts">
import PageSheet from '~/components/ui/PageSheet.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import DisclosureCaret from '~/components/ui/DisclosureCaret.vue'
import { computed, ref, useId } from 'vue'

defineOptions({ name: 'StatsTile' })

const props = withDefaults(defineProps<{
  /** Position among the tiles (1 is the verdict; 5 is the work-rhythm tile, #600); names the test ids. */
  n: 2 | 3 | 4 | 5
  question: string
  /** The one-sentence answer under the heading. */
  line: string
  open: boolean
  toggleable?: boolean
  /** Full width of the grid also while closed, line left and chart right at `md+`. */
  wide?: boolean
  /** The id of the detail sheet the parent renders (`aria-controls`); absent = the tile's own panel */
  panelId?: string
}>(), { toggleable: true, wide: false, panelId: undefined })

const emit = defineEmits<{ toggle: [] }>()

const uid = useId()
const headingId = `stats-q-${uid}`
const ownPanelId = `stats-panel-${uid}`
const panelRef = computed(() => props.panelId ?? ownPanelId)
const button = ref<HTMLButtonElement | null>(null)

defineExpose({ focus: () => button.value?.focus({ preventScroll: true }) })
</script>
