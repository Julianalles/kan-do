<!--
@component IntroHintOverlay
@kind component
@category feedback
@description The intro hints' place (#725, base #800): one hint at a time in a sheet that floats at the bottom centre of the board page, above the phone's app bar. A hint says what the next step of the day is at the moment that step is due ("Start": drag a card to Jetzt; "Weiter": the timer runs, drag the card on; "Auswahl": stack a long Offen; "Abschluss": close the day), and goes when the user does the step or closes it.
@usage <IntroHintOverlay /> once in pages/tasks.vue, after the board. Its styles are `assets/css/intro-hint.css`. Which hint shows, the pacing and what ends it live in `useIntroHints` and `lib/introHints.ts`; the record is `settings-store.introHints`. A new hint adds its id, its moment and its copy there and a text here, never a second overlay.
@avoid Not a notice about the board's state (NewDayNote, NewDayTimeNote: they sit above the board and come first), not a toast (it has no timer and never vanishes while it is read), not a dialog or a tour step anchored at an element, and not the one-time note on "Alle" (BoardPlanNote, which #803 turns into a hint). Never two at once, never on "Alle" or under an open task sheet, never for a user who did not come through the welcome setup.
@responsibility
- One white sheet with the overlay shadow (DESIGN.md "The Sheets Cast Shadows Rule"), 16 px corners like every sheet, the tip icon in the primary (the hint's one accent, a recorded use of the green: user's direction #725, "stick out as a special sheet"), the hint's text and the links "Hinweise ausschalten" and "Schließen"; diverged from the in-column notice look on the user's direction (#725, 2026-11-24): it stands out as its own sheet, built from the same tokens
- `role="status"` on the host, which is mounted before the hint (while the user's hints are on): the text is announced politely when the hint arrives; it takes no focus and traps none
- Place: fixed at the bottom centre, 24 px above the window's edge on desktop, above the floating app bar on a phone (`--phone-bar-offset`, like the toaster); only the sheet takes pointer events, the strip beside it lets the board through. While it stands, `--intro-hint-height` on <html> holds its height and `--intro-hint-room` (intro-hint.css: height + its offset from the window's edge + a 16 px gap) is the room: a phone's column pages (ColumnDropZone, the last box of a page) and the desktop board (board.css) end above the sheet, and the desktop columns' sticky buttons rest above it (BoardColumn); the room goes as the fade-out starts, so sheet and board move together
- Layer `--z-hint`: above the board and the Jetzt focus overlay, below every sheet, dialog, menu and toast; a toast may cover it for its few seconds (accepted, #800)
- Text per width: "Start" differs: the desktop text names the drag to Jetzt, the phone text (`useIsPhone`) the hold and the drag to the right edge; the other hints have one text. "Auswahl" and "Abschluss" name "Mehr" and "Tag abschließen" through params (`nav.more`, `nav.dayClose`), so a renamed menu cannot leave the hint stale
- "Auswahl" carries one action, the soft button "Karten stapeln": it calls the Mehr panel's own action (`useBoardGrouping().setGroupingEnabled(true)`), so the two cannot differ; the hint ends through its step (stacking on), not through a second write, and focus goes to the board region as the button leaves
- Two quiet links end hints (#804, 2B): "Schließen" ends this hint, "Hinweise ausschalten" turns all hints off (`useIntroHintsSwitch().turnOff`: a toast confirms it and says where the intros can be read, Einstellungen, Board). Both are `link` buttons of 44 px on a phone; the controls sit below the text at the end of the sheet at every width (beside it, three of them squeezed the text to a narrow column), wrapping on a phone, with "Karten stapeln" first. Focus goes to the board region when the focused link leaves, for either
- It fades in and out over `--duration-base` (opacity only, none under reduced motion)
- A day is stored for the hint once it is on screen and somebody can see it (`markShown`: page visible and window focused; the day is stored when the page comes back); "Schließen" ends it and keeps the rest of the day quiet, and keyboard focus goes to the board region when the focused link leaves, never to `<body>`
-->
<template>
  <!-- The status region is there before its text (a region inserted already filled is not announced everywhere); only for a
       user whose hints are on, so nobody else gets an empty region on the page -->
  <div v-if="active" class="intro-hint" role="status" data-testid="intro-hint-host">
    <Transition name="intro-hint" @before-leave="clearRoom">
      <div
        v-if="current"
        ref="sheet"
        class="intro-hint-sheet flex flex-col rounded-lg bg-elevated p-4 pb-2 shadow-(--shadow-overlay)"
        data-testid="intro-hint"
        :data-hint="current"
      >
        <div class="flex min-w-0 flex-1 items-start gap-3">
          <UIcon :name="appConfig.ui.icons.tip" class="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <p class="min-w-0 flex-1 text-body text-default">{{ text }}</p>
        </div>
        <!-- Below the text, at the end, at every width: up to three controls would squeeze the text beside them (#801, #804) -->
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-x-2 self-end">
          <UButton
            v-if="current === 'auswahl'"
            color="neutral"
            variant="soft"
            data-testid="intro-hint-stack"
            @click="onStack"
          >
            {{ t('board.sync.stackCards') }}
          </UButton>
          <!-- The two links wrap as a unit: on a phone "Karten stapeln" has a row of its own and the links share the next -->
          <div class="flex flex-wrap items-center justify-end gap-x-2">
            <UButton color="neutral" variant="link" data-testid="intro-hint-off" @click="onTurnOff">
              {{ t('board.introHint.off') }}
            </UButton>
            <UButton color="neutral" variant="link" data-testid="intro-hint-close" @click="onClose">
              {{ t('board.introHint.close') }}
            </UButton>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppConfig } from 'nuxt/app'
import { useDocumentVisibility, useResizeObserver, useWindowFocus } from '@vueuse/core'
import { useIntroHints } from '~/composables/useIntroHints'
import { useIsPhone } from '~/composables/useIsDesktop'
import { useBoardGrouping } from '~/composables/useBoardGrouping'
import { useIntroHintsSwitch } from '~/composables/useIntroHintsSwitch'
import { focusFirstAvailable } from '~/utils/focusRecovery'
import { introHintTextKey } from '~/lib/introHints'

defineOptions({ name: 'IntroHintOverlay' })

const { t } = useI18n()
const appConfig = useAppConfig()
const { active, current, shownKey, markShown, close } = useIntroHints()
const isPhone = useIsPhone()
const { setGroupingEnabled } = useBoardGrouping()
const { turnOff } = useIntroHintsSwitch()
const sheet = ref<HTMLElement | null>(null)

const text = computed(() => {
  if (!current.value) return ''
  // The key map is shared with the help in the settings; the menu names in "Auswahl" and "Abschluss" are read from the menus
  return t(introHintTextKey(current.value, isPhone.value), { more: t('nav.more'), dayClose: t('nav.dayClose') })
})

// On screen: the day counts for this hint (once per day; the store ignores a repeat). Also when the day changes under a hint that stays up.
// Only while somebody can see it: a hidden tab or a window left in the background keeps its midnight timer running, and a
// weekend with the app open must not use up the hint's days. The day is stored when the page comes back.
const visibility = useDocumentVisibility()
const windowFocused = useWindowFocus()
const seen = computed(() => visibility.value === 'visible' && windowFocused.value)
watch([shownKey, seen], () => { if (current.value && seen.value) markShown(current.value) }, { immediate: true })

/** The sheet's height for the scroll areas it floats over; `--intro-hint-room` (intro-hint.css) adds the sheet's offset and the gap. */
const HEIGHT = '--intro-hint-height'
useResizeObserver(sheet, ([entry]) => {
  if (entry) document.documentElement.style.setProperty(HEIGHT, `${Math.ceil(entry.target.getBoundingClientRect().height)}px`)
})
function clearRoom() {
  document.documentElement.style.removeProperty(HEIGHT)
}
onBeforeUnmount(clearRoom)

/** "Karten stapeln": the same action as the Mehr panel's switch; the hint ends through its step, and the focused button leaves with it. */
function onStack() {
  const hadFocus = sheet.value?.contains(document.activeElement) ?? false
  setGroupingEnabled(true)
  if (hadFocus) focusFirstAvailable([() => document.querySelector<HTMLElement>('[data-task-sheet-return]')])
}

/** "Hinweise ausschalten": every hint goes (the host with it) and a toast says so; focus goes to the board like on "Schließen". */
function onTurnOff() {
  const hadFocus = sheet.value?.contains(document.activeElement) ?? false
  turnOff()
  if (hadFocus) focusFirstAvailable([() => document.querySelector<HTMLElement>('[data-task-sheet-return]')])
}

/** "Schließen" removes the link that holds focus: focus goes to the board region at once, never to <body> (the sheet stays in the DOM while it fades). */
function onClose() {
  const hadFocus = sheet.value?.contains(document.activeElement) ?? false
  close()
  if (hadFocus) focusFirstAvailable([() => document.querySelector<HTMLElement>('[data-task-sheet-return]')])
}
</script>

