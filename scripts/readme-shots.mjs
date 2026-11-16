#!/usr/bin/env node
/**
 * README screenshots (#402): `npm run readme:shots` against a running dev server (`PORT`, default 3000; or `BASE_URL`).
 *
 * Seeds the demo board (`?seed=demo`, `&backlog=1` for Planung), captures every shot headless in English at 1280x800
 * (device scale 2, the repo's Playwright chromium), frames each one as a fake macOS window (rounded corners, traffic-light
 * dots, no browser chrome, strong shadow) on an almost-white background with spacing, and writes
 *   docs/images/readme-day.png         the day sequence, captions in the image (1 first start ... 5 evening)
 *   docs/images/readme-statistics.png  the statistics page, same frame
 * Needs no manual step. Not a test: it lives outside `tests/e2e` and the pre-merge gate. Change the shots or captions in SHOTS.
 * `npm run readme:shots -- --only=plan` limits the capture to one shot key (still writes the day image from cached raws).
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
const outDir = join(root, 'docs', 'images')
const rawDir = join(root, 'node_modules', '.cache', 'readme-shots')
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7)
mkdirSync(outDir, { recursive: true })
mkdirSync(rawDir, { recursive: true })

const VIEWPORT = { width: 1280, height: 800 }
const q = '&lang=en'

/** The day sequence in README order. `title` and `text` are the captions ("1 · First start — ..."). */
const SHOTS = [
  { key: 'start', title: 'First start', text: 'pick where your tasks live, or try a sample board', url: `/welcome?seed=clear${q}`, ready: 'h1, h2' },
  {
    key: 'recap', title: 'Morning', text: 'a quick look back at yesterday before the day starts',
    url: `/tasks?seed=demo${q}`, init: markYesterday, ready: 'text=Quick look back',
  },
  { key: 'plan', title: 'Plan the day', text: 'choose from your tasks what belongs on today’s board', url: `/tasks?seed=demo&backlog=1${q}`, goto: `/all?lang=en`, ready: '[data-not-planned-id]' },
  { key: 'board', title: 'During the day', text: 'today’s tasks, with one at a time in Now', url: `/tasks?seed=demo${q}`, ready: '[data-task-id]' },
  {
    key: 'evening', title: 'Evening', text: 'close the day: what got done, time spent, what stays for tomorrow',
    url: `/tasks?seed=demo${q}`, prepare: async page => page.getByTestId('day-close-cta').click(), ready: '[data-testid="day-close-tomorrow-section"]',
  },
]
const STATS = { key: 'statistics', url: `/tasks?seed=demo${q}`, goto: '/statistics?lang=en', ready: 'main', viewport: { width: 1280, height: 1000 } }

/** The recap is due when `lastShownDay` is before today (`utils/recapDay.ts`): an init script sets it to yesterday before the page runs. */
function markYesterday(ctx) {
  return ctx.addInitScript(() => {
    const d = new Date(); d.setDate(d.getDate() - 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (!sessionStorage.getItem('shots-marked')) {
      localStorage.setItem('day-recap-store', JSON.stringify({ lastShownDay: key, archiveDone: true, lastNewDay: key }))
      sessionStorage.setItem('shots-marked', '1')
    }
  })
}

async function capture(browser, shot) {
  const ctx = await browser.newContext({ viewport: shot.viewport ?? VIEWPORT, deviceScaleFactor: 2, locale: 'en-US', colorScheme: 'light' })
  if (shot.init) await shot.init(ctx)
  const page = await ctx.newPage()
  await page.goto(base + shot.url)
  await page.waitForLoadState('networkidle')
  // The seed rewrites localStorage and reloads the page: let that settle before navigating on
  await page.waitForTimeout(2500)
  await page.waitForLoadState('networkidle')
  if (shot.goto) { await page.goto(base + shot.goto); await page.waitForLoadState('networkidle') }
  if (shot.prepare) await shot.prepare(page)
  await page.waitForSelector(shot.ready, { timeout: 20000 })
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;caret-color:transparent!important}' })
  await page.waitForTimeout(800)
  const png = await page.screenshot()
  await ctx.close()
  writeFileSync(join(rawDir, `${shot.key}.png`), png)
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const dataUri = key => `data:image/png;base64,${readFileSync(join(rawDir, `${key}.png`)).toString('base64')}`

const CSS = `
  *{box-sizing:border-box;margin:0}
  body{background:#fdfdfc;font:15px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text","Inter",sans-serif;color:#555;padding:64px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:72px 64px;width:1800px}
  .grid .cell:last-child:nth-child(odd){grid-column:1/-1;justify-self:center;width:calc(50% - 32px)}
  .win{border-radius:12px;overflow:hidden;background:#fff;
    box-shadow:0 0 0 1px rgba(0,0,0,.12),0 18px 40px -6px rgba(0,0,0,.28),0 40px 90px -10px rgba(0,0,0,.30)}
  .bar{height:34px;background:#ececec;border-bottom:1px solid rgba(0,0,0,.12);display:flex;align-items:center;gap:8px;padding:0 14px}
  .bar i{width:12px;height:12px;border-radius:50%;display:block}
  .bar i:nth-child(1){background:#ff5f57;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.2)}
  .bar i:nth-child(2){background:#febc2e;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.2)}
  .bar i:nth-child(3){background:#28c840;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.2)}
  .win img{display:block;width:100%}
  .cap{margin-top:26px;font-size:19px;padding-left:4px}
  .cap b{color:#1d1d1f;font-weight:600}
`
const win = key => `<div class="win"><div class="bar"><i></i><i></i><i></i></div><img src="${dataUri(key)}"></div>`

async function compose(browser, name, body, width) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${CSS}</style><body>${body}</body>`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(outDir, name), fullPage: true })
  await page.close()
  console.log(`wrote docs/images/${name}`)
}

const browser = await chromium.launch()
try {
  for (const shot of [...SHOTS, STATS]) {
    if (only && shot.key !== only) continue
    if (only === undefined || shot.key === only || !existsSync(join(rawDir, `${shot.key}.png`))) {
      console.log(`capture ${shot.key}`)
      await capture(browser, shot)
    }
  }
  const cells = SHOTS.map((s, i) => `<div class="cell">${win(s.key)}<p class="cap"><b>${i + 1} · ${esc(s.title)}</b> — ${esc(s.text)}</p></div>`).join('')
  await compose(browser, 'readme-day.png', `<div class="grid">${cells}</div>`, 1928)
  await compose(browser, 'readme-statistics.png', `<div style="width:1100px">${win('statistics')}</div>`, 1228)
} finally {
  await browser.close()
}
