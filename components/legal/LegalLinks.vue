<!--
@component LegalLinks
@kind component
@category navigation
@description The three legal links of Kan-do (#745): Impressum, Datenschutz, Nutzungsbedingungen, as one quiet line of external links. URLs from `lib/legalLinks.ts`, in the app's language.
@usage <LegalLinks /> on the welcome start view (under the version); <LegalLinks with-affiliation /> in Einstellungen › System ("Rechtliches") and at the Notion token step
@avoid Not for a single legal link inside a sentence (the feedback notice links its page with ExternalLink directly); not a footer on every page.
@responsibility
- One `nav` landmark named "Rechtliche Hinweise", the links as a list; each opens outside the app (ExternalLink: system browser on desktop)
- 14 px links, not the 12 px of the version line: they stand in a list, not in a sentence, so WCAG 2.5.8 needs real targets; `standalone` makes each a 44 px row on a phone (#592); wraps on a narrow phone
- `with-affiliation`: the line "Notion ist eine Marke von Notion Labs, Inc. … nicht verbunden" below the links (plain-text names, never a logo)
-->
<template>
  <nav :aria-label="t('legal.label')" data-testid="legal-links">
    <ul class="flex flex-wrap gap-x-4 text-sm">
      <li v-for="link in links" :key="link.page">
        <ExternalLink :href="link.href" standalone :data-testid="`legal-link-${link.page}`">{{ link.label }}</ExternalLink>
      </li>
    </ul>
    <p v-if="withAffiliation" class="mt-2 text-sm text-muted" data-testid="legal-no-affiliation">{{ t('legal.noAffiliation') }}</p>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ExternalLink from '~/components/ui/ExternalLink.vue'
import { legalUrl, type LegalPage } from '~/lib/legalLinks'

defineOptions({ name: 'LegalLinks' })

interface Props {
  /** The trademark line for Notion and Todoist under the links (#745): the about area and the Notion token step */
  withAffiliation?: boolean
}

withDefaults(defineProps<Props>(), { withAffiliation: false })

const { t, locale } = useI18n()

const PAGES: LegalPage[] = ['impressum', 'privacy', 'terms']
const links = computed(() => PAGES.map(page => ({ page, href: legalUrl(page, locale.value), label: t(`legal.${page}`) })))
</script>
