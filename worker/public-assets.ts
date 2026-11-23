/**
 * The public brand assets of the web instance (#736, #738): the files a visitor's browser, a link-preview crawler or an
 * installer needs without the gate's cookie, and the headers they are served with. One table for both jobs, so the
 * exempt list of the gate and the content types and cache lifetimes cannot drift apart. Pure logic, testable in Node.
 *
 * Exempt means exactly these pathnames, `GET` and `HEAD` only, compared as given (the URL parser has already resolved dot
 * segments and the app routes the same pathname): no prefix, no case folding, no percent-decoding. Nothing of the app's
 * code, shell or API is on the list. `tests/config/web-launch-basics.test.ts` ties the table to `public/`, the manifest
 * and the head links.
 */

export interface PublicAsset {
  contentType: string
  cacheControl: string
}

/** The icons are not fingerprinted, so a replaced one may linger for a day. */
export const IMAGE_CACHE = 'public, max-age=86400'
/** The manifest names the app and its colours: an hour. */
export const MANIFEST_CACHE = 'public, max-age=3600'

const image = (contentType: string): PublicAsset => ({ contentType, cacheControl: IMAGE_CACHE })

export const PUBLIC_ASSETS: ReadonlyMap<string, PublicAsset> = new Map([
  ['/favicon.ico', image('image/x-icon')],
  ['/favicon.svg', image('image/svg+xml')],
  ['/apple-touch-icon.png', image('image/png')],
  ['/icon-192.png', image('image/png')],
  ['/icon-512.png', image('image/png')],
  ['/icon-maskable-192.png', image('image/png')],
  ['/icon-maskable-512.png', image('image/png')],
  ['/og-image.png', image('image/png')],
  ['/manifest.webmanifest', { contentType: 'application/manifest+json', cacheControl: MANIFEST_CACHE }],
])

export function isReadMethod(request: Request): boolean {
  return request.method === 'GET' || request.method === 'HEAD'
}

/** Is this a read of one of the listed files? */
export function isPublicAssetRequest(request: Request): boolean {
  return isReadMethod(request) && PUBLIC_ASSETS.has(new URL(request.url).pathname)
}

/**
 * Explicit content type and cache lifetime for a listed file. Only a successful answer that is not HTML gets them: a file
 * missing from the build falls through to the SPA shell, which must not be relabelled as an image.
 */
export function withAssetHeaders(request: Request, response: Response): Response {
  const asset = isReadMethod(request) ? PUBLIC_ASSETS.get(new URL(request.url).pathname) : undefined
  if (!asset || (response.status !== 200 && response.status !== 304)) return response
  if ((response.headers.get('Content-Type') ?? '').toLowerCase().startsWith('text/html')) return response
  const tagged = new Response(response.body, response) // the app's headers can be immutable
  tagged.headers.set('Content-Type', asset.contentType)
  tagged.headers.set('Cache-Control', asset.cacheControl)
  return tagged
}
