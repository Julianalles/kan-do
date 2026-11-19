<!--
@component NowGlyph
@kind primitive
@category display
@description The floating Now window's three glyphs (pause, play, done) drawn in the SF Symbols style (pause.fill, play.fill, checkmark in a semibold stroke), so the pill's buttons share one weight and optical size (#565)
@usage Only inside NowWindow's pause and done buttons; the glyph takes the button's text colour and is decorative (`aria-hidden`), the button carries the accessible name
@avoid Anywhere else: the app's icons are Phosphor through UIcon (`ph:`); a Phosphor set has no weight that matches the system's symbols, which is why this exists
@responsibility
- Draws one of `pause`, `play`, `check` on a 20 x 20 box in `currentColor`; the size comes from the consumer (`.now-glyph`)
- Filled glyphs (pause, play) get a rounded join the way the system draws them; the check is a 2.8 stroke with round caps, the weight that reads as one with the filled shapes at 20 px
- Reads no store and no theme: no colour of its own
-->
<template>
  <svg class="now-glyph" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <g v-if="kind === 'pause'" fill="currentColor">
      <rect x="4.6" y="3.2" width="3.8" height="13.6" rx="1.3" />
      <rect x="11.6" y="3.2" width="3.8" height="13.6" rx="1.3" />
    </g>
    <path
      v-else-if="kind === 'play'"
      d="M6.2 3.9 L15.6 9.2 Q16.3 10 15.6 10.8 L6.2 16.1 Q5 16.6 5 15.3 L5 4.7 Q5 3.4 6.2 3.9 Z"
      fill="currentColor"
      stroke="currentColor"
      stroke-width="1.2"
      stroke-linejoin="round"
    />
    <path
      v-else
      d="M3.9 10.4 L8.1 14.6 L16.2 5.4"
      fill="none"
      stroke="currentColor"
      stroke-width="2.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<script setup lang="ts">
defineOptions({ name: 'NowGlyph' })

interface Props {
  kind: 'pause' | 'play' | 'check'
}
defineProps<Props>()
</script>
