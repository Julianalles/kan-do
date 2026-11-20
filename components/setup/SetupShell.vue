<!--
@component SetupShell
@kind compound
@category layout
@description The shell of a guided setup inside a sheet (#648, epic #607): the step rail on the left (a phone: label, n / m and a bar on top), one pane that follows its content's height in 300 ms, a footer bar with Zurück and Weiter, and the done beat that replaces all three. The flows keep their logic and fill the shell through props and the default slot.
@usage <SetupShell :steps="[{ key, label }]" :current="1" :help="text" back-label="Zurück" next-test-id="wizard-proceed" :loading="busy" :error="message" @back="goBack" @next="proceed"> step content </SetupShell>; `done` with `done-title` shows the "… ist verbunden" beat instead (role="status", focused)
@avoid Not a dialog and not a stepper for a few fields (a form in a sheet has a plain footer, `footer-actions`); it does not run a step list itself: the flow owns the step state, the answers and the primary action's meaning. No visible step heading: the rail names the step.
@responsibility
- Rail (`SetupRail`: md and up the rail with the help, which reserves four lines so the footer never moves when a step's help is shorter or longer, below md label, n / m, bar and the help (#665, up to three lines reserved)), pane and footer share the sheet's padding (the shell adds none) and one content edge; the pane never has a scroll area of its own, a long list scrolls with the page
- The pane is a labelled group (`role="group"`, named by the current step, or `pane-label`); after a step change focus moves to it (`preventScroll`), the DOM order is rail, pane, footer
- Pane height: `usePaneHeight` eases it to its content in 300 ms (`MOTION.slowMs`, `MOTION.emphasized`) when a step changes or content grows or shrinks; a step change also slides the pane 14 px sideways (forward from the right, back mirrored) and fades it in; all instant under `prefers-reduced-motion`; nothing animates on the first mount
- Footer (`footer-actions`, #611): one cluster at the right edge, Zurück soft first (`setup-back`, only with `back-label`), Weiter solid last (`next-test-id`, default `setup-next`); on a phone the two share the row (48 px) and size to their labels (`flex-auto`, so "Zurück zur Auswahl" never wraps), a lone button fills it. `loading` puts Weiter in its loading state and leaves the pane at its height
- `error`: a subtle `UAlert` at the end of the pane (`role="alert"`); `done`: the beat replaces rail, pane and footer at the height the shell had (`role="status"`, focused)
- Copy: Weiter, Zurück and the rail's labels default to the existing generic keys (`notion.modal.next`, `common.back`, `notion.modal.stepsLabel`, `notion.modal.stepDone`); a flow passes its own where the wording differs ("Zurück zur Auswahl")
- Pattern: step progress via SetupRail; footer cluster per DESIGN.md "Trigger an action" (#611); step back aligned with BackButton (arrow, label rule, test id), soft in the footer instead of ghost above the title; new shell the three setup flows adopt (slices 2, 3, 5 of #607)
-->
<template>
  <div ref="rootRef" class="setup-shell" data-testid="setup-shell">
    <div
      v-if="done"
      ref="doneRef"
      class="flex flex-col items-center justify-center gap-3 py-6 text-center outline-none"
      :style="doneHeight ? { minHeight: `${doneHeight}px` } : undefined"
      role="status"
      tabindex="-1"
      data-testid="setup-done"
    >
      <span class="flex size-16 items-center justify-center rounded-full bg-inverted">
        <UIcon name="i-ph-check-bold" class="size-8 text-inverted" aria-hidden="true" />
      </span>
      <SectionHeader tag="p" size="display">{{ doneTitle }}</SectionHeader>
      <p v-if="doneHint" class="text-body text-muted">{{ doneHint }}</p>
    </div>

    <template v-else>
      <div class="flex flex-col gap-6 md:grid md:grid-cols-[13rem_1fr] md:gap-10">
        <SetupRail
          :steps="steps"
          :current="current"
          :help="help"
          :help-lines="4"
          :label="railLabel ?? t('notion.modal.stepsLabel')"
          :done-label="t('notion.modal.stepDone')"
        />
        <div class="min-w-0">
          <div ref="paneOuter">
            <div ref="paneInner" class="flow-root">
              <div
                ref="paneRef"
                role="group"
                :aria-label="paneLabel ?? steps[current]?.label"
                tabindex="-1"
                class="outline-none"
                data-testid="setup-pane"
              >
                <slot />
                <UAlert
                  v-if="error"
                  class="mt-4"
                  role="alert"
                  color="error"
                  variant="subtle"
                  icon="i-ph-warning"
                  :description="error"
                  :data-testid="errorTestId ?? 'setup-error'"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="footer-actions mt-6" data-testid="setup-footer">
        <UButton v-if="backLabel" class="max-md:flex-auto" color="neutral" variant="soft" :icon="ICONS.stepBack" data-testid="setup-back" @click="emit('back')">
          {{ backLabel }}
        </UButton>
        <UButton class="max-md:flex-auto" color="primary" :loading="loading" :disabled="nextDisabled" :data-testid="nextTestId" @click="emit('next')">
          {{ nextLabel ?? t('notion.modal.next') }}
        </UButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ICONS } from '~/lib/icons'
import { MOTION } from '~/lib/motionTokens'
import { usePaneHeight } from '~/composables/usePaneHeight'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import SetupRail from '~/components/setup/SetupRail.vue'

defineOptions({ name: 'SetupShell' })

const props = withDefaults(defineProps<{
  steps: { key: string; label: string }[]
  /** Zero-based index of the current step */
  current: number
  /** The rail's one-line help (under the rail from md, under the progress bar below it) */
  help?: string
  /** Names the rail; defaults to "Fortschritt der Einrichtung" */
  railLabel?: string
  /** Names the pane; defaults to the current step's label */
  paneLabel?: string
  /** "Zurück" or "Zurück zur Auswahl"; without a label the flow has no way back here and no Zurück shows */
  backLabel?: string
  /** The primary button's text; defaults to "Weiter" */
  nextLabel?: string
  /** The primary button's test id (`wizard-proceed`, `reminders-proceed`) */
  nextTestId?: string
  nextDisabled?: boolean
  /** Weiter shows its loading state; the pane keeps its height */
  loading?: boolean
  /** A failure of the step: a subtle alert at the end of the pane */
  error?: string | null
  errorTestId?: string
  /** The done beat replaces rail, pane and footer */
  done?: boolean
  doneTitle?: string
  doneHint?: string
}>(), {
  help: undefined,
  railLabel: undefined,
  paneLabel: undefined,
  backLabel: undefined,
  nextLabel: undefined,
  nextTestId: 'setup-next',
  nextDisabled: false,
  loading: false,
  error: null,
  errorTestId: undefined,
  done: false,
  doneTitle: undefined,
  doneHint: undefined,
})

const emit = defineEmits<{ (e: 'back' | 'next'): void }>()

const { t } = useI18n()

const rootRef = ref<HTMLElement | null>(null)
const paneOuter = ref<HTMLElement | null>(null)
const paneInner = ref<HTMLElement | null>(null)
const paneRef = ref<HTMLElement | null>(null)
const doneRef = ref<HTMLElement | null>(null)
/** The height the shell had when the done beat took over: the beat keeps it, so the sheet does not jump */
const doneHeight = ref(0)

usePaneHeight(paneOuter, paneInner)

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// A step change: the pane fades in and slides 14 px in from the side it is reached from (DESIGN.md "Step back"); focus
// follows without scrolling, so the sheet does not jump while the pane slides
watch(() => props.current, async (next, prev) => {
  const direction = next >= prev ? 1 : -1
  await nextTick()
  const pane = paneRef.value
  if (!pane) return
  if (!reducedMotion()) {
    pane.animate(
      [{ opacity: 0, transform: `translateX(${direction * 14}px)` }, { opacity: 1, transform: 'none' }],
      { duration: MOTION.slowMs, easing: MOTION.emphasized },
    )
  }
  pane.focus({ preventScroll: true })
})

// `flush: 'pre'` reads the height before the done beat replaces the shell
watch(() => props.done, async (isDone) => {
  if (!isDone) return
  doneHeight.value = rootRef.value?.offsetHeight ?? 0
  await nextTick()
  doneRef.value?.focus({ preventScroll: true })
}, { flush: 'pre' })
</script>
