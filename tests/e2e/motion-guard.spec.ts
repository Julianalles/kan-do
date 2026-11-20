import { test, expect, type Page } from '@playwright/test'
import { completeNotionWizard } from './helpers/notionWizard'
import { closeMore, openMore, openSettings } from './helpers/appNav'
import { seedLocalBoard } from './helpers/seed'
import { expectInstant, expectNoJumps, startAnimationLog, startFrames, type AllowedJump } from './helpers/frameSteps'

/**
 * Guard (kd#600, motion-17): nothing jumps during a transition, and reduced motion is instant.
 *
 * Every flow is walked twice. With motion on, a per-frame sampler of every box fails a box that moves more than 140 px in one
 * frame or 8+ px in one or two frames (a guided motion comes in 9 or more frames, the defects of the sweep in one or two).
 * With `reducedMotion: 'reduce'`, no animation or transition longer than 1 ms may run, but the named progress indicators.
 * A place whose fix is still open sits on the allow list of its flow with the issue number; delete the line when the fix
 * merges (the guard does not complain about an entry that matched nothing, so look at them when you touch a fix).
 *
 * Trial status: see the PR of kd#600; whether this gates in CI or only reports is decided by `--repeat-each=20 --retries=0`.
 */

type Flow = { name: string, url: string, seed?: 'board' | 'none', run: (page: Page) => Promise<void>, jumps?: AllowedJump[], animations?: AllowedJump[] }

/** Allow lists name the boxes seen jumping in a strict run, never every box. The step swap and the setup's height: motion-4 / #607 (setup steps), motion-9 / #610 (disclosures). The chip row of #608 never moved in these flows. */
const SETUP_STEPS: AllowedJump = { match: /^div#__nuxt|^div#teleports|^div$|welcome-root|setup-back|Status\d|Aufgewendete Zeit|Erledigungsdatum/, issue: '#607', why: 'the setup steps still jump in height and place (motion-4)' }
const DISCLOSURES: AllowedJump = { match: /task-metadata/, issue: '#610', why: 'a disclosure opens in one step (motion-9)' }

/** In-app navigation: the sampler lives in one document, so a flow never reloads the page. */
const push = (page: Page, path: string) => page.evaluate(path => (window as unknown as { useNuxtApp: () => { $router: { push: (p: string) => Promise<unknown> } } }).useNuxtApp().$router.push(path), path)

/** `MOTION_GUARD_STRICT=1` ignores every allow list: the way to see what is still open. */
const STRICT = process.env.MOTION_GUARD_STRICT === '1'

const FLOWS: Flow[] = [
  {
    name: 'welcome: start -> samples -> back, then the Notion steps',
    seed: 'none',
    url: '/welcome',
    run: async (page) => {
      await page.getByTestId('welcome-choice-samples').click()
      await expect(page.getByTestId('samples-setup-flow')).toBeVisible()
      await page.getByTestId('setup-back').click()
      await expect(page.getByTestId('welcome-choice-samples')).toBeVisible()
      await page.getByRole('button', { name: 'Jetzt starten' }).click()
      await page.getByRole('checkbox', { name: 'Notion' }).click()
      await page.getByRole('button', { name: 'Mit Notion einrichten' }).click()
      await completeNotionWizard(page)
    },
    jumps: [SETUP_STEPS],
  },
  {
    name: 'Mehr panel: open and close',
    url: '/tasks',
    run: async (page) => {
      await openMore(page)
      await closeMore(page)
      await openMore(page)
      await closeMore(page)
    },
  },
  {
    name: 'page changes: Heute -> Einstellungen -> Themen -> Einstellungen -> Heute',
    url: '/tasks',
    run: async (page) => {
      await openSettings(page)
      await expect(page).toHaveURL(/\/settings/)
      await push(page, '/settings/topics')
      await expect(page).toHaveURL(/\/settings\/topics/)
      await push(page, '/settings')
      await expect(page).toHaveURL(/\/settings(\?|$)/)
      await push(page, '/tasks')
      await expect(page).toHaveURL(/\/tasks/)
    },
  },
  {
    name: 'task sheet: opened by route, Metadaten open and closed',
    url: '/tasks',
    run: async (page) => {
      await push(page, '/tasks/seed-open-1')
      const meta = page.getByRole('button', { name: /Metadaten/i })
      await expect(meta).toBeVisible()
      await meta.click()
      await meta.click()
    },
    jumps: [DISCLOSURES],
  },
  {
    name: 'delete from the board and undo',
    url: '/tasks',
    run: async (page) => {
      const card = page.locator('#column-open-list .task-wrapper .task').first()
      await expect(card).toBeVisible()
      await card.click({ button: 'right' })
      await page.getByRole('menuitem', { name: /Löschen/ }).first().click()
      const gap = page.locator('#column-open-list .task-gap')
      await expect(gap).toBeVisible()
      await gap.getByRole('button', { name: /Rückgängig/ }).click()
      await expect(gap).toHaveCount(0)
    },
  },
]

for (const flow of FLOWS) {
  test.describe(flow.name, () => {
    test.beforeEach(async ({ context }) => {
      if (flow.seed !== 'none') await seedLocalBoard(context)
    })

    test('nothing jumps (motion on)', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.goto(flow.url)
      await page.locator('main, .setup-body').first().waitFor()
      const frames = await startFrames(page)
      await flow.run(page)
      await page.waitForTimeout(400) // the motion under test lasts up to 300 ms: let it end inside the sample
      const report = await frames.stop()
      expect(report.measured, 'the sampler saw no frames').toBeGreaterThan(5)
      expectNoJumps(report, STRICT ? [] : flow.jumps)
    })

    test('reduced motion is instant', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(flow.url)
      await page.locator('main, .setup-body').first().waitFor()
      const log = await startAnimationLog(page)
      await flow.run(page)
      await page.waitForTimeout(400)
      const found = await log.stop()
      expectInstant(found, STRICT ? [] : flow.animations)
    })
  })
}

/**
 * One way to change the place (#601, DESIGN.md "Motion"): every pair of places but Heute and Alle (which slide inside the
 * mounted board) runs the page fade, and the leaving page is out of the flow, so the entering page's first box is at its
 * final y from the first frame. Desktop-only routes (`/settings/updates`) redirect on the web and are left out.
 */
test.describe('place change: one fade on every pair', () => {
  const PLACES = ['/tasks', '/all', '/statistics', '/settings', '/trash', '/settings/topics']
  const pairs = PLACES.flatMap(from => PLACES.filter(to => to !== from).map(to => [from, to] as const))
    .filter(([from, to]) => !(from === '/tasks' && to === '/all') && !(from === '/all' && to === '/tasks'))

  test('every pair fades in 200 ms and nothing is stacked below the fold', async ({ page, context }) => {
    test.setTimeout(120_000)
    await seedLocalBoard(context)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/tasks')
    await page.locator('main').first().waitFor()
    const probe = (to: string) => page.evaluate(async (to) => {
      const router = (window as unknown as { useNuxtApp: () => { $router: { push: (p: string) => Promise<unknown> } } }).useNuxtApp().$router
      const seen = new Set<string>()
      const durations = new Set<number>()
      let leaverInFlow = false
      let stop = false
      const tick = () => {
        for (const a of document.getAnimations()) {
          const el = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null
          if (el && /\bpage-(enter|leave)-active\b/.test(el.className)) {
            seen.add(/page-leave/.test(el.className) ? 'leave' : 'enter')
            durations.add(a.effect!.getTiming().duration as number)
            if (/page-leave-active/.test(el.className) && getComputedStyle(el).position !== 'absolute') leaverInFlow = true
          }
        }
        if (!stop) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      await router.push(to)
      await new Promise(resolve => setTimeout(resolve, 450))
      stop = true
      return { seen: [...seen].sort(), durations: [...durations], leaverInFlow }
    }, to)
    const failures: string[] = []
    for (const [from, to] of pairs) {
      await probe(from)
      const r = await probe(to)
      if (r.seen.join() !== 'enter,leave' || r.durations.some(d => d !== 200) || r.leaverInFlow) failures.push(`${from} -> ${to}: ${JSON.stringify(r)}`)
    }
    expect(failures, 'pairs without the 200 ms fade, or with the leaving page in the flow').toEqual([])
  })
})
