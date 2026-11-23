/**
 * @module legalLinks
 * @description The one place for kan-do's legal pages (#745): Impressum, the kan-do privacy notice and the kan-do terms of
 * use. They live on the maintainer's homepage (one Impressum for the homepage, kan-do and the GitHub repos); the app, the
 * README and the feedback form link here. Paths come from jaylouiz/jwue-homepage#33.
 *
 * Paths: final, as posted on jwue-homepage#33 (2026-11-23). Host: the homepage's workers.dev URL until its custom domain
 * arrives (homepage M3; `https://julius-wuestefeld.de` is already allowed for the desktop opener). Change host or paths
 * here only: the README repeats
 * them by hand, and the desktop opener allow list (`src-tauri/capabilities/default.json`) must cover the host
 * (`tests/config/legal-links.test.ts` checks both).
 */
export const LEGAL_HOST = 'https://www.julius-wuestefeld.workers.dev'

export type LegalPage = 'impressum' | 'privacy' | 'terms'

/** Path per page and language; the German page is the default for every other locale. */
export const LEGAL_PATHS: Record<LegalPage, { de: string, en: string }> = {
  impressum: { de: '/impressum/', en: '/en/legal-notice/' },
  privacy: { de: '/kan-do/datenschutz/', en: '/en/kan-do/privacy/' },
  terms: { de: '/kan-do/nutzungsbedingungen/', en: '/en/kan-do/terms/' },
}

/** The page's URL in the app's language (`en*` reads English, anything else German). */
export function legalUrl(page: LegalPage, locale: string): string {
  const lang = locale.toLowerCase().startsWith('en') ? 'en' : 'de'
  return `${LEGAL_HOST}${LEGAL_PATHS[page][lang]}`
}
