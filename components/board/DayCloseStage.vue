<!--
@component DayCloseStage
@kind block
@category overlay
@description The day close as a key moment (#98, #237, #480): a full-size stage on the recap's photo, like the new-day recap, with one calm sheet: the progress text, how the done tasks compare with their timebox, the spread of the topics, one line saying what closing does, and the two buttons. The user chooses nothing: closing archives the done tasks and takes every unfinished task off today's board for "Alle", where it is re-planned the next day; nothing is deleted.
@usage Mounted once in pages/tasks.vue (lazy, like the recap); opened through useDayClose().open() (Mehr panel row, the Erledigt CTA, the native menu, the command palette).
One centred column (max 32rem) on desktop and a phone alike; the page itself never scrolls, only the stage's scroll area on short windows.
@avoid Not for a plain confirmation (UModal) and not the first start of a new day (NewDayRecap); no lists of tasks and no per-task choice here.
@responsibility
- Shell only: title (the page title, SectionHeader `display`), the date as subline, sheet 1 (DayCloseSummary, DayCloseTimebox, DayCloseTopics), sheet 2 (the consequence line and the buttons); the stage reuses the recap's photo, CSS and closing curtain (assets/css/recap-stage.css)
- Not modal, like the recap: teleported to `#recap-stage-host`, a `role="region"` named by the title, no scrim, no focus trap; the app bar stays usable above it and the board is `inert` behind it (pages/tasks.vue); leaving the page closes it without a change
- Esc and "Abbrechen, nichts ändert sich" (a regular secondary button) only dismiss: nothing is archived, moved or stored
- "Tag abschließen" (the primary, the one action with an effect: useDayCloseAction.finishDay) archives the done tasks and takes every unfinished task off the board; the curtain then plays and the sheet keeps the day it showed (useDayClose.freeze). Disabled while the data file blocks writes (ADR 011)
- Focus starts on "Abbrechen, nichts ändert sich", the safe exit, so a key still held from the trigger cannot close the day; after the curtain focus returns to the trigger, or to the board when it is gone
- The date is read when the stage opens (stable across midnight); the app bar's veil steps back while the stage exists (`data-recap-stage` on <html>)
-->
<template>
  <!-- Outside the inert board (<main> in pages/tasks.vue), in app.vue's host: the same stacking context as the app bar, so the bar paints above the photo (#262) -->
  <Teleport to="#recap-stage-host" defer>
    <div
      v-if="shown"
      class="recap-stage"
      role="region"
      :aria-labelledby="titleId"
      :data-closing="closing || undefined"
      :inert="closing || undefined"
      data-testid="day-close-stage"
      data-window-drag-layer
      @keydown.esc="leave(false)"
    >
      <!-- Atmosphere only; the layer is the paper colour until the photo has loaded (or if it never does) -->
      <div class="recap-stage__photo bg-page" aria-hidden="true">
        <img
          src="/welcome/desk-1672.webp"
          srcset="/welcome/desk-800.webp 800w, /welcome/desk-1672.webp 1672w"
          sizes="100vw"
          alt=""
          decoding="async"
          data-testid="day-close-photo"
          class="size-full object-cover transition-opacity duration-(--duration-slow) motion-reduce:transition-none"
          :class="photoLoaded ? 'opacity-100' : 'opacity-0'"
          @load="photoLoaded = true"
        >
      </div>
      <div class="recap-stage__scroll">
        <div class="recap-stage__content recap-stage__content--narrow">
          <div class="text-center">
            <SectionHeader :id="titleId" tag="h2" size="display" data-slot="title">{{ t('dayClose.title') }}</SectionHeader>
            <p class="mt-2 text-base text-toned" data-testid="day-close-date">{{ date }}</p>
          </div>

          <!-- Sheet 1: how the day went. No list and no choice -->
          <div class="recap-stage__controls flex flex-col gap-6" data-testid="day-close-sheet">
            <DayCloseSummary :done-count="done.length" :open-count="inFlight.length" />
            <DayCloseTimebox :groups="boxGroups" />
            <DayCloseTopics :rows="topics" />
          </div>

          <!-- Sheet 2: what closing does, and the two ways out; stacked when narrow, the primary last -->
          <div class="recap-stage__controls @container" data-testid="day-close-controls">
            <p v-if="consequence" class="mb-3 text-sm text-toned" data-testid="day-close-consequence">{{ consequence }}</p>
            <div class="flex flex-col gap-2 @md:flex-row @md:items-center @md:justify-end">
              <UButton
                color="neutral"
                variant="soft"
                class="w-full justify-center @md:w-auto"
                data-day-close-cancel
                data-testid="day-close-cancel"
                @click="leave(false)"
              >
                {{ t('dayClose.cancel') }}
              </UButton>
              <UButton
                color="primary"
                class="w-full justify-center @md:w-auto"
                :disabled="blocked"
                data-testid="day-close-done-button"
                @click="leave(true)"
              >
                {{ t('dayClose.finish') }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import DayCloseSummary from '~/components/board/DayCloseSummary.vue'
import DayCloseTimebox from '~/components/board/DayCloseTimebox.vue'
import DayCloseTopics from '~/components/board/DayCloseTopics.vue'
import { useDayClose, useDayCloseData } from '~/composables/useDayClose'
import { dayCloseBlocked, useDayCloseAction } from '~/composables/useDayCloseAction'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { timeBoxGroups, topicRows } from '~/utils/dayClose'

defineOptions({ name: 'DayCloseStage' })

const { t } = useI18n()
const { locale } = useLocaleFormat()
const { isOpen, close, restoreFocus } = useDayClose()
const { done, inFlight } = useDayCloseData()
// Resolved in setup: closing needs the Nuxt-bound move path
const { finishDay } = useDayCloseAction()

const titleId = useId()
const photoLoaded = ref(false)
/** The curtain is running: the stage was left (dismissed or closed) and stays until the photo is off. */
const closing = ref(false)
const shown = computed(() => isOpen.value || closing.value)
/** Desktop only: the data file is in conflict or unavailable, nothing may move. */
const blocked = computed(() => isOpen.value && dayCloseBlocked())

/** The day the sheet shows, read when the stage opens: stable while it is open, even across midnight. */
const openedAt = ref(new Date())
const date = computed(() => new Intl.DateTimeFormat(locale.value, { weekday: 'long', day: 'numeric', month: 'long' }).format(openedAt.value))

const boxGroups = computed(() => timeBoxGroups(done.value))
const topics = computed(() => topicRows(done.value))
/** What closing does: the user's own wording; without unfinished tasks only its second sentence, and nothing to say on an empty day. */
const consequence = computed(() => {
  if (inFlight.value.length > 0) return t('dayClose.consequence')
  return done.value.length > 0 ? t('dayClose.consequenceDoneOnly') : ''
})

// The app bar's veil steps back while the stage exists, the curtain included (recap-stage.css). An attribute on <html>
// instead of `html:has(.recap-stage)`, which restyles the whole page on every change below it (#275).
const markStage = (on: boolean) => {
  if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-recap-stage', on)
}
watch(shown, markStage, { immediate: true, flush: 'post' })
let curtainTimer: ReturnType<typeof setTimeout> | undefined

/** Only the photo's own slide ends the curtain: its image's opacity fade bubbles up here too. */
function onPhotoEnd(event: Event) {
  if (event.target === event.currentTarget && (event as TransitionEvent).propertyName === 'transform') endCurtain()
}

function endCurtain() {
  if (!closing.value) return
  clearTimeout(curtainTimer)
  closing.value = false
  finishCurtain()
}

/** Focus goes back to the trigger (or the board) only if it was on the stage or nowhere; a sheet the user opened meanwhile keeps it. */
function finishCurtain() {
  const active = document.activeElement
  const stage = document.querySelector('[data-testid="day-close-stage"]')
  const keep = active && active !== document.body && !stage?.contains(active)
  if (!keep) restoreFocus()
}

/**
 * Both buttons and Escape: leave the stage at once (`finish`: the day is closed, else nothing changes), then let the curtain play.
 * Not repeatable: the second click finds the stage closed.
 */
function leave(finish: boolean) {
  if (closing.value || !isOpen.value) return
  const stage = document.querySelector<HTMLElement>('[data-testid="day-close-stage"]')
  if (finish) {
    if (!finishDay()) return // writes are blocked: nothing moved, the stage stays
  }
  else {
    close()
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!stage || reduced) {
    finishCurtain()
    return
  }
  closing.value = true
  // Wait for the photo's own transition; the timer (its duration read from the CSS) is the net if it never ends.
  const wait = Number.parseFloat(getComputedStyle(stage).getPropertyValue('--recap-curtain-duration')) || 0
  curtainTimer = setTimeout(endCurtain, wait + 100)
  stage.querySelector('.recap-stage__photo')?.addEventListener('transitionend', onPhotoEnd)
}

/** Focus starts on the safe exit. The stage may not be in the DOM yet (teleported to the host after the first frames): it looks again on each frame (up to a second). */
function focusSafeExit(framesLeft = 60) {
  const cancel = document.querySelector<HTMLElement>('[data-day-close-cancel]')
  if (cancel) cancel.focus({ preventScroll: true })
  else if (framesLeft > 0 && isOpen.value) requestAnimationFrame(() => focusSafeExit(framesLeft - 1))
}

watch(isOpen, async (open) => {
  if (!open || typeof window === 'undefined') return
  openedAt.value = new Date()
  await nextTick()
  requestAnimationFrame(() => focusSafeExit())
}, { immediate: true })

onBeforeUnmount(() => {
  clearTimeout(curtainTimer)
  // Leaving the page while the stage is open dismisses it: nothing changes (its state is module-level)
  if (isOpen.value) close()
  markStage(false)
})
</script>
