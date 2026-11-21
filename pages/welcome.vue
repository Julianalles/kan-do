<!--
@component WelcomePage
@description Willkommensseite (#294): ein Start mit einer gefüllten Schaltfläche („Loslegen“) und dem Ausprobieren mit Beispielaufgaben als leiser zweiter Weg (#236); Schritt 2 sagt „lokal ist immer dabei“ und bietet Erinnerungen (nur Mac-App, #552), Notion (und Todoist, später) als Checkliste an
@usage Einstiegspunkt für neue Nutzer unter /welcome; ein schon eingerichtetes Board wird von `middleware/welcome-guard.ts` nach /tasks (Heute) geleitet (#561), App zurücksetzen räumt zuerst und erreicht die Seite wieder
@responsibility
- Startansicht: Wortmarke „kan-do“ mit Subline (`Subline`) als Seitenkopf über dem Bogen, direkt auf dem Foto, linksbündig mit dem Inhalt des Bogens (gleiche Innenabstände; im Notion-Setup folgt der Kopf dem breiteren Bogen, beide teilen einen Spaltenrahmen); der Bogen hat die kleinere Überschrift (22 px), die Einleitung, einen zweiten Absatz „Du bist erst einmal nur neugierig? …“, „Jetzt starten“ (die einzige gefüllte Schaltfläche, The One Lamp Rule) und „Beispiel anzeigen“ (soft) ab 640 px nebeneinander, darunter gestapelt (#437)
- „Loslegen“ öffnet Schritt 2 (LocalSetupFlow, kein Dialog, #43): Erinnerungen (in der Web-Version deaktiviert „(nur in der Mac-App)“) und Notion als Checkboxen, Todoist deaktiviert „(kommt später)“; ohne Haken endet er mit Lokal als einziger Verbindung und Standard, mit Haken startet er das Erinnerungen-Setup (RemindersSetupFlow, drei Schritte Zugriff, Listen, Heute, #552) und/oder das Notion-Setup auf dieser Seite (Schienen-Führung, Schritte des WizardController). Erinnerungen allein endet mit Lokal als Standard und Erinnerungen verbunden (nie Standard); sind beide gesetzt, läuft Erinnerungen zuerst (Verbinden-Knopf „Weiter zu Notion“, Erinnerungen ist dann schon verbunden), dann Notion, und das Board öffnet gemischt mit Notion als Standard. Zurück aus einem Setup führt zu Schritt 2, die Haken bleiben
- „Beispiel anzeigen“ öffnet einen eigenen Schritt 2: er sagt, dass ein Zurücksetzen unter Einstellungen › Daten & Speicher Beispiele und Statistik entfernt; „Board ansehen“ endet wie das lokale Setup
- Der Weg zum Board ist ein Vorhang (#463): die ganze Seite (Foto, Wortmarke, Bogen) gleitet 1,3 s nach oben und blendet dabei aus, mit weichem unterem Rand (Maske), über dem schon fertigen Board (`.welcome-root`, transitions.css): das Board liegt in seinem Endlayout darunter, nichts springt danach; die fliegende Wortmarke lässt die Überschrift des Bogens kurz ausblenden (`data-brand-flying`); reduzierte Bewegung: sofort
- Startansicht und Setup tauschen als ein Block (eine Transition, Höhe per WAAPI, Breite per CSS); der Tausch gleitet seitwärts (vor: alt nach links hinaus, neu von rechts herein; zurück gespiegelt, 260 ms, #236); reduzierte Bewegung: sofort
- Fokus: nach dem Tausch auf die Überschrift des Setups, beim Zurück auf die Schaltfläche, von der man kam
- Ein ruhiges Foto (Schreibtisch mit Tasse, Notizbuch und Pflanze im Fensterlicht, kd#226; gebündelt in public/welcome,
  Quelle in CREDITS.md) füllt die Seite. Wortmarke und Subline stehen direkt darauf, auf der hellen Wand (Kontrast AA,
  DESIGN.md „The Bright Ground Rule“): am Telefon ist das Foto dafür links oben verankert, so dass der Streifen über dem Bogen nur helle
  Wand zeigt (Tasse, Tisch und Pflanze liegen hinter dem Bogen). Mittig ein heller Bogen (Oberfläche und Schatten wie ein
  Dialog) trägt Überschrift, Antworten, Hinweis und Version. Am Telefon füllt der Bogen die Breite.
- Ab 640 px hängt die Spalte an einer festen Linie über der Seitenmitte statt mittig zu stehen: ein höherer Schritt wächst nach unten, die Wortmarke bleibt beim Tausch an ihrem Platz
- Beim Abschluss fliegt die Wortmarke auf Desktop in die Wortmarke der App-Leiste (`utils/brandFlight.ts`); am Telefon und bei reduzierter Bewegung blendet nur die Seite aus
- Das Foto blendet beim Laden ein (ohne Layoutsprung); lädt es nicht, bleibt die Seite auf Papierfarbe, der Bogen unverändert
-->
<template>
  <div class="welcome-root px-safe bg-page">
  <main class="relative flex min-h-dvh flex-col justify-end overflow-clip bg-page sm:items-center sm:justify-start sm:p-6">
    <!-- Atmosphere only (alt=""): fades in once loaded, a failed load leaves the paper colour -->
    <img
      ref="photo"
      src="/welcome/desk-1672.webp"
      srcset="/welcome/desk-800.webp 800w, /welcome/desk-1672.webp 1672w"
      sizes="(min-width: 40rem) 100vw, 270vw"
      alt=""
      aria-hidden="true"
      decoding="async"
      data-testid="welcome-photo"
      class="welcome-photo pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-(--duration-curtain) motion-reduce:transition-none"
      :class="photoLoaded ? 'opacity-100' : 'opacity-0'"
      @load="photoLoaded = true"
    >
    <!-- A launch with an unreachable data folder lands here with empty stores: say so (#224). On desktop it starts
         below the bar row: the window drag strip (app.vue, #614) and the traffic lights occupy that row. -->
    <div class="top-safe-3 absolute inset-x-4 z-10 mx-auto max-w-3xl in-data-[shell=desktop]:pt-(--app-bar-offset-top)">
      <DataStorageNotice />
    </div>
    <!-- Brand block and sheet share one column: it owns the width (wider in the Notion flow), so the brand follows the
         sheet's left edge. The brand sits on the photo's bright wall, not on a plate (#437). -->
    <div
      class="welcome-column relative mt-24 w-full transition-[max-width] duration-(--duration-slow) ease-(--ease-emphasized) motion-reduce:transition-none sm:mt-0"
      :class="flow === 'notion' || flow === 'reminders' ? 'sm:max-w-3xl' : 'sm:max-w-lg'"
    >
      <header class="mb-4 px-6 sm:mb-5 sm:px-8">
        <SectionHeader ref="brand" tag="p" size="hero" data-testid="welcome-brand">{{ t('nav.brand') }}</SectionHeader>
        <Subline class="mt-2">{{ t('onboarding.page.tagline') }}</Subline>
      </header>
      <div class="welcome-sheet relative w-full rounded-t-lg bg-default px-6 pt-6 shadow-(--shadow-task) sm:rounded-lg sm:px-8 sm:pt-8">
      <!-- One Transition for the whole content: start screen and setup swap as a single block and the block's height
           follows (setup-body), so nothing animates element by element (#43) -->
      <div ref="body" class="setup-body">
        <Transition :name="`slide-${direction}`" mode="out-in" @before-leave="onBeforeLeave" @enter="onEnter" @after-enter="onAfterEnter">
          <div :key="flow ?? 'start'" class="swap-block">
            <LocalSetupFlow
              v-if="flow === 'local'"
              v-model:notion="wantNotion"
              v-model:reminders="wantReminders"
              @back="leaveFlow"
              @connect-reminders="openFlow('reminders')"
              @connect-notion="openFlow('notion')"
              @complete="handleLocalSetupComplete"
            />
            <SamplesSetupFlow
              v-else-if="flow === 'samples'"
              @back="leaveFlow"
              @complete="handleLocalSetupComplete"
            />
            <RemindersSetupFlow
              v-else-if="flow === 'reminders'"
              :also-notion="wantNotion"
              @back="leaveFlow"
              @complete="handleRemindersSetupComplete"
            />
            <NotionSetupFlow
              v-else-if="flow === 'notion'"
              @back="leaveFlow"
              @complete="handleNotionSetupComplete"
            />
            <template v-else>
        <SectionHeader tag="h1" class="text-balance">
          {{ t('onboarding.page.title') }}
        </SectionHeader>
        <p class="mt-3 text-body text-default">{{ t('onboarding.page.intro') }}</p>
        <p class="mt-3 text-body text-default">{{ t('onboarding.page.curious') }}</p>
        <!-- One filled action: the sheet's only solid green (The One Lamp Rule); the trial is a quiet second way in (#294) -->
        <div class="mt-6 flex flex-col gap-3 sm:flex-row">
          <UButton color="primary" block class="sm:flex-1" data-testid="welcome-choice-local" @click="openFlow('local')">
            {{ t('onboarding.page.start') }}
          </UButton>
          <UButton color="primary" variant="soft" block class="sm:flex-1" data-testid="welcome-choice-samples" @click="openFlow('samples')">
            {{ t('onboarding.page.samples') }}
          </UButton>
        </div>
        <p class="mt-6 text-xs text-muted">
          {{ t('onboarding.page.version') }} {{ $config.public.clientVersion }}
        </p>

            </template>
          </div>
        </Transition>
      </div>
      </div>
    </div>
  </main>
  </div>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import Subline from '~/components/ui/Subline.vue'
import { flyBrandToBar } from '~/utils/brandFlight'
import { MOTION } from '~/lib/motionTokens'
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import LocalSetupFlow from '~/components/setup/LocalSetupFlow.vue';
import SamplesSetupFlow from '~/components/setup/SamplesSetupFlow.vue';
import NotionSetupFlow from '~/components/setup/NotionSetupFlow.vue';
import RemindersSetupFlow from '~/components/setup/RemindersSetupFlow.vue';
import DataStorageNotice from '~/components/settings/DataStorageNotice.vue';
import { useIntegrationManager } from '~/composables/useIntegrationManager';
import { useFirstRunSources } from '~/composables/useFirstRunSources';
import { useErrorHandler } from '~/composables/useErrorHandler';

// No app bar here (#470): first run, developer pages and the empty redirect page
definePageMeta({ appNav: false, layout: false, middleware: 'welcome-guard' })

const { t } = useI18n();
const { fetchTasks } = useIntegrationManager();
const { beginLocalDefault, beginNotionAsDefault } = useFirstRunSources();
const { handleError } = useErrorHandler();
const photo = ref<HTMLImageElement | null>(null);
const photoLoaded = ref(false);
const brand = ref<InstanceType<typeof SectionHeader> | null>(null);
/** The brand flies to the app bar's brand as the page leaves (desktop, #437) */
const flyBrand = () => flyBrandToBar(brand.value?.$el as HTMLElement | undefined);
// A cached or early-loaded photo can finish before hydration: its load event is gone, so check once on mount
onMounted(() => {
  if (photo.value?.complete && photo.value.naturalWidth > 0) photoLoaded.value = true;
});
/** Which setup is shown in place of the start screen (#43) */
type FlowKey = 'local' | 'notion' | 'reminders' | 'samples';
const flow = ref<FlowKey | null>(null);
const lastFlow = ref<FlowKey>('local');
/** Step 2's Notion checkbox; it survives the trip into the Notion setup and back (#294) */
const wantNotion = ref(false);
/** Step 2's Erinnerungen checkbox (#552), kept the same way */
const wantReminders = ref(false);
/** Which way the step swap slides: forward into a flow, back out of it (#236) */
const direction = ref<'fwd' | 'back'>('fwd');
const body = ref<HTMLElement | null>(null);
const reducedMotion = () => import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Pin the container at its current height so the leave does not collapse it */
function onBeforeLeave() {
  const el = body.value;
  if (el && !reducedMotion()) el.style.height = `${el.offsetHeight}px`;
}
/** The new block is in (still transparent, no enter delay): ease the container to its height, then drop the pin */
function onEnter(el: Element, done: () => void) {
  const container = body.value;
  if (!container || reducedMotion()) {
    if (container) container.style.height = '';
    return done();
  }
  const from = container.offsetHeight;
  container.style.height = '';
  const to = (el as HTMLElement).offsetHeight;
  const anim = container.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: MOTION.slowMs, easing: MOTION.emphasized });
  anim.finished.then(done, done);
}
/**
 * Focus follows the swap: into the setup's heading or, on the shell (no heading, the rail names the step), its pane, or back onto the row the user came from. It runs when the height
 * animation ends (300 ms, later on a slow machine), so only while focus is still lost (the removed block's button left
 * it on the body): a user who already tabbed or clicked into the new block keeps their place (#100).
 */
function onAfterEnter(el: Element) {
  const active = document.activeElement;
  if (active && active !== document.body) return;
  if (flow.value) (el.querySelector<HTMLElement>('h2') ?? el.querySelector<HTMLElement>('[data-testid="setup-pane"]'))?.focus({ preventScroll: true });
  else el.querySelector<HTMLElement>(`[data-testid="welcome-choice-${lastFlow.value}"]`)?.focus({ preventScroll: true });
}
function openFlow(key: FlowKey) {
  direction.value = 'fwd';
  lastFlow.value = key;
  flow.value = key;
}
function leaveFlow() {
  direction.value = 'back';
  // Back from the Notion or Reminders setup lands on step 2 (its checkbox still set), every other step on the start view
  if (flow.value === 'notion' || flow.value === 'reminders') {
    lastFlow.value = 'local';
    flow.value = 'local';
    return;
  }
  flow.value = null;
}

/**
 * Wird nach erfolgreichem Local-Setup aufgerufen: Service setzen und navigieren.
 */
const handleLocalSetupComplete = async () => {
  try {
    // Reminders may already be connected (set up, then Back and unticked): it stays, beside Local
    beginLocalDefault();
    flyBrand();
    await navigateTo('/tasks');
  } catch (error) {
    handleError(error as Error, 'setup');
  }
};

/**
 * Wird nach dem Erinnerungen-Setup aufgerufen (#552): die Verbindung steht schon (der Flow hat Rollen geschrieben und
 * die erste Abfrage gemacht). Mit Notion als nächstem Schritt geht es dorthin, sonst zum Board.
 */
const handleRemindersSetupComplete = async () => {
  if (wantNotion.value) {
    openFlow('notion');
    return;
  }
  try {
    flyBrand();
    await navigateTo('/tasks');
  } catch (error) {
    handleError(error as Error, 'setup');
  }
};

/**
 * Wird nach erfolgreichem Notion-Setup aufgerufen: Service setzen, laden und navigieren.
 */
const handleNotionSetupComplete = async () => {
  try {
    // With Reminders set up first (#552) Notion joins it and the board opens mixed
    beginNotionAsDefault();
    
    // Try to fetch initial tasks, but don't block navigation if it fails
    try {
      await fetchTasks();
    } catch (fetchError) {
      // Log but continue - user can retry from tasks page
      if (import.meta.dev) {
        console.log('[WelcomePage] Initial fetch after setup failed, continuing to tasks page:', fetchError);
      }
    }

    flyBrand();
    await navigateTo('/tasks');
  } catch (error) {
    handleError(error as Error, 'notion_setup');
    
    // Navigate regardless - the service is configured
    // Navigate to tasks page even if there was an error
    await navigateTo('/tasks');
  }
};
</script>

<style>
/* Phone (below `sm`, where the sheet fills the width, kd#226, #437): the brand and subline sit directly on the photo, so the
   strip above the sheet must show bright wall only, never table, plant or book. The photo keeps its natural proportions,
   sized by the viewport height and anchored top left (the window-light wall). The table edge lies at 70 % of the photo's
   height and must fall behind the sheet, which is at least about 21rem high, so the photo is at least (100dvh - 21rem) / 0.7
   tall; mug, plant and book lie behind the sheet too. Viewport units keep the crop in proportion on short and tall phones. */
.welcome-photo {
  inset: 0 auto auto 0;
  width: auto;
  max-width: none;
  height: max(560px, calc((100dvh - 21rem) / 0.7));
  aspect-ratio: 1672 / 941;
}

/* From `sm` the photo covers the page again (the `inset-0 size-full object-cover` of the element) */
@media (--sm) {
  /* The brand stays where it is while the steps swap (UX decision #437): the column hangs from a fixed line above the
     page's middle instead of being centred, so a taller step grows downward and the brand never moves. The line sits
     18rem above the middle on tall windows (the start screen, about 26rem high, lands at the optical centre) and
     moves up by up to 3rem as the window drops under 56rem (#690): the first-run step's main button stays in view at
     1280 x 800, and the tallest Notion step (the database step) still fits a 800px-high window. */
  .welcome-column {
    margin-block-start: max(var(--welcome-column-floor, 0px), calc(50dvh - 18rem - min(3rem, max(0px, 56rem - 100dvh))));
  }
  /* Floor under the hang line on short windows: the column starts 24px (main padding) below the page top, and the
     brand must clear the desktop bar row (3.5rem: drag strip and traffic lights) and, when shown, the data-storage
     notice (absolute from 12px, or from the bar row on desktop, about 56px high). */
  [data-shell='desktop'] .welcome-column { --welcome-column-floor: 2.5rem; }
  .welcome-root:has([data-testid='data-storage-notice']) .welcome-column { --welcome-column-floor: 3.5rem; }
  [data-shell='desktop'] .welcome-root:has([data-testid='data-storage-notice']) .welcome-column { --welcome-column-floor: 7.5rem; }
  .welcome-photo {
    inset: 0;
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
  }
}

/* 12px clip margin: the Back button sits 4px outside the body and its focus ring reaches 4px beyond it (2px offset + 2px width) */
.setup-body { position: relative; overflow: clip; overflow-clip-margin: 12px; }
/* Steps read as steps in a row (#236): forward leaves to the left and the next enters from the right, back mirrors it.
   Leave `--duration-fast`, enter `--duration-slow` straight after it (no delay: a delay shows an empty sheet for a beat). Both ends rest at
   .12, not 0: out-in has one frame between leave and enter, and at 0 the sheet shows an empty block for a beat */
.slide-fwd-enter-active, .slide-back-enter-active { transition: opacity var(--duration-slow) var(--ease-emphasized), transform var(--duration-slow) var(--ease-emphasized); }
.slide-fwd-leave-active, .slide-back-leave-active { transition: opacity var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard); }
.slide-fwd-enter-from, .slide-back-leave-to { opacity: 0.12; transform: translateX(32px); }
.slide-fwd-leave-to, .slide-back-enter-from { opacity: 0.12; transform: translateX(-32px); }
@media (prefers-reduced-motion: reduce) {
  .slide-fwd-enter-from, .slide-fwd-leave-to, .slide-back-enter-from, .slide-back-leave-to { opacity: 1; transform: none; }
}
</style>
