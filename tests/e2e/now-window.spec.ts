import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { SEED_TASKS, seedLocalBoard, type SeedTask } from './helpers/seed'
import { emitTauriEvent, installTauriStub, stubState } from './helpers/tauriStub'
import { openSettings } from './helpers/appNav'
import { measureContrast } from './helpers/contrast'

/**
 * #383: the floating Now window. Two halves, both through the Tauri stub (the real window needs a macOS desktop,
 * `desktop-verify`): the pill window's own route `/overlay` (what Rust emits is played with `emitTauriEvent`, what the
 * pill asks for lands in the stub's `calls`), and the main window's side (the snapshot it pushes with `overlay_sync`, the
 * actions it carries out, the setting).
 */

const NOW_EVENT = 'overlay://state'
const ACTION_EVENT = 'overlay://action'

interface Snap { taskId: string; title: string; timeBoxSeconds: number | null; spentSeconds: number; at: number; running: boolean; locale: string }
const snap = (extra: Partial<Snap> = {}): Snap => ({ taskId: 'seed-1', title: 'Release notes schreiben', timeBoxSeconds: 1500, spentSeconds: 860, at: 0, running: false, locale: 'de', ...extra })

/** Opens `/overlay` as the pill window does: the stub answers `overlay_ready` with this snapshot (`at` = page load). */
async function openPill(context: BrowserContext, page: Page, snapshot: Snap | null) {
  await installTauriStub(context, {})
  await context.addInitScript((value) => {
    ;(window as unknown as { __overlaySnapshot: unknown }).__overlaySnapshot = value ? { ...value, at: value.at || Date.now() } : null
  }, snapshot)
  await page.goto('/overlay')
  // the pill listens before it reports ready, so an event played after this is never lost
  await expect.poll(async () => (await calls(page, 'overlay_ready')).length).toBe(1)
}

const calls = async (page: Page, cmd: string) => (await stubState(page)).calls.filter(c => c.cmd === cmd).map(c => c.args)
const pill = (page: Page) => page.getByTestId('now-pill')

test.describe('the pill window (/overlay)', () => {
  test('shows title, remaining time and the light; the title is private; it counts down by the wall clock', async ({ context, page }) => {
    await openPill(context, page, snap({ running: true }))
    await expect(pill(page)).toBeVisible()
    await expect(page.getByTestId('now-title')).toHaveText('Release notes schreiben')
    await expect(page.getByTestId('now-title')).toHaveAttribute('data-private', '')
    await expect(page.getByTestId('now-fill')).toBeVisible()
    const first = await page.getByTestId('now-time').innerText()
    expect(first).toMatch(/^\d+:\d{2}$/)
    await expect.poll(() => page.getByTestId('now-time').innerText(), { timeout: 5000 }).not.toBe(first)
    // it asked Rust for its state, and read no data: no data, secret or GitHub command ran in this window
    expect(await calls(page, 'overlay_ready')).toHaveLength(1)
    const cmds = (await stubState(page)).calls.map(c => c.cmd)
    expect(cmds.filter(c => /^(data_|secret_|github_)/.test(c))).toEqual([])
  })

  test('paused: the time stands still and is dimmed; resume is offered', async ({ context, page }) => {
    await openPill(context, page, snap({ running: false }))
    await expect(page.getByTestId('now-time')).toHaveText('10:40')
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('now-time')).toHaveText('10:40')
    await expect(pill(page)).toHaveClass(/is-paused/)
    await expect(page.getByTestId('now-pause')).toHaveAccessibleName('Fortsetzen')
  })

  test('the light drains with the time left, turns amber above 80 % spent and is full and amber again over the timebox', async ({ context, page }) => {
    // 860 of 1500 s spent: 43 % left, primary
    await openPill(context, page, snap({ spentSeconds: 860 }))
    const fill = page.locator('[data-testid="now-fill"]')
    const share = async () => Number(await fill.evaluate(el => (el as HTMLElement).style.getPropertyValue('--now-share')))
    expect(await share()).toBeCloseTo(640 / 1500, 3)
    await expect(pill(page)).not.toHaveClass(/is-warning/)
    // 1200 s = exactly 80 %: still primary; one second more: warning (the app's rule, `getTimeboxRingColor`)
    await emitTauriEvent(page, NOW_EVENT, snap({ spentSeconds: 1200, at: Date.now() }))
    await expect(page.getByTestId('now-time')).toHaveText('5:00')
    await expect(pill(page)).not.toHaveClass(/is-warning/)
    await emitTauriEvent(page, NOW_EVENT, snap({ spentSeconds: 1201, at: Date.now() }))
    await expect(pill(page)).toHaveClass(/is-warning/)
    expect(await share()).toBeCloseTo(299 / 1500, 3)
    await emitTauriEvent(page, NOW_EVENT, snap({ spentSeconds: 1500 + 130, at: Date.now() }))
    await expect(page.getByTestId('now-time')).toHaveText('+2:10')
    await expect(pill(page)).toHaveClass(/is-warning/)
    expect(await share()).toBe(1)
  })

  test('the light glides on a tick and jumps when the task changes or the timebox runs out (#436)', async ({ context, page }) => {
    await openPill(context, page, snap({ spentSeconds: 860 }))
    const fill = page.locator('[data-testid="now-fill"]')
    await emitTauriEvent(page, NOW_EVENT, snap({ spentSeconds: 861, at: Date.now() }))
    await expect(fill).toHaveClass(/is-gliding/)
    await emitTauriEvent(page, NOW_EVENT, snap({ taskId: 'other', title: 'Other task', spentSeconds: 100, at: Date.now() }))
    await expect(page.getByTestId('now-title')).toHaveText('Other task')
    await expect(fill).not.toHaveClass(/is-gliding/)
    await emitTauriEvent(page, NOW_EVENT, snap({ taskId: 'other', title: 'Other task', spentSeconds: 1499, at: Date.now() }))
    await emitTauriEvent(page, NOW_EVENT, snap({ taskId: 'other', title: 'Other task', spentSeconds: 1501, at: Date.now() }))
    await expect(page.getByTestId('now-time')).toHaveText('+0:01')
    await expect(fill).not.toHaveClass(/is-gliding/)
  })

  test('the light is 280 x 42 pt with a straight, soft edge that holds at any share, and only transform moves it (#703)', async ({ context, page }) => {
    await openPill(context, page, snap({ spentSeconds: 860 }))
    const box = (await pill(page).boundingBox())!
    expect([box.width, box.height]).toEqual([280, 42])
    const fill = page.getByTestId('now-fill')
    // the layer is as wide as the pill and slid left by the time gone: its right end is the visible edge, at share x width
    const edgeAt = async () => fill.evaluate(el => { const r = el.getBoundingClientRect(); return { width: r.width, right: r.right - el.parentElement!.getBoundingClientRect().left } })
    let edge = await edgeAt()
    expect(edge.width).toBeCloseTo(280, 0)
    expect(edge.right).toBeCloseTo(280 * (640 / 1500), 0)
    // a share narrower than the corner radius (21 px): still the same layer, only moved; no round cap of its own
    await emitTauriEvent(page, NOW_EVENT, snap({ spentSeconds: 1495, at: Date.now() }))
    await expect(page.getByTestId('now-time')).toHaveText('0:05')
    edge = await edgeAt()
    expect(edge.width).toBeCloseTo(280, 0)
    expect(edge.right).toBeLessThan(21)
    expect(await fill.evaluate(el => getComputedStyle(el).borderRadius)).toBe('0px')
    // the breathing band moves opacity and transform only
    const band = await page.locator('.now-edge').evaluate(el => el.getAnimations().flatMap(a => ((a.effect as KeyframeEffect).getKeyframes()).flatMap(k => Object.keys(k))).filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)))
    expect([...new Set(band)].sort()).toEqual(['opacity', 'transform'])
  })

  test('the band breathes while it runs and holds still while paused (#703)', async ({ context, page }) => {
    await openPill(context, page, snap({ running: true }))
    const state = () => page.locator('.now-edge').evaluate(el => el.getAnimations().map(a => a.playState))
    await expect.poll(state).toEqual(['running'])
    await emitTauriEvent(page, NOW_EVENT, snap({ running: false, at: Date.now() }))
    await expect(pill(page)).toHaveClass(/is-paused/)
    await expect.poll(state).toEqual(['paused'])
  })

  test('with reduced motion the band rests at mid brightness and the light does not glide (#703)', async ({ context, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openPill(context, page, snap({ running: true }))
    const edge = page.locator('.now-edge')
    await expect.poll(() => edge.evaluate(el => Number(getComputedStyle(el).opacity))).toBeCloseTo(0.7, 1)
    expect(await edge.evaluate(el => getComputedStyle(el).transform)).toBe('none')
    await emitTauriEvent(page, NOW_EVENT, snap({ spentSeconds: 861, at: Date.now() }))
    expect(await page.getByTestId('now-fill').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s')
  })

  test('a long title is cut with an ellipsis and never hides the time or the buttons, also over an hour (#703)', async ({ context, page }) => {
    await openPill(context, page, snap({ title: 'Ein sehr langer Titel einer Aufgabe, der nicht in die Pille passt', timeBoxSeconds: 5400, spentSeconds: 60, running: true }))
    await expect(page.getByTestId('now-time')).toHaveText(/^1:\d{2}:\d{2}$/)
    const title = page.getByTestId('now-title')
    expect(await title.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
    const edge = (await pill(page).boundingBox())!
    for (const id of ['now-time', 'now-pause', 'now-done']) {
      const box = (await page.getByTestId(id).boundingBox())!
      expect(box.x, id).toBeGreaterThanOrEqual(edge.x)
      expect(box.x + box.width, id).toBeLessThanOrEqual(edge.x + edge.width)
    }
    const t = (await title.boundingBox())!, time = (await page.getByTestId('now-time').boundingBox())!
    expect(t.x + t.width).toBeLessThanOrEqual(time.x + 0.5)
    for (const id of ['now-pause', 'now-done']) expect((await page.getByTestId(id).boundingBox())!.width).toBeGreaterThanOrEqual(28)
  })

  // The light is under the title and the time: text 4.5:1, glyphs 3:1 in every state, on a light and a dark stand-in backdrop, with the band at its brightest.
  // The real glass is a manual check (`desktop-verify`); the backdrop here is a mid wallpaper tone.
  for (const scheme of ['light', 'dark'] as const) {
    test(`text and glyphs keep their contrast over the light in every state, ${scheme} (#703)`, async ({ browser }) => {
      const states: Record<string, Partial<Snap>> = { running: {}, paused: { running: false }, warning: { spentSeconds: 1300 }, narrow: { spentSeconds: 1400 }, over: { spentSeconds: 1630 } }
      for (const [name, extra] of Object.entries(states)) {
        const context = await browser.newContext({ colorScheme: scheme, locale: 'de-DE' })
        const page = await context.newPage()
        await installTauriStub(context, {})
        await context.addInitScript((v) => { (window as unknown as { __overlaySnapshot: unknown }).__overlaySnapshot = { ...v, at: Date.now() } }, snap({ running: true, ...extra }))
        await page.goto('/overlay')
        await expect(pill(page)).toBeVisible()
        await page.addStyleTag({ content: `html,body{background:${scheme === 'light' ? '#cfd8e8' : '#26364f'} !important}` })
        // the band at its brightest, still
        await page.locator('.now-edge').evaluate(el => el.getAnimations().forEach((a) => { a.pause(); a.currentTime = 2400 }))
        for (const id of ['now-title', 'now-time']) {
          const { ratio } = await measureContrast(page, page.getByTestId(id))
          expect(ratio, `${scheme} ${name} ${id}`).toBeGreaterThanOrEqual(name === 'paused' && id === 'now-time' ? 3 : 4.5)
        }
        for (const id of ['now-pause', 'now-done']) {
          const { ratio } = await measureContrast(page, page.getByTestId(id).locator('svg'))
          expect(ratio, `${scheme} ${name} ${id}`).toBeGreaterThanOrEqual(3)
        }
        await context.close()
      }
    })
  }

  test('without a timebox there is no light and the time counts up', async ({ context, page }) => {
    await openPill(context, page, snap({ timeBoxSeconds: null, spentSeconds: 125, running: true }))
    await expect(page.getByTestId('now-title')).toBeVisible()
    await expect(page.getByTestId('now-fill')).toHaveCount(0)
    await expect(pill(page)).not.toHaveClass(/is-warning/)
    const first = await page.getByTestId('now-time').innerText()
    expect(first).toMatch(/^2:\d{2}$/)
    await expect.poll(() => page.getByTestId('now-time').innerText(), { timeout: 5000 }).not.toBe(first)
    await expect(page.getByTestId('now-open')).toHaveAccessibleDescription(/Bisher gearbeitet/)
  })

  test('follows the state events: a new task, none (empty), the language', async ({ context, page }) => {
    await openPill(context, page, snap())
    await emitTauriEvent(page, NOW_EVENT, snap({ taskId: 'seed-2', title: 'Rechnung schreiben', at: Date.now() }))
    await expect(page.getByTestId('now-title')).toHaveText('Rechnung schreiben')
    await emitTauriEvent(page, NOW_EVENT, snap({ locale: 'en', at: Date.now() }))
    await expect(page.getByTestId('now-open')).toHaveAccessibleName('Open Kan-do')
    await emitTauriEvent(page, NOW_EVENT, null)
    await expect(pill(page)).toHaveCount(0)
    await emitTauriEvent(page, NOW_EVENT, { not: 'a snapshot' })
    await expect(pill(page)).toHaveCount(0)
  })

  test('pause and done are always visible and inside the pill; they and a click on the body ask Rust, with the task', async ({ context, page }) => {
    await openPill(context, page, snap({ running: true }))
    // no hover needed, and nothing is cut off at the pill's edge (#436)
    const edge = (await pill(page).boundingBox())!
    for (const id of ['now-pause', 'now-done']) {
      await expect(page.getByTestId(id)).toBeVisible()
      const box = (await page.getByTestId(id).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(edge.x)
      expect(box.x + box.width).toBeLessThanOrEqual(edge.x + edge.width)
      expect(box.width).toBeGreaterThanOrEqual(24)
    }
    // title, time and both buttons share the pill's middle line (#565)
    const middle = edge.y + edge.height / 2
    for (const id of ['now-title', 'now-time', 'now-pause', 'now-done']) {
      const box = (await page.getByTestId(id).boundingBox())!
      expect(Math.abs(box.y + box.height / 2 - middle), id).toBeLessThanOrEqual(1)
    }
    await expect(page.getByTestId('now-pause')).toHaveAccessibleName('Pausieren')
    await page.getByTestId('now-pause').click()
    await page.getByTestId('now-done').click()
    await page.getByTestId('now-title').click()
    await expect.poll(async () => (await calls(page, 'overlay_action')).map(a => a.kind)).toEqual(['toggle-pause', 'done', 'open'])
    for (const call of await calls(page, 'overlay_action')) expect(call.taskId).toBe('seed-1')
  })

  test('a press that travels drags the window and does not open Kan-do; a plain click opens it', async ({ context, page }) => {
    await openPill(context, page, snap({ running: true }))
    const box = (await page.getByTestId('now-title').boundingBox())!
    const x = box.x + 20, y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 12, y + 2, { steps: 4 })
    await page.mouse.up()
    await expect.poll(async () => (await calls(page, 'plugin:window|start_dragging')).length).toBe(1)
    expect(await calls(page, 'overlay_action')).toHaveLength(0)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.up()
    await expect.poll(async () => (await calls(page, 'overlay_action')).map(a => a.kind)).toEqual(['open'])
  })

  test('outside the desktop app the route sends the visitor to the board', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/overlay')
    await expect(page).toHaveURL(/\/tasks/)
  })
})

/** A Jetzt task with a timebox, so the main window has something to publish */
const JETZT: SeedTask = { id: 'jetzt-1', title: 'Release notes schreiben', status: 1, priority: 2, timeSpentSeconds: 120, timeBoxSeconds: 1500, custom: {} }
const BOARD = [...SEED_TASKS.filter(t => t.status !== 1), JETZT]

type Sync = { enabled: boolean; snapshot: Snap | null }
const syncs = async (page: Page): Promise<Sync[]> => (await calls(page, 'overlay_sync')) as unknown as Sync[]

test.describe('the main window side', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, BOARD)
    await installTauriStub(context, {})
  })

  test('publishes the Jetzt task with its time and timer state', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.title).toBe('Release notes schreiben')
    const last = (await syncs(page)).at(-1)!
    expect(last.enabled).toBe(true)
    expect(last.snapshot).toMatchObject({ taskId: 'jetzt-1', timeBoxSeconds: 1500, running: true, locale: 'de' })
    expect(last.snapshot!.spentSeconds).toBeGreaterThanOrEqual(120)
  })

  /** The first card of Wartet, as the user reads the column from the top */
  const firstWaiting = (page: Page) => page.locator('#column-waiting-list .task-wrapper').first()

  test('pause moves the card to the top of Wartet and the pill keeps it, paused; resume brings it back (#405)', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.running).toBe(true)
    await emitTauriEvent(page, ACTION_EVENT, { kind: 'toggle-pause', taskId: 'jetzt-1' })

    // the card leaves Jetzt for the top of Wartet, though Wartet sorts by "longest wait" by default
    await expect(page.locator('#column-progress').getByText('Release notes schreiben')).toHaveCount(0)
    await expect(firstWaiting(page)).toHaveAttribute('data-task-id', 'jetzt-1')
    await expect(page.locator('#column-waiting-list .task-wrapper[data-task-id="seed-waiting-1"]')).toBeVisible()
    // the pill still shows it, paused
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot).toMatchObject({ taskId: 'jetzt-1', running: false })
    // no time counts in Wartet
    // the Tauri stub holds the persisted state, so the live store is read (after a flush of the collected seconds)
    const spent = async () => page.evaluate(() => {
      window.dispatchEvent(new Event('pagehide'))
      const app = (window as unknown as { useNuxtApp: () => { $pinia: { _s: Map<string, { task: (id: string) => { timeSpentSeconds: number; timerId: number | null; status: number } | null }> } } }).useNuxtApp()
      const task = app.$pinia._s.get('tasks')!.task('jetzt-1')
      return task ? { timeSpentSeconds: task.timeSpentSeconds, timerId: task.timerId, status: task.status } : null
    })
    await expect.poll(spent).toMatchObject({ status: 2, timerId: null })
    const first = await spent()
    await page.waitForTimeout(2200)
    expect((await spent())!.timeSpentSeconds).toBe(first!.timeSpentSeconds)

    // resume: back in Jetzt, running
    await emitTauriEvent(page, ACTION_EVENT, { kind: 'toggle-pause', taskId: 'jetzt-1' })
    await expect(page.locator('#column-progress').getByText('Release notes schreiben')).toBeVisible()
    await expect(page.locator('#column-waiting-list .task-wrapper[data-task-id="jetzt-1"]')).toHaveCount(0)
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot).toMatchObject({ taskId: 'jetzt-1', running: true })
  })

  test('pause and resume from the pill keep the after-midnight note (#405, #356)', async ({ page }) => {
    // The Tauri stub keeps the persisted state, so the note (what a timer counted after midnight, #356) is set and read on the live store
    type Store = { afterMidnight: { taskId: string, day: string, seconds: number, spans: number[][] } | null }
    const note = () => page.evaluate(() => {
      const app = (window as unknown as { useNuxtApp: () => { $pinia: { _s: Map<string, Store> } } }).useNuxtApp()
      return app.$pinia._s.get('tasks')!.afterMidnight
    })
    await page.goto('/tasks')
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.running).toBe(true)
    await page.evaluate(() => {
      const app = (window as unknown as { useNuxtApp: () => { $pinia: { _s: Map<string, Store> } } }).useNuxtApp()
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
      app.$pinia._s.get('tasks')!.afterMidnight = { taskId: 'jetzt-1', day: '2026-01-01', seconds: 900, spans: [[midnight.getTime(), midnight.getTime() + 900_000]] }
    })
    expect(await note()).toMatchObject({ taskId: 'jetzt-1', seconds: 900 })

    await emitTauriEvent(page, ACTION_EVENT, { kind: 'toggle-pause', taskId: 'jetzt-1' })
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.running).toBe(false)
    await emitTauriEvent(page, ACTION_EVENT, { kind: 'toggle-pause', taskId: 'jetzt-1' })
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.running).toBe(true)

    // the same stint went on: the note is still there
    expect(await note()).toMatchObject({ taskId: 'jetzt-1', seconds: 900 })
  })

  test('done on the paused task completes it from Wartet', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.running).toBe(true)
    await emitTauriEvent(page, ACTION_EVENT, { kind: 'toggle-pause', taskId: 'jetzt-1' })
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.running).toBe(false)
    await emitTauriEvent(page, ACTION_EVENT, { kind: 'done', taskId: 'jetzt-1' })
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot).toBeNull()
    await expect(page.locator('#column-done').getByText('Release notes schreiben')).toBeVisible()
  })

  test('a card pulled into Jetzt takes the pill over from the paused one', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.running).toBe(true)
    await emitTauriEvent(page, ACTION_EVENT, { kind: 'toggle-pause', taskId: 'jetzt-1' })
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.running).toBe(false)
    await page.locator('.task-wrapper', { hasText: 'Konzept ausarbeiten' }).first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Status ändern' }).click()
    await page.getByRole('menuitem', { name: 'Jetzt', exact: true }).click()
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot).toMatchObject({ taskId: 'seed-open-1', running: true })
  })

  test('pause is a plain move to Wartet: no arrival layer or motion, now or when the window comes back (#436)', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.running).toBe(true)
    await emitTauriEvent(page, ACTION_EVENT, { kind: 'toggle-pause', taskId: 'jetzt-1' })
    await expect(firstWaiting(page)).toHaveAttribute('data-task-id', 'jetzt-1')
    await expect(page.getByTestId('task-pause-arrival')).toHaveCount(0)
    // the window losing and regaining the focus (a pause from the pill happens with Kan-do in the background) shows nothing either
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
    await page.waitForTimeout(400)
    await expect(page.getByTestId('task-pause-arrival')).toHaveCount(0)
    await expect(page.locator('#column-waiting-list .task[data-task-id="jetzt-1"]')).not.toHaveClass(/paused-arrival/)
  })

  test('an action for a task that is not in Jetzt changes nothing', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.taskId).toBe('jetzt-1')
    const before = (await syncs(page)).length
    await emitTauriEvent(page, ACTION_EVENT, { kind: 'done', taskId: 'seed-open-1' })
    await emitTauriEvent(page, ACTION_EVENT, { kind: 'quit', taskId: 'jetzt-1' })
    await page.waitForTimeout(500)
    expect((await syncs(page)).length).toBe(before)
    await expect(page.locator('#column-progress').getByText('Release notes schreiben')).toBeVisible()
  })

  test('the setting: on by default, off sends no task and on sends it again', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.taskId).toBe('jetzt-1')
    await openSettings(page)
    const toggle = page.getByTestId('floating-now-switch')
    await expect(page.getByText('Schwebender Fokus-Timer')).toBeVisible()
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect.poll(async () => (await syncs(page)).at(-1)).toEqual({ enabled: false, snapshot: null })
    await toggle.click()
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.taskId).toBe('jetzt-1')
  })
})

test('the setting row is not there on the web', async ({ context, page }) => {
  await seedLocalBoard(context, BOARD)
  await page.goto('/tasks')
  await openSettings(page)
  await expect(page.getByTestId('focus-switch')).toBeVisible()
  await expect(page.getByTestId('floating-now-setting')).toHaveCount(0)
})
