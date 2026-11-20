import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { completeNotionWizard } from './helpers/notionWizard'
import { closeMore, openMore, openSettings } from './helpers/appNav'
import { atDaysAgo, SEED_TASKS, seedLocalBoard } from './helpers/seed'
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

type Flow = { name: string, url: string, seed?: 'board' | 'none', prepare?: (context: BrowserContext) => Promise<void>, before?: (page: Page) => Promise<void>, viewport?: { width: number, height: number }, run: (page: Page) => Promise<void>, jumps?: AllowedJump[], animations?: AllowedJump[] }

/** Allow lists name the boxes seen jumping in a strict run, never every box. The setup steps' broad `#607` entry (motion-4) is gone (#652): both setup flows run on the shell, whose pane eases its height in 300 ms. What a strict run still names is below, each with its own cause. Every place that opens or re-lays in one step has left the list (#610 blocks that open in place, #642 topic focus). */
/** A person reads a setup step before pressing Weiter: longer than the pane's 300 ms height motion. */
const READS_A_STEP_MS = 450
/** The back button's label changes between the first step ("Zurück zu Einstellungen", "Zurück zur Auswahl") and the later ones ("Zurück"): its box changes width in one frame, a label swap and not a move. */
const SETUP_BACK_LABEL: AllowedJump = { match: /setup-back/, issue: '#652', why: 'the label of the back button changes with the step, so its width does (not a move)' }
/** The Notion mapping step lays its rows out once the schema has been read and auto-mapped, and the rows below the new ones move 241 px in one frame (inside the pane, whose own height eases). */
const MAPPER_ROWS: AllowedJump = { match: /Aufgewendete Zeit|Erledigungsdatum/, issue: '#667', why: 'the mapping step\'s rows re-lay in one frame when the auto-mapping fills them in (PropertyMapper)' }
/** The welcome page ends the flow: the page box changes height by 21 px in one frame at the done beat. */
const WELCOME_DONE_BEAT: AllowedJump = { match: /^div#__nuxt|^div#teleports|^div$|welcome-root/, issue: '#668', why: 'the done beat changes the welcome page height by 21 px in one frame' }
const SETUP_PAGE_SCROLL: AllowedJump = { match: /flow-root|brand-flight/, issue: '#649', why: 'the pane has no scroll area of its own now, so a tall step makes the page scroll; when the done beat shortens the page the sampler (page y = rect + scrollY) reads the scroll reset as a jump of the pane block and of the fixed brand flight (both glide on screen)' }

/** The sheet's own opening moves its last line (Metadaten, the actions) 174 px in one frame: found while the #610 allow entry left (#659). The disclosures themselves are guarded strictly in their own flow. */
const SHEET_OPENS: AllowedJump = { match: /task-metadata/, issue: '#659', why: 'the sheet\'s last line arrives in one step when the sheet opens (not the disclosure)' }
/** The "Wartet" heading changes its width by 18 px in one frame when its column empties (`.waiting-header.empty`): found in the #642 flow (#660). */
const WARTET_HEADING: AllowedJump = { match: /^h2\.font-display "Wartet"/, issue: '#660', why: 'the heading of an emptied Wartet column changes width in one frame (`.waiting-header.empty`)' }

/** A status change in the open sheet moves the task's card to another column behind the sheet in one frame (page boxes change height): found in the #610 flow (#661). The sheet's own rows are guarded. */
const CARD_MOVES_BEHIND_SHEET: AllowedJump = { match: /^div#__nuxt|^div#teleports|^div "Erledigt|dnd-kit-announcement/, issue: '#661', why: 'the board behind the sheet re-lays when the card changes column' }

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
      await completeNotionWizard(page, undefined, { pauseMs: READS_A_STEP_MS })
    },
    jumps: [SETUP_PAGE_SCROLL, SETUP_BACK_LABEL, MAPPER_ROWS, WELCOME_DONE_BEAT],
  },
  {
    name: 'settings: the Notion setup stage from the sources tab to the connection (#652)',
    url: '/settings?tab=sources',
    viewport: { width: 1280, height: 1500 }, // a driver that scrolls its Weiter button into view would be read as a jump of the fixed bar
    run: async (page) => {
      await page.getByTestId('source-connect-notion').click()
      await expect(page.getByTestId('notion-setup-stage')).toBeVisible()
      await completeNotionWizard(page, undefined, { pauseMs: READS_A_STEP_MS })
      await expect(page.getByTestId('source-row-notion')).toBeVisible()
    },
    jumps: [SETUP_PAGE_SCROLL, SETUP_BACK_LABEL, MAPPER_ROWS],
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
    name: 'task sheet: opened by route',
    url: '/tasks',
    run: async (page) => {
      await push(page, '/tasks/seed-open-1')
      await expect(page.getByRole('button', { name: /Metadaten/i })).toBeVisible()
      await page.waitForTimeout(600)
    },
    jumps: [SHEET_OPENS],
  },
  {
    name: 'task sheet: Metadaten open and closed (#610)',
    url: '/tasks',
    before: async (page) => {
      await push(page, '/tasks/seed-open-1')
      await expect(page.getByRole('button', { name: /Metadaten/i })).toBeVisible()
      await page.waitForTimeout(1200) // a person opens a fold after the sheet has arrived
    },
    run: async (page) => {
      const meta = page.getByRole('button', { name: /Metadaten/i })
      await meta.click()
      await page.waitForTimeout(450)
      await meta.click()
    },
  },
  {
    name: 'topic focus: open the chip row, pick a topic, end the focus (#608, #642)',
    url: '/tasks',
    run: async (page) => {
      await page.getByTestId('focus-trigger').click()
      await expect(page.getByTestId('focus-chips')).toBeVisible()
      await page.waitForTimeout(300) // a person picks after the row has grown, not mid-growth
      await page.getByTestId('focus-chip').first().click()
      await expect(page.getByTestId('focus-pill')).toBeVisible()
      await page.waitForTimeout(300)
      await page.getByTestId('focus-end').click()
      await expect(page.getByTestId('focus-bar')).toHaveCount(0)
    },
    jumps: [WARTET_HEADING],
  },
  {
    name: 'Gestern erledigt: open and close the list (#610)',
    seed: 'none',
    url: '/tasks',
    prepare: ctx => seedLocalBoard(ctx, [...SEED_TASKS, { id: 'done-yesterday', title: 'Rechnung ablegen', status: 3, priority: 2, timeSpentSeconds: 600, timeBoxSeconds: null, custom: {}, completedAt: atDaysAgo(1, 10) }]),
    run: async (page) => {
      const toggle = page.getByTestId('yesterday-toggle')
      await expect(toggle).toBeVisible()
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await page.waitForTimeout(350)
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    },
  },
  {
    name: 'Statistik: open a tile, switch to another, open the rhythm tile, close (#610)',
    seed: 'none',
    viewport: { width: 1280, height: 2000 }, // a driver that scrolls its target into view would be read as a jump of the fixed bar; taller than the page with every tile open (1808 px), so the root's height never clamps to the viewport (a glide's last 17 px would read as a 2-frame jump of the root, #666)
    url: '/statistics',
    prepare: async (ctx) => {
      await seedLocalBoard(ctx)
      await ctx.addInitScript(() => {
        const at = (ago: number, h: number, m: number) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - ago, h, m)
        const completionRecords = Array.from({ length: 24 }, (_, i) => ({
          taskId: `rec-${i}`,
          title: `Aufgabe ${i}`,
          completedAt: at(1 + (i % 26), 10, i % 50).toISOString(),
          timeBoxSeconds: 1800,
          actualTimeSpentSeconds: i % 2 ? 2700 : 1800,
          estimationAccuracy: i % 2 ? 150 : 100,
          topic: i % 3 ? 'Haus' : 'Garten',
          topicColorCode: null,
          activity: null,
          isUnplanned: false,
        }))
        const workSessions = Array.from({ length: 10 }, (_, i) => ({ start: at(1 + i, 9, 0).getTime(), end: at(1 + i, 12, 0).getTime() }))
        localStorage.setItem('taskStatistics', JSON.stringify({ completionRecords, workSessions }))
      })
    },
    run: async (page) => {
      const toggle = (n: number) => page.getByTestId(`stats-tile-${n}-toggle`)
      await toggle(2).click()
      await expect(page.getByTestId('stats-tile-2-detail')).toBeVisible()
      await page.waitForTimeout(350)
      await toggle(3).click()
      await expect(page.getByTestId('stats-tile-3-detail')).toBeVisible()
      await page.waitForTimeout(350)
      await toggle(3).click()
      await page.waitForTimeout(350)
      await toggle(5).click()
      await page.waitForTimeout(350)
      await toggle(5).click()
    },
  },
  {
    name: 'topic editor: open a row, switch to another, close (#610)',
    url: '/settings/topics',
    viewport: { width: 1280, height: 1500 },
    run: async (page) => {
      const rows = page.getByTestId('topics-row-button')
      await expect(rows.first()).toBeVisible()
      await rows.first().click()
      await expect(rows.first()).toHaveAttribute('aria-expanded', 'true')
      await page.waitForTimeout(350)
      await rows.nth(1).click()
      await page.waitForTimeout(350)
      await rows.nth(1).click()
    },
  },
  {
    name: 'new card: the title step to the question steps and back (#610)',
    url: '/tasks',
    before: async (page) => {
      await page.locator('#column-open').getByRole('button', { name: 'Aufgabe hinzufügen' }).click()
      const title = page.getByTestId('new-card-title')
      await expect(title).toBeFocused()
      await title.fill('Rechnung schreiben')
      await page.waitForTimeout(500) // the slot opens first (the add slot's own motion)
    },
    run: async (page) => {
      await page.keyboard.press('Enter')
      const step = page.getByTestId('new-card-step')
      await expect(step).toBeVisible()
      await page.waitForTimeout(450)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('new-card-title')).toBeVisible()
      await page.waitForTimeout(450)
    },
  },
  {
    name: 'task sheet: change the status while it is open (#610)',
    url: '/tasks',
    before: async (page) => {
      await push(page, '/tasks/seed-open-1')
      await expect(page.getByTestId('task-status-select')).toBeVisible()
      await page.waitForTimeout(1200) // the sheet's own opening first
    },
    run: async (page) => {
      const status = page.getByTestId('task-status-select')
      await status.click()
      await page.getByRole('option', { name: 'Wartet', exact: true }).click()
      await page.waitForTimeout(450)
      await status.click()
      await page.getByRole('option', { name: 'Erledigt', exact: true }).click()
      await page.waitForTimeout(450)
      await status.click()
      await page.getByRole('option', { name: 'Offen', exact: true }).click()
    },
    jumps: [CARD_MOVES_BEHIND_SHEET],
  },
  {
    name: 'Karten stapeln on, another group-by, off (#610)',
    url: '/tasks',
    run: async (page) => {
      const panel = await openMore(page)
      await panel.getByTestId('more-stack').click()
      await page.waitForTimeout(400)
      await panel.getByTestId('more-group-by').getByRole('button').nth(1).click()
      await page.waitForTimeout(400)
      await panel.getByTestId('more-stack').click()
      await page.waitForTimeout(400)
      await closeMore(page)
    },
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
      await flow.prepare?.(context)
    })

    test('nothing jumps (motion on)', async ({ page }) => {
      if (flow.viewport) await page.setViewportSize(flow.viewport)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.goto(flow.url)
      await page.locator('main, .setup-body').first().waitFor()
      await flow.before?.(page)
      const frames = await startFrames(page)
      await flow.run(page)
      await page.waitForTimeout(400) // the motion under test lasts up to 300 ms: let it end inside the sample
      const report = await frames.stop()
      expect(report.measured, 'the sampler saw no frames').toBeGreaterThan(5)
      expectNoJumps(report, STRICT ? [] : flow.jumps)
    })

    test('reduced motion is instant', async ({ page }) => {
      if (flow.viewport) await page.setViewportSize(flow.viewport)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(flow.url)
      await page.locator('main, .setup-body').first().waitFor()
      await flow.before?.(page)
      const log = await startAnimationLog(page)
      await flow.run(page)
      await page.waitForTimeout(400)
      const found = await log.stop()
      expectInstant(found, STRICT ? [] : flow.animations)
    })
  })
}

/**
 * The sampler itself (#666): on a loaded CI runner frames are 30 to 40 ms and some are lost, and the guard failed on glides that the
 * runner showed in two frames. A snap in one frame must still be reported; a glide must not be, also when a stall eats the
 * frames in the middle of it (a main-thread block of 120 ms, as a loaded runner has).
 */
test.describe('the frame sampler', () => {
  const probe = async (page: Page, script: string) => {
    await page.goto('/tasks')
    await page.locator('main').first().waitFor()
    await page.evaluate(() => {
      for (const id of ['probe-snap', 'probe-glide', 'probe-glide-stalled']) {
        const el = document.createElement('div')
        el.id = id
        el.setAttribute('data-probe', '')
        el.style.cssText = 'position:fixed;left:0;width:40px;height:20px;background:#888;'
        el.style.top = `${{ 'probe-snap': 300, 'probe-glide': 340, 'probe-glide-stalled': 380 }[id]}px`
        document.body.appendChild(el)
      }
    })
    const frames = await startFrames(page, '[data-probe]')
    await page.evaluate(script)
    await page.waitForTimeout(700)
    return frames.stop()
  }
  const labels = (r: Awaited<ReturnType<typeof probe>>) => r.jumps.map(j => j.label).join(' | ')
  const glide = 'document.getElementById("probe-glide").animate({ transform: ["translateX(0)", "translateX(300px)"] }, { duration: 300, easing: "ease-out", fill: "forwards" });'
  const stalledGlide = 'document.getElementById("probe-glide-stalled").animate({ transform: ["translateX(0)", "translateX(300px)"] }, { duration: 300, easing: "ease-out", fill: "forwards" }); setTimeout(() => { const t = performance.now(); while (performance.now() - t < 120) { /* a stall */ } }, 90);'

  test('a box that moves 40 px in one frame is reported, a glide is not', async ({ page }) => {
    // A frame lost around the snap makes its movement "uncertain" (never judged): a loaded runner gets a few more tries
    let report = await probe(page, `setTimeout(() => { document.getElementById("probe-snap").style.left = "40px" }, 100); ${glide}`)
    for (let attempt = 1; attempt < 4 && report.skipped > 0 && !labels(report).includes('probe-snap'); attempt++) {
      report = await probe(page, `setTimeout(() => { document.getElementById("probe-snap").style.left = "40px" }, 100); ${glide}`)
    }
    expect(labels(report)).toContain('probe-snap')
    expect(labels(report)).not.toContain('probe-glide')
  })

  test('a glide with a stall in the middle is not reported', async ({ page }) => {
    const report = await probe(page, stalledGlide)
    expect(report.skipped, 'the stall was seen as dropped frames').toBeGreaterThan(0)
    expect(labels(report)).not.toContain('probe-glide-stalled')
  })
})

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

/**
 * The glide of the board (#610, #642) is script motion: a press (the start of a drag) ends it at its final state, so dnd-kit never
 * measures a card that is still travelling; a re-lay glides every card by 300 ms and not at all under reduced motion.
 */
test.describe('the board glide', () => {
  const travelling = (page: Page) => page.evaluate(() => document.getAnimations().filter((a) => {
    const frames = (a.effect as KeyframeEffect | null)?.getKeyframes() ?? []
    return frames.some(f => String((f as { transform?: string }).transform ?? '').startsWith('translate('))
  }).length)

  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
  })

  test('turning stacking on glides the cards, and a pointerdown ends the glide at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/tasks')
    const panel = await openMore(page)
    await page.waitForTimeout(400)
    const counts = await page.evaluate(async () => {
      const count = () => document.getAnimations().filter((a) => {
        const frames = (a.effect as KeyframeEffect | null)?.getKeyframes() ?? []
        return frames.some(f => String((f as { transform?: string }).transform ?? '').startsWith('translate('))
      }).length
      ;(document.querySelector('[data-testid="more-stack"]') as HTMLElement).click()
      await new Promise(resolve => setTimeout(resolve, 30))
      const during = count()
      window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      return { during, after: count() }
    })
    expect(counts.during, 'cards travel to their stacks').toBeGreaterThan(0)
    expect(counts.after, 'a press ends the glide').toBe(0)
    await expect(panel.getByTestId('more-stack')).toBeVisible()
  })

  test('reduced motion: nothing travels', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/tasks')
    const panel = await openMore(page)
    await page.waitForTimeout(400)
    await panel.getByTestId('more-stack').click()
    await expect(panel.getByTestId('more-group-by')).toBeVisible()
    expect(await travelling(page)).toBe(0)
  })
})
