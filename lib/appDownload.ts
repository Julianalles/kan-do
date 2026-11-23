/**
 * @module appDownload
 * @description Where the web app sends a visitor to get the desktop app (#737): the newest published GitHub release.
 * Not a direct DMG URL: asset names carry the version (`kan-do_<version>_aarch64.dmg`), so `releases/latest/download/…`
 * is not stable without a version-less alias asset (D1 on #737, `docs/release.md` "Download link"). Drafts are ignored by
 * `releases/latest`, so a half-published release never shows.
 */
export const APP_DOWNLOAD_URL = 'https://github.com/jaylouiz/kan-do/releases/latest'
