<!--
@component NewDayRecap
@kind block
@category overlay
@description "Kurzer Rückblick" (#385, #451, #44, #245, #428): the recap on the first start of a new day, shown as a stage on the welcome photo, behind the app bar, instead of a dialog over the board. The headline, the summary and the two decks (still open, done: Offen → Erledigt like the board) lie directly on the photo; only the controls sit on a sheet: "Tag neu planen" (primary: the fresh start, which takes yesterday's unfinished cards off the board and archives the done ones, and the way to "Alle") and "Überspringen und Board anzeigen" (leads to the board and keeps it as it is, archives nothing).
@usage Mounted once in pages/tasks.vue next to DayCloseStage; opened by useNewDayRecap().check() on mount.
One centred column (max 44rem) with both decks side by side from 768px, one deck with a switcher below; the controls sheet closes it. The page itself never scrolls; only the stage's scroll area may, on very short windows.
@avoid Only the first start of a new day; closing the day is DayCloseStage.
@responsibility
- Shell only: headline (the page title, SectionHeader `display`), summary, decks (body), controls sheet; no paper sheet around the content (#428). Text lies on the photo, so DESIGN.md "The Bright Ground Rule" applies: its tokens must hold AA there (rendered scan)
- Not modal (#245), teleported to `#recap-stage-host` (app.vue) so the inert board does not take it along and the bar stays above it: a `role="region"` named by the headline, no scrim, no focus trap. The app bar stays usable and sits above the stage (`--z-bar`); the board is `inert` behind it (`pages/tasks.vue`). Going to settings and coming back finds the same recap, because the state lives in `useNewDayRecap`
- Focus starts on "Tag neu planen"; both buttons and Escape inside the stage call `leave()`: "Tag neu planen" goes to "Alle" first and then starts the day fresh (`useNewDay().freshStart()`, #387: the only thing here that moves a card) and archives yesterday's done tasks (`leave({ archive: true })`), "Überspringen und Board anzeigen" goes to Heute when "Alle" shows and moves and archives nothing (the done tasks stay in Erledigt under the "Gestern erledigt" note, whose "Gesehen" hides them), Escape only dismisses, never navigates, moves and archives nothing; `finishLeave()` after the curtain hands focus to the board
- The app bar follows the open state (#428): while the recap is open its pill is Rückblick + Statistik (useAppNav), and leaving it turns Rückblick into Alle + Heute.
- Open as the page mounts (an app start, or back from another page, #427): `pages/tasks.vue` runs the day check in setup and hides the board (`data-recap-cover`) until the recap is left, so the board is never seen before it; the stage fades in over 1.4 s ("Dawn", #463, `--recap-enter-duration`) also then, over the paper colour
- Curtain (assets/css/recap-stage.css): `leave()` runs at once (archive, marker, the board is live), the stage stays mounted while the content fades (200 ms) and only the photo slides up (700 ms, ease in-out; "Tag neu planen" lifts it 1.4 s onto "Alle", which the board reached at once beneath the covering stage before the curtain started, with no Heute frame and no second slide, `data-pace="lift"`, #433, #490) with a feathered edge; reduced motion: instant. A second click or Escape during the curtain does nothing
- The photo is the welcome page's (`public/welcome`), decoration only (`alt=""`); until it loads, or if it fails, the layer is the paper colour
- Phone switcher ("n noch offen" / "n erledigt", a `UTabs` pill: `role="tab"`, `aria-selected`): one RecapDeck mounted at a time, starts on "noch offen" (on "erledigt" when nothing is open, then without a switcher)
- The decks never change size (RecapDeck), so nothing moves while they are looked at
- Controls sheet: the two buttons right in a container query (`@md`), stacked and full width when narrow with "Tag neu planen" above "Überspringen und Board anzeigen"; default button size on both (One Height Rule, #424), no width override beyond the stacked full width
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
      data-testid="new-day-recap"
      data-window-drag-layer
      @keydown.esc="planning || leaveOnce()"
    >
      <!-- Atmosphere only; the layer is the paper colour until the photo has loaded (or if it never does) -->
      <div class="recap-stage__photo bg-page" aria-hidden="true">
        <img
          src="/welcome/desk-1672.webp"
          srcset="/welcome/desk-800.webp 800w, /welcome/desk-1672.webp 1672w"
          sizes="100vw"
          alt=""
          decoding="async"
          data-testid="recap-photo"
          class="size-full object-cover transition-opacity duration-(--duration-slow) motion-reduce:transition-none"
          :class="photoLoaded ? 'opacity-100' : 'opacity-0'"
          @load="photoLoaded = true"
        >
      </div>
      <div class="recap-stage__scroll">
        <div class="recap-stage__content">
          <div class="text-center">
            <SectionHeader :id="titleId" tag="h2" size="display" data-slot="title">{{ t('recap.title') }}</SectionHeader>
            <p class="mt-2 text-base text-toned" data-testid="recap-summary">{{ summary }}</p>
          </div>
          <div v-if="snapshot">
            <!-- Phones: one deck at a time. Nothing open: only the done deck, no switcher -->
            <div v-if="!isDesktop && snapshot.undone.length > 0" ref="switcherWrap" class="mb-4 flex justify-center">
              <UTabs
                :model-value="shownKind"
                :items="switcherOptions"
                :content="false"
                variant="pill"
                data-testid="recap-switcher"
                @update:model-value="pickedKind = $event === 'done' ? 'done' : 'undone'"
              />
            </div>

            <!-- Board order: Offen left, Erledigt right -->
            <div class="flex w-full flex-col items-center gap-8 md:flex-row md:items-start md:justify-center md:gap-12">
              <RecapDeck
                v-if="snapshot.undone.length > 0 && (isDesktop || shownKind === 'undone')"
                kind="undone"
                :tasks="snapshot.undone"
                :hide-heading="!isDesktop"
              />
              <RecapDeck
                v-if="isDesktop || shownKind === 'done'"
                kind="done"
                :tasks="snapshot.done"
                :hide-heading="!isDesktop && snapshot.undone.length > 0"
              />
            </div>
          </div>
          <!-- The only sheet (#428): the two ways out; stacked when narrow, in a column the primary button is on top -->
          <div class="recap-stage__controls @container" data-testid="recap-controls">
            <div class="flex flex-col-reverse gap-2 @md:flex-row @md:items-center @md:justify-end">
              <UButton
                color="neutral"
                variant="ghost"
                class="w-full justify-center @md:w-auto"
                data-testid="recap-continue"
                @click="leaveToToday"
              >
                {{ t('recap.continue') }}
              </UButton>
              <UButton
                color="primary"
                :trailing-icon="ICONS.goOn"
                class="w-full justify-center @md:w-auto"
                data-recap-primary
                data-testid="recap-plan"
                @click="leaveToPlan"
              >
                {{ t('recap.plan') }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import RecapDeck from '~/components/recap/RecapDeck.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { navigateTo } from 'nuxt/app'
import { useNewDayRecap } from '~/composables/useNewDayRecap'
import { useNewDay } from '~/composables/useNewDay'
import { useBoardPlace } from '~/composables/useBoardPlace'
import { armLift, boardPlaceLocation } from '~/lib/boardPlace'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { useIsDesktop } from '~/composables/useIsDesktop'
import { dayMonthName } from '~/utils/recapDay'
import { weekdayName } from '~/utils/doneDayLabel'

defineOptions({ name: 'NewDayRecap' })

const { t } = useI18n()
const { locale } = useLocaleFormat()
const { isOpen, snapshot, leave, finishLeave } = useNewDayRecap()
// Resolved in setup: the fresh start needs the Nuxt-bound move path
const { freshStart } = useNewDay()
const { isAll } = useBoardPlace()

/** Phone switcher: the user's pick; with nothing open the done deck is the only one. Reset on every open. */
const pickedKind = ref<'undone' | 'done'>('undone')
// UTabs puts attrs on its root div, not on the role="tablist" element, so the name is set on the list itself.
const switcherWrap = ref<HTMLElement | null>(null)
watchEffect(() => {
  const label = t('recap.switcher.label')
  switcherWrap.value?.querySelector('[role="tablist"]')?.setAttribute('aria-label', label)
}, { flush: 'post' })

const shownKind = computed(() => (snapshot.value && snapshot.value.undone.length === 0 ? 'done' : pickedKind.value))
// The 44 px phone hit area rides on each item's own `ui` (a part placement, not a call-site :ui override).
const switcherTrigger = { trigger: 'touch-target px-4' }
const switcherOptions = computed(() => [
  { value: 'undone' as const, label: t('recap.deck.undone', { n: snapshot.value?.undone.length ?? 0 }), ui: switcherTrigger },
  { value: 'done' as const, label: t('recap.deck.done', { n: snapshot.value?.done.length ?? 0 }), ui: switcherTrigger },
])

const summary = computed(() => {
  const current = snapshot.value
  if (!current) return ''
  const { kind, date } = current.when
  const when = kind === 'weekday'
    ? t('recap.when.weekday', { weekday: weekdayName(date, locale.value) })
    : kind === 'date'
      ? t('recap.when.date', { date: dayMonthName(date, locale.value) })
      : t(`recap.when.${kind}`)
  const done = current.done.length
  const total = done + current.undone.length
  return done === total ? t('recap.summary.all', { when }) : t('recap.summary.partial', { when, n: done, m: total })
})

/**
 * Focus starts on "Tag neu planen". The stage may not be in the DOM yet: opened as the page mounts (#427) it is teleported
 * only once the host is there, a few frames after this runs, so it looks again on each frame (up to a second).
 */
function focusPrimary(framesLeft = 60) {
  const primary = document.querySelector<HTMLElement>('[data-recap-primary]')
  if (primary) primary.focus({ preventScroll: true })
  else if (framesLeft > 0 && isOpen.value) requestAnimationFrame(() => focusPrimary(framesLeft - 1))
}

const titleId = useId()
const isDesktop = useIsDesktop()
const photoLoaded = ref(false)
/** The curtain is running: `leave()` already closed the recap, the stage stays until the photo is off. */
const closing = ref(false)
/** "Tag neu planen" waits for the board to stand on "Alle" before the curtain starts (#490) */
const planning = ref(false)
const shown = computed(() => (isOpen.value || closing.value) && !!snapshot.value)
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

/** Focus goes back to the board only if it was on the stage (or nowhere); a sheet or control the user opened meanwhile keeps it. */
function finishCurtain() {
  const active = document.activeElement
  const stage = document.querySelector('[data-testid="new-day-recap"]')
  const keep = active && active !== document.body && !stage?.contains(active)
  finishLeave({ restoreFocus: !keep })
}

/**
 * "Tag neu planen" (#356, #387, #428, #490): the board goes to "Alle" first, at once and without a move (the stage covers it, the
 * board's `lift` pace snaps), so the curtain lifts straight onto the planning view: no Heute frame, no second slide. Only then the
 * recap is left with yesterday's done tasks archived and the day starts fresh: yesterday's unfinished cards leave the board for
 * "Meine Aufgaben". The recap's own decks are a snapshot and do not change under the curtain.
 */
async function leaveToPlan() {
  if (closing.value || planning.value || !isOpen.value) return
  // The curtain lifts over 1.4 s, the app bar's chip travels on the same time (#433); the board itself does not move (#490). Not under
  // reduced motion (already on "Alle": no move at all, so the curtain keeps its 700 ms)
  if (!isAll.value && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    armLift()
    document.querySelector<HTMLElement>('[data-testid="new-day-recap"]')?.setAttribute('data-pace', 'lift')
  }
  // The curtain waits for the route: a second click or Escape meanwhile does nothing
  planning.value = true
  try {
    await navigateTo(boardPlaceLocation('all'))
  }
  finally {
    planning.value = false
  }
  leaveOnce({ archive: true })
  // Left (not: nothing to leave): the user's click is the fresh start
  if (!isOpen.value) freshStart()
}

/** "Überspringen und Board anzeigen" (#356, #387, #428): the board as it is, nothing moves or is archived; from "Alle" that is a move to Heute. */
function leaveToToday() {
  if (closing.value || planning.value || !isOpen.value) return
  if (isAll.value) void navigateTo(boardPlaceLocation('today'))
  leaveOnce()
}

/** Both buttons and Escape: close the recap at once (marker, live board; the archive only for the planning), then let the curtain play. Not repeatable. */
function leaveOnce(options: { archive?: boolean } = {}) {
  if (closing.value || !isOpen.value) return
  const stage = document.querySelector<HTMLElement>('[data-testid="new-day-recap"]')
  leave(options)
  if (isOpen.value) return // nothing to leave (no snapshot)
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

onBeforeUnmount(() => {
  clearTimeout(curtainTimer)
  if (closing.value) finishCurtain()
  markStage(false)
})

// `immediate`: coming back from settings remounts the stage with `isOpen` already true
watch(isOpen, async (open) => {
  if (!open || typeof window === 'undefined') return
  pickedKind.value = 'undone'
  await nextTick()
  requestAnimationFrame(() => focusPrimary())
}, { immediate: true })
</script>
