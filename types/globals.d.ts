/**
 * Build-time constants defined in nuxt.config.ts via vite.define.
 * These are replaced with literal values at build time for tree-shaking.
 */

/** true in dev and the E2E build (`NOTION_STUB_ENABLED=true`); false in production builds */
declare const __NOTION_STUB_ALLOWED__: boolean;

/**
 * true in the public web instance's build (`npm run build:cloudflare`, #742): it offers no Notion. False in every other
 * build (desktop, dev, E2E). Read it through `isPublicCloud()` in `utils/publicCloud.ts`; tests switch it with `setPublicCloud`.
 */
declare const __PUBLIC_CLOUD__: boolean;

/**
 * true in `nuxt dev` and in builds made with KANDO_COPY_EDITOR=1 (scripts/e2e-server.mjs) and in the dev instance (#246, `isDevInstance`); false in every other
 * build, which drops the live copy editor (#59, `dev-tools/copy-editor/`) from the bundle.
 */
declare const __COPY_EDITOR__: boolean;

/**
 * The /ui manifest rows (`buildManifest()`, scripts/ui-manifest.mjs), computed by nuxt.config.ts when the dev-only pages
 * ship (#65, lib/devPages.ts) and `[]` otherwise (#117: the manifest is derived, never committed).
 */
declare const __UI_MANIFEST__: import('~/dev-tools/ui-catalog/catalogModel').ManifestRow[];
