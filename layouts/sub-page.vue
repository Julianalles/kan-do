<!--
@component SubPageLayout
@description Shared layout for sub-pages with a scrolling header and consistent styling
@usage Apply via definePageMeta({ layout: 'sub-page' }) in pages
@responsibility
- Provide consistent page structure for sub-pages (settings, statistics, etc.), below the app bar (#470); a settings sub-page (`/settings/*`, #236) opens its header with the `BackButton` "Zurück zu Einstellungen" above the title (#263; in the column when a page has no header) that links to the tab holding it (`thirdItemOfPath`, #691), the pages the app bar leads to (Einstellungen, Papierkorb, Statistik) have none
- Stays out of the way of the phone bar: the content pads by --phone-bar-offset
- Render PageHeader with title/description from route meta (a page may override the description key through `useState('sub-page-description-key')`), except on a page with `definePageMeta({ pageHeader: false })`
  (Einstellungen, Papierkorb, Statistik; #670, #686): the app bar's pill already names it, so the title stays only as a
  screen-reader-only h1 (the page keeps its heading outline) and the content takes over the header's `pt-safe`
- Wrap content in one centred column on the app bar's axis (#673): the full container (`max-w-5xl`, 992 px of content at 1280)
  by default, a 672 px reading column (`max-w-2xl` on a div inside the padded `main`, so the content is 672 px and not less)
  on a page with `definePageMeta({ pageWidth: 'narrow' })` (Einstellungen and its sub-pages, Papierkorb). The header follows
  the same column (`PageHeader` `narrow`). The pages carry no width class of their own
- A setup stage (`/settings/notion`, `/settings/reminders`, #652) widens the column to 768 px (`max-w-3xl`, the welcome sheet's width: one sheet width for every setup flow, epic #607) while it shows: the page sets `useState('sub-page-wide')` beside `sub-page-description-key` and resets it when it leaves; the other settings pages keep 672 px
-->
<template>
  <div class="sub-page bg-page">
    <PageHeader
      v-if="showsHeader"
      :title="pageTitle"
      :description="pageDescription"
      :narrow="isNarrow"
      :wide="isWide"
    >
      <template v-if="backTo" #back>
        <BackButton :label="t('common.backToSettings')" :to="backTo" />
      </template>
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </PageHeader>
    <h1 v-else class="sr-only">{{ pageTitle }}</h1>

    <div class="px-safe" :class="{ 'pt-safe': !showsHeader }">
      <main class="mx-auto max-w-5xl px-4 py-8">
        <div data-testid="sub-page-column" :class="columnClass">
          <div v-if="backTo && !showsHeader" class="mb-4 flex">
            <BackButton :label="t('common.backToSettings')" :to="backTo" />
          </div>
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import BackButton from '~/components/ui/BackButton.vue';
import PageHeader from '~/components/ui/PageHeader.vue';
import { thirdItemOfPath } from '~/composables/useAppNav';

defineOptions({ name: 'SubPageLayout' });

const route = useRoute();
const { t } = useI18n();

/** Named by the app bar already (#670): no visible header */
const showsHeader = computed(() => route.meta.pageHeader !== false);

/** A settings sub-page leads back to the tab that holds it (#236, #691: the same link as the app bar's third segment) */
const backTo = computed(() => (route.path.startsWith('/settings/') ? thirdItemOfPath(route.path)?.to : undefined));

/** One 672 px column on the axis instead of the full container (#673) */
const isNarrow = computed(() => route.meta.pageWidth === 'narrow');

/** A setup stage is wider than a reading column (768 px, #652); the page sets this while the stage shows */
const wideOverride = useState<boolean>('sub-page-wide', () => false);
const isWide = computed(() => isNarrow.value && wideOverride.value);
const columnClass = computed(() => (isWide.value ? 'mx-auto max-w-3xl' : isNarrow.value ? 'mx-auto max-w-2xl' : undefined));

const pageTitle = computed(() => {
  const key = route.meta.titleKey as string | undefined;
  if (key) return t(key);
  return (route.meta.title as string) || t('common.settings');
});

/** A page whose subtitle depends on its state (the unconnected Reminders page) sets the key here; route meta is static */
const descriptionOverride = useState<string | null>('sub-page-description-key', () => null);

const pageDescription = computed(() => {
  const key = descriptionOverride.value ?? (route.meta.descriptionKey as string | undefined);
  if (key) return t(key);
  return (route.meta.description as string) || undefined;
});
</script>

<style scoped>
/* Fills the viewport below the desktop app bar (min-h-screen would add the bar's 3.5rem and scroll every short
   page); on a phone the bar floats at the bottom and the last content stays clear of it (both offsets: app-nav.css) */
.sub-page {
  min-height: calc(100vh - var(--app-bar-offset-top));
  min-height: calc(100dvh - var(--app-bar-offset-top));
  padding-bottom: var(--phone-bar-offset);
}
</style>
