/**
 * The link-preview tags of the gate's 401 page (#736). A crawler sends no cookie, so behind the gate it only ever sees that
 * page; these are the tags the app shell carries (`nuxt.config.ts` head meta, same values: pinned by
 * `tests/config/web-launch-basics.test.ts`). Self-contained Worker code, so the copy is duplicated rather than imported.
 */

export const SHARE_NAME = 'Kan-do'
export const SHARE_DESCRIPTION = 'Das Kanban-Board, mit dem du deine Aufgaben des Tages fokussiert erledigst.'
export const SHARE_IMAGE_PATH = '/og-image.png'
export const SHARE_IMAGE_ALT = 'Das Kan-do-Icon: eine Aufgabenkarte mit Häkchen auf einem Papierstapel'

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** The Open Graph and Twitter tags, the image URL absolute on the request's own origin. */
export function shareMeta(origin: string): string {
  const image = escapeHtml(`${origin}${SHARE_IMAGE_PATH}`)
  const tag = (attr: 'property' | 'name', key: string, content: string) => `<meta ${attr}="${key}" content="${escapeHtml(content)}">`
  return [
    tag('property', 'og:type', 'website'),
    tag('property', 'og:site_name', SHARE_NAME),
    tag('property', 'og:title', SHARE_NAME),
    tag('property', 'og:description', SHARE_DESCRIPTION),
    tag('property', 'og:locale', 'de_DE'),
    `<meta property="og:image" content="${image}">`,
    tag('property', 'og:image:width', '1200'),
    tag('property', 'og:image:height', '630'),
    tag('property', 'og:image:alt', SHARE_IMAGE_ALT),
    tag('name', 'twitter:card', 'summary_large_image'),
    tag('name', 'twitter:title', SHARE_NAME),
    tag('name', 'twitter:description', SHARE_DESCRIPTION),
    `<meta name="twitter:image" content="${image}">`,
  ].join('\n')
}
