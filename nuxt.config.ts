// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from 'nuxt/config'
import * as fs from 'fs'
import { fileURLToPath } from 'node:url'
import { isDevInstance, removeDevPages, shouldShipDevPages } from './lib/devPages'
import { buildManifest } from './scripts/ui-manifest.mjs'
import { PUBLIC_ASSETS } from './worker/public-assets'
import postcssBreakpoints, { viteBreakpointDefinitions } from './scripts/postcss-breakpoints.mjs'

// reading version to make it available in nuxt context for displaying
const packageJson = fs.readFileSync('./package.json', 'utf8')
const version = JSON.parse(packageJson).version || 0

const isDev = process.env.NODE_ENV !== 'production'
/** This checkout's own `.claude` folder as a watcher glob (see `ignore` below: root-anchored, a worktree lives inside one). */
const CLAUDE_DIR = `${fileURLToPath(new URL('./.claude', import.meta.url))}/**`

// Live copy editor (#59): in `nuxt dev`, and in the E2E build (scripts/e2e-server.mjs sets the flag so the specs can
// drive it) and in a dev instance (#246, `KANDO_DEV_INSTANCE=1`). Every other build gets `false`, which drops `dev-tools/copy-editor/` from the bundle.
const copyEditor = isDev || process.env.KANDO_COPY_EDITOR === '1' || isDevInstance(process.env)

// E2E build (#541): `scripts/e2e-server.mjs` sets this to a directory of its own, so the Playwright build never writes
// `.nuxt` (a dev server or typecheck may be using it) or `.output` (`npm run generate` for Tauri). Unset for every other command.
const e2eBuildDir = process.env.KANDO_E2E_BUILD_DIR

// The public web instance (#742, ADR 021 "Local-only"): the Cloudflare build. It offers no Notion (`__PUBLIC_CLOUD__`)
// and scans in none of these server files (globs relative to `server/`), so no code on it reads a Notion token.
const isPublicCloud = process.env.NITRO_PRESET === 'cloudflare_module'
const PUBLIC_CLOUD_IGNORED_ROUTES = ['api/notion/**', 'api/config/notion-key.ts', 'api/dev/**', 'middleware/notion-stub-failure.ts']
/** Production relay route; its host is also in the desktop CSP `connect-src` (ADR 012). */
// Keep this a quoted string literal: tests/config/tauri-csp.test.ts reads it from this source with a regex.
const FEEDBACK_RELAY_PRODUCTION_URL = 'https://kando.julius-wuestefeld.workers.dev/api/feedback'
// The public web instance (ADR 021), the relay's host. Link previews need an absolute image URL; `SITE_URL` overrides
// it for another host.
const SITE_URL = (process.env.SITE_URL || new URL(FEEDBACK_RELAY_PRODUCTION_URL).origin).replace(/\/+$/, '')
// Install and share metadata (manifest, iOS home screen, link previews): one name and one description for all of
// them, the same as `public/manifest.webmanifest` (pinned by tests/config/web-manifest.test.ts). The description is
// the welcome page's tagline (`onboarding.page.tagline`), German like the default locale.
const APP_NAME = 'Kan-do'
const APP_DESCRIPTION = 'Das Kanban-Board, mit dem du deine Aufgaben des Tages fokussiert erledigst.'
// paper-100, the canvas (`--ui-page-bg`); the app has no dark mode (`colorMode: false`), so one value
const THEME_COLOR = '#f3efe6'

// The /ui manifest (#117): derived from the doc blocks and catalog/, never committed. Only the builds that ship /ui compute it
// (`nuxi prepare`, typecheck and every production build get `[]`). A broken doc block must not stop `nuxt dev`: the unit tests report it.
function uiManifest() {
  if (!shouldShipDevPages(process.env)) return []
  try {
    return buildManifest()
  } catch (error) {
    console.warn(`[ui-manifest] /ui shows no components: ${error instanceof Error ? error.message : error}`)
    return []
  }
}

export default defineNuxtConfig({
  ...(e2eBuildDir ? { buildDir: `${e2eBuildDir}/nuxt` } : {}),

  // Dev-only pages (#65): `/ui` and `/error-test` exist only in `nuxt dev` and the E2E build (lib/devPages.ts). The
  // hook runs at build time, so a production build carries neither the routes nor the page code.
  hooks: {
    'pages:extend'(pages) {
      removeDevPages(pages, process.env)
    },
    // Nitro's default error handler logs an unhandled throw with the full URL query and the raw error (#525).
    // `server/error-handler.ts` replaces that log and wraps Nuxt's own handler: setting `nitro.errorHandler` directly
    // would make Nuxt skip it (no `/__nuxt_error` page, no `vary`), so the handler Nuxt chose is read here and handed in.
    'nitro:config'(nitroConfig) {
      if (isDev) return
      const nuxtHandler = typeof nitroConfig.errorHandler === 'string' ? nitroConfig.errorHandler : undefined
      const ours = fileURLToPath(new URL('./server/error-handler.ts', import.meta.url))
      nitroConfig.virtual = {
        ...nitroConfig.virtual,
        'kan-do:error-handler': [
          `import { createErrorHandler } from ${JSON.stringify(ours)}`,
          ...(nuxtHandler ? [`import nuxtHandler from ${JSON.stringify(nuxtHandler)}`] : []),
          `export default createErrorHandler(${nuxtHandler ? 'nuxtHandler' : ''})`,
        ].join('\n'),
      }
      nitroConfig.errorHandler = 'kan-do:error-handler'
    },
    // Closed-at-start dialogs load on first open (#288): Nuxt would still prefetch every dynamic chunk after load, which
    // fetches the code the lazy mount exists to avoid. Their chunks stay out of the prefetch and preload hints.
    'build:manifest'(manifest) {
      const lazyDialogs = /(^|\/)(CommandPalette|DayCloseStage|NewDayRecap|FeedbackDialog|ElementPickerBar|UpdateDialog|WhatsNewDialog)\.vue$/
      for (const [key, entry] of Object.entries(manifest)) {
        if (lazyDialogs.test(key) || (entry.src && lazyDialogs.test(entry.src))) {
          entry.prefetch = false
          entry.preload = false
        }
      }
    },
    // `@media (--phone)` (lib/breakpoints.ts): main.css needs the definitions before Tailwind compiles it (#70)
    'vite:extendConfig'(config, { isClient }) {
      config.plugins?.unshift(viteBreakpointDefinitions())
      // The Todoist SDK imports `undici` (Node's HTTP client, a 504 kB chunk) only behind an `isNodeEnvironment()` check, so
      // a browser or the desktop webview never reaches it (#289). The client build gets an empty module in its place; the
      // server build keeps the real package.
      if (isClient) {
        const EMPTY_UNDICI = '\0kd:empty-undici'
        config.plugins?.unshift({
          name: 'kd:empty-undici',
          enforce: 'pre',
          resolveId: id => (id === 'undici' ? EMPTY_UNDICI : null),
          load: id => (id === EMPTY_UNDICI ? 'export {}' : null),
        })
      }
    },
  },

  // Modules
  modules: [
    '@nuxt/ui',
    // zero-config animation plugin
    '@formkit/auto-animate/nuxt',
    // Motion.dev animation library
    'motion-v/nuxt',
    '@nuxt/eslint',
    '@nuxt/fonts',
    '@nuxt/icon',
    '@nuxtjs/i18n',
  ],

  // UI locale: German default + fallback, English. No route prefixes and no module-side
  // browser detection; plugins/i18n-locale.client.ts resolves the locale before first render.
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'de',
    detectBrowserLanguage: false,
    locales: [
      { code: 'de', language: 'de-DE', file: 'de.json', name: 'Deutsch' },
      { code: 'en', language: 'en-US', file: 'en.json', name: 'English' },
    ],
    vueI18n: './i18n.config.ts',
  },

  // Nuxt UI v4 options: we already configure fonts and color mode explicitly
  ui: {
    fonts: false,
    colorMode: false
  },

  // Icon configuration for reliable loading
  icon: {
    // Pre-bundle Phosphor icons to avoid async loading issues
    collections: ['ph'],
    // Use SVG mode for more reliable rendering
    mode: 'svg',
    // Client-side bundle for better reliability with SSR disabled
    clientBundle: {
      // Scan for icons used in the codebase. The default skips .ts, so icons named in composables,
      // utils and app.config.ts would be fetched from api.iconify.design at runtime, which the
      // desktop CSP blocks (ADR 012). Keep this list in step with the folders that
      // tests/config/icons-bundled.test.ts walks (the whole repo minus build, test and doc folders).
      scan: {
        globInclude: [
          '{components,composables,pages,layouts,plugins,utils,lib,integrations,store,types,middleware,app,server,i18n}/**/*.{vue,ts}',
          'app.vue',
          'app.config.ts',
        ],
      },
      // Include commonly used icons
      icons: [
        'ph:number-circle-one',
        'ph:number-circle-two',
        'ph:exclamation-mark',
        'ph:seal-warning',
        'ph:trash',
        'ph:caret-down',
        'ph:clock',
        'ph:check-circle',
        'ph:plus',
        'ph:x',
        'ph:desktop',
      ]
    }
  },

  // Global CSS
  css: ['~/assets/css/main.css'],

  devtools: {
    enabled: false,
    timeline: { enabled: false }
  },

  // App Head
  app: {
    baseURL: process.env.BASE_URL || '/',
    head: {
      title: process.env.APP_TITLE || 'kan-do',
      htmlAttrs: { lang: process.env.APP_LANG || 'de' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { key: 'description', name: 'description', content: APP_DESCRIPTION },
        { name: 'format-detection', content: 'telephone=no' },
        { name: 'theme-color', content: THEME_COLOR },
        { name: 'application-name', content: APP_NAME },
        // "Zum Home-Bildschirm" on iOS: full screen, the name under the icon, dark status bar text on the paper canvas
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: APP_NAME },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
        // Link previews (Open Graph, X/Twitter); the share image is the icon on paper, 1200 x 630
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: APP_NAME },
        { property: 'og:title', content: APP_NAME },
        { property: 'og:description', content: APP_DESCRIPTION },
        { property: 'og:locale', content: 'de_DE' },
        { property: 'og:image', content: `${SITE_URL}/og-image.png` },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:alt', content: 'Das Kan-do-Icon: eine Aufgabenkarte mit Häkchen auf einem Papierstapel' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: APP_NAME },
        { name: 'twitter:description', content: APP_DESCRIPTION },
        { name: 'twitter:image', content: `${SITE_URL}/og-image.png` }
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
        // `use-credentials`: browsers fetch a manifest without cookies by default, and the public instance's
        // token gate (ADR 021) answers a request without its cookie with 401, so the app would not be installable
        { rel: 'manifest', href: '/manifest.webmanifest', crossorigin: 'use-credentials' }
      ]
    }
  },

  // Content type and cache lifetime of the manifest and the icons (#738): one table with the Worker's (`worker/public-assets.ts`).
  // On Vercel Nitro writes them into the Build Output API config (`vercel.json` `headers` do not reach it); the Worker sets the
  // same headers itself (Workers assets' `_headers` is skipped while `run_worker_first` is on, ADR 021).
  routeRules: Object.fromEntries([...PUBLIC_ASSETS].map(([path, asset]) =>
    [path, { headers: { 'Content-Type': asset.contentType, 'Cache-Control': asset.cacheControl } }])),

  // Disable SSR for desktop app
  ssr: false,

  // Dev watcher: keep the Rust build tree and build/test artefacts out of Nuxt's file watcher (#542).
  // (Nuxt's default list already has `.output`, `.nuxt` and `**/test-results`, not these.)
  // Nuxt opens one native watcher (a file descriptor on macOS) per watched file. `src-tauri/target`
  // holds about 17,500 files, so a checkout that has built the desktop app sat at ~18,000 open
  // descriptors; at that count Nitro's `spawn` of esbuild fails with `[nitro] ERROR Error: spawn EBADF`
  // (reproduced with a spawn trace; `ulimit -n` was not the limit). `CHOKIDAR_USEPOLLING=1` hid this
  // (cd612ef0) at 127-135 % idle CPU; with these paths ignored, native watching works and idles at ~0 %.
  // If `spawn EBADF` returns, count descriptors first (`lsof -p <nuxt pid> | wc -l`) and look for a new
  // large watched folder before reaching for polling again.
  //
  // `ignore` is not watcher-only: Nuxt applies it to every path below the root, also to the files it generates and
  // scans (pages, components, auto-imports). Hence two rules: the patterns are anchored to the root (`/dist` would
  // also match `.nuxt/dist` and any nested `dist`), and the list is dev-only. The E2E build puts its own buildDir
  // into `.e2e-build/<port>/nuxt`, so ignoring `.e2e-build` there dropped the generated routes and the app rendered
  // empty (the first version of this setting did, #576). The watcher-only options do not reach Nuxt's
  // watcher: it sets its own `ignored` after spreading `watchers.chokidar` (overriding it), and the Vite and Nitro
  // watchers are separate ones.
  //
  // `/.claude` holds the agents' worktrees (`.claude/worktrees/<name>`: full copies of the repo with their own `.nuxt`
  // and `.e2e-build`, about 13,000 files with four of them): `nuxt dev` in the main checkout died with
  // `EMFILE: too many open files, watch`. Root-anchored on purpose, here and in the Nitro and Vite lists
  // (`CLAUDE_DIR`): a worktree's own path contains `.claude`, so `**/.claude/**` would ignore everything there.
  ...(isDev
    ? { ignore: ['/src-tauri', '/dist', '/.e2e-build', '/tests/e2e/playwright-report', '/.playwright-mcp', '/.claude'] }
    : {}),

  // Nitro preset: environment-first with fallbacks
  nitro: isDev
    ? {
        // watchOptions is still honoured by Nitro but missing from Nuxt 4.5's narrowed type
        watchOptions: {
          ignored: ['**/node_modules/**', '**/.git/**', '**/.output/**', '**/dist/**', '**/.e2e-build/**', CLAUDE_DIR],
        },
        // Dev-only routes of the live copy editor (#59): registered here, outside `server/api`, so no build scans them in.
        handlers: [
          { route: '/api/dev/copy/translate', method: 'post', handler: fileURLToPath(new URL('./server/copy-editor/translate.post.ts', import.meta.url)) },
          { route: '/api/dev/copy/publish', method: 'post', handler: fileURLToPath(new URL('./server/copy-editor/publish.post.ts', import.meta.url)) },
          { route: '/api/dev/copy/publish-status', method: 'post', handler: fileURLToPath(new URL('./server/copy-editor/publish-status.post.ts', import.meta.url)) },
        ],
      } as Record<string, unknown>
    : {
        // Static unless NITRO_PRESET says otherwise: the Cloudflare Worker (`build:cloudflare`, ADR 021) and the E2E server
        // build set it. (The Vercel deployment and its `vercel` preset are gone, #747.)
        preset: process.env.NITRO_PRESET || 'static',
        // Cloudflare (#502, ADR 021): the Worker is `worker/index.ts` (the gate) as wrangler.jsonc says. Under Workers
        // Builds (`WORKERS_CI=1`) Nitro would turn this on by itself, write `.output/server/wrangler.json` and redirect
        // `wrangler deploy` to it through `.wrangler/deploy/config.json`: Nitro's bare handler, no gate, would go live.
        cloudflare: { deployConfig: false },
        // Cloudflare (#504): the shell is rendered at request time, so a build step needs a copy to hash its inline scripts.
        ...(process.env.NITRO_PRESET === 'cloudflare_module' ? { prerender: { routes: ['/200.html'], crawlLinks: false } } : {}),
        // The public instance is local-only (#742, ADR 021): its build scans in no route that could receive a Notion token
        // (the proxy, its stub-failure middleware, the key probe, the dev sandbox config). The Worker answers `/api/notion/*` with 404.
        ...(isPublicCloud ? { ignore: PUBLIC_CLOUD_IGNORED_ROUTES } : {}),
        ...(e2eBuildDir ? { output: { dir: `${e2eBuildDir}/output` } } : {}),
      },


  // Local-first fonts
  fonts: {
    families: [
      {
        name: 'Figtree',
        src: '/fonts/Figtree-VariableFont_wght.woff2',
        weight: '300 900',
        style: 'normal',
        global: true
      },
      {
        name: 'Figtree',
        src: '/fonts/Figtree-Italic-VariableFont_wght.woff2',
        weight: '300 900',
        style: 'italic',
        global: true
      },
      // The display face (DESIGN.md "Type"): headings only. Bundled like Figtree, no web font request (ADR 012).
      // The file is the variable font pinned to weight 500 (the only heading weight; SOFT 0 and WONK 1 are the font's own
      // defaults), optical size and every code point kept (#287): 190 kB became 58 kB. The range stops @nuxt/fonts from adding a
      // `local(Fraunces Medium)` source, which a single weight gets and which would prefer an installed copy.
      {
        name: 'Fraunces',
        src: '/fonts/Fraunces-Variable.woff2',
        weight: '400 600',
        style: 'normal',
        global: true
      }
    ]
  },

  runtimeConfig: {
    public: {
      clientVersion: version,
      // Dev-only locale override (`KANDO_LOCALE=en npm run dev`); ignored outside import.meta.dev
      localeOverride: process.env.KANDO_LOCALE || '',
      // Feedback relay (#268): the server route that files reports privately. Dev and the E2E build post to
      // their own origin (E2E answers it with `page.route`, so no test reaches production); every other build,
      // the desktop app included, posts to the production deployment. Empty switches the relay off.
      feedbackRelayUrl: process.env.NUXT_PUBLIC_FEEDBACK_RELAY_URL
        ?? (isDev || e2eBuildDir ? '/api/feedback' : FEEDBACK_RELAY_PRODUCTION_URL),
    }
  },

  compatibilityDate: '2025-03-09',

  // Build-time constants
  vite: {
    css: {
      // `@media (--phone)` -> the query of lib/breakpoints.ts (#70)
      postcss: { plugins: [postcssBreakpoints()] },
    },
    optimizeDeps: {
      // Pre-bundle deps that Vite otherwise discovers only at runtime. On a cold dep cache
      // (fresh checkout, CI, or after a dependency change) runtime discovery triggers a
      // re-optimization and a full reload of every open page, which aborts in-flight E2E tests.
      include: [
        'pinia',
        'pinia-plugin-persistedstate',
        '@doist/todoist-api-typescript',
        '@tauri-apps/plugin-http',
        '@dnd-kit/dom',
        '@dnd-kit/vue',
        '@dnd-kit/vue/sortable',
        '@internationalized/date',
        'reka-ui',
      ],
    },
    server: {
      watch: {
        // Exclude directories that don't need hot-reload watching to reduce open file descriptors
        ignored: ['**/node_modules/**', '**/.git/**', '**/.output/**', '**/dist/**', '**/.e2e-build/**', '**/tests/e2e/snapshots/**', CLAUDE_DIR],
      },
    },
    define: {
      '__COPY_EDITOR__': copyEditor,
      '__UI_MANIFEST__': JSON.stringify(uiManifest()),
      // Allow Notion sentinel token (notion_test_stub) in dev and the E2E build (`NOTION_STUB_ENABLED`).
      // Tree-shaken to `false` in production.
      // The public web instance (#742): the Cloudflare build. Notion shows as not available there; desktop, dev, E2E keep it.
      '__PUBLIC_CLOUD__': isPublicCloud,
      '__NOTION_STUB_ALLOWED__': process.env.NOTION_STUB_ENABLED === 'true'
        || process.env.NODE_ENV !== 'production',
    },
  },
})
