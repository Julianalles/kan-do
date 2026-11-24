<!--
@component StatsTile
@kind compound
@category display
@description Disclosure tile of the Statistik page: a question as heading, one line and a mini chart; its detail opens inside the tile, in its own panel (#689)
@usage Q2 to Q4 and the work-rhythm tile (5) in StatsTiles
@avoid Only the disclosure tiles of the Statistik page; a one-question verdict that stays open is StatsVerdict.
@responsibility
- Heading `<h2>` holding one toggle `<button aria-expanded aria-controls>` with the trailing `DisclosureCaret` (#610: one chevron for every block that opens in place, it replaces the round expand/close button); Enter / Space toggles, Esc closes an open tile
- A `PageSheet` (kd#180: the one sheet shape, 16 px radius and the resting shadow; no tones) that takes the size its grid cell gives it; the parent decides the cell (the open tile of Q2 to Q4 spans the row, #689); a `wide` tile is always full width and an open tile spans the row (#689); both put their line left and their chart right at `md+` (about 20rem, #600)
- Summary slot is always shown (the parent may leave the chart out while the detail repeats it). The `detail` slot is every tile's own panel (a `UCollapsible` over `--duration-slow`, no tab stops while closed; `data-testid="stats-tile-<n>-detail"`); `aria-controls` names it. The detail reads as the inside of the pressed tile: one surface, not a second sheet (#689, reverses #610 tile b)
- Glide hooks (#789): `data-stats-tile` on the sheet, `data-stats-summary` on the line-and-chart block (keyed by the arrangement, stacked or spread, so opening or closing swaps it as a new box whose height the glide eases) and `data-stats-detail` on the panel; `useTileGlide` reads them, nothing else may rely on them
- Without `toggleable` (no timeboxes at all) the heading is plain text and there is no panel
- Expose `focus()` so a host can return focus to the toggle
- Disclosure tile (moved from DESIGN.md, kd#176): closed panels have no tab stops; the toggle row is at least 44px; reduced motion removes any motion. No tile carries a step label
-->
<template>
  <PageSheet
    tag="section"
    :aria-labelledby="headingId"
    :class="wide ? 'md:col-span-6' : ''"
    :data-testid="`stats-tile-${n}`"
    data-stats-tile
  >
    <h2 :id="headingId" class="m-0">
      <button
        v-if="toggleable"
        ref="button"
        type="button"
        class="group flex min-h-11 w-full scroll-mt-[calc(var(--app-bar-offset-top)+var(--app-bar-veil-hang)+1rem)] items-start justify-between gap-4 text-left focus-ring"
        :aria-expanded="open"
        :aria-controls="ownPanelId"
        :data-testid="`stats-tile-${n}-toggle`"
        @click="emit('toggle')"
        @keydown.esc="open && emit('toggle')"
      >
        <SectionHeader tag="span" class="block flex-1">{{ question }}</SectionHeader>
        <DisclosureCaret :open="open" class="mt-1.5 group-hover:text-highlighted" />
      </button>
      <SectionHeader v-else tag="span" class="block">{{ question }}</SectionHeader>
    </h2>
    <!-- Keyed by the arrangement: opening or closing swaps the stacked summary for the spread one as a new box, whose height the glide eases (#789).
         `flow-root` keeps the line's top margin inside the box in both arrangements (the spread one is a flex box, which does so anyway): collapsed
         out of the stacked one, its 12 px were missing from the height the glide starts from, and the tile stepped 12 px in its first frame (#822) -->
    <div :key="spread ? 'spread' : 'stacked'" data-stats-summary class="flow-root" :class="spread ? 'md:flex md:items-center md:justify-between md:gap-10' : ''">
      <div :class="spread ? 'md:flex-1' : ''">
        <p class="mt-3 text-pretty text-default" data-private>{{ line }}</p>
        <slot name="under-line" />
      </div>
      <div class="mt-5 empty:hidden" :class="spread ? 'md:mt-3 md:w-80 md:shrink-0' : ''">
        <slot />
      </div>
    </div>

    <UCollapsible v-if="toggleable && $slots.detail" :open="open">
      <template #content>
        <div :id="ownPanelId" class="mt-8 border-t border-default pt-6" :data-testid="`stats-tile-${n}-detail`" data-stats-detail>
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
}>(), { toggleable: true, wide: false })

const emit = defineEmits<{ toggle: [] }>()

/** Line left and chart right at `md+`: a `wide` tile always, any tile while it is open (it then spans the row, #689) */
const spread = computed(() => props.wide || props.open)

const uid = useId()
const headingId = `stats-q-${uid}`
const ownPanelId = `stats-panel-${uid}`
const button = ref<HTMLButtonElement | null>(null)

defineExpose({ focus: () => button.value?.focus({ preventScroll: true }) })
</script>
