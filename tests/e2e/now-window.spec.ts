import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { SEED_TASKS, seedLocalBoard, type SeedTask } from './helpers/seed'
import { emitTauriEvent, installTauriStub, stubState } from './helpers/tauriStub'
import { openSettings } from './helpers/appNav'

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
  test('shows ring, title and remaining time; the title is private; it counts down by the wall clock', async ({ context, page }) => {
    await openPill(context, page, snap({ running: true }))
    await expect(pill(page)).toBeVisible()
    await expect(page.getByTestId('now-title')).toHaveText('Release notes schreiben')
    await expect(page.getByTestId('now-title')).toHaveAttribute('data-private', '')
    await expect(page.getByTestId('now-ring')).toBeVisible()
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

  test('the last minute and the overrun are amber; no timebox shows the title only', async ({ context, page }) => {
    await openPill(context, page, snap({ spentSeconds: 1500 - 50 }))
    await expect(page.getByTestId('now-time')).toHaveText('0:50')
    await expect(pill(page)).toHaveClass(/is-warning/)
    await emitTauriEvent(page, NOW_EVENT, snap({ spentSeconds: 1500 + 130, at: Date.now() }))
    await expect(page.getByTestId('now-time')).toHaveText('+2:10')
    await expect(pill(page)).toHaveClass(/is-warning/)
    await emitTauriEvent(page, NOW_EVENT, snap({ timeBoxSeconds: null, at: Date.now() }))
    await expect(page.getByTestId('now-title')).toBeVisible()
    await expect(page.getByTestId('now-time')).toHaveCount(0)
    await expect(page.getByTestId('now-ring')).toHaveCount(0)
    await expect(pill(page)).not.toHaveClass(/is-warning/)
  })

  test('follows the state events: a new task, none (empty), the language', async ({ context, page }) => {
    await openPill(context, page, snap())
    await emitTauriEvent(page, NOW_EVENT, snap({ taskId: 'seed-2', title: 'Rechnung schreiben', at: Date.now() }))
    await expect(page.getByTestId('now-title')).toHaveText('Rechnung schreiben')
    await emitTauriEvent(page, NOW_EVENT, snap({ locale: 'en', at: Date.now() }))
    await expect(page.getByTestId('now-open')).toHaveAccessibleName('Open Kan-Do')
    await emitTauriEvent(page, NOW_EVENT, null)
    await expect(pill(page)).toHaveCount(0)
    await emitTauriEvent(page, NOW_EVENT, { not: 'a snapshot' })
    await expect(pill(page)).toHaveCount(0)
  })

  test('hover reveals pause and done; they and a click on the body ask Rust, with the task', async ({ context, page }) => {
    await openPill(context, page, snap({ running: true }))
    const actions = page.getByTestId('now-actions')
    await expect.poll(() => actions.evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(2)
    await pill(page).hover()
    await expect.poll(() => actions.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(40)
    await expect(page.getByTestId('now-pause')).toHaveAccessibleName('Pausieren')
    await page.getByTestId('now-pause').click()
    await page.getByTestId('now-done').click()
    await page.getByTestId('now-title').click()
    await expect.poll(async () => (await calls(page, 'overlay_action')).map(a => a.kind)).toEqual(['toggle-pause', 'done', 'open'])
    for (const call of await calls(page, 'overlay_action')) expect(call.taskId).toBe('seed-1')
  })

  test('a press that travels drags the window and does not open Kan-Do; a plain click opens it', async ({ context, page }) => {
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

  test('the arrival motion plays once on the paused card, and not under reduced motion', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.running).toBe(true)
    await emitTauriEvent(page, ACTION_EVENT, { kind: 'toggle-pause', taskId: 'jetzt-1' })
    await expect(page.getByTestId('task-pause-arrival')).toHaveCount(1)
    const card = page.locator('#column-waiting-list .task[data-task-id="jetzt-1"]')
    await expect(card).toHaveClass(/task--paused-arrival/)
    // it ends itself
    await expect(page.getByTestId('task-pause-arrival')).toHaveCount(0, { timeout: 5000 })
    await expect(card).not.toHaveClass(/task--paused-arrival/)
  })

  test('reduced motion: the card sits at the top of Wartet and no arrival layer is drawn', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/tasks')
    await expect.poll(async () => (await syncs(page)).at(-1)?.snapshot?.running).toBe(true)
    await emitTauriEvent(page, ACTION_EVENT, { kind: 'toggle-pause', taskId: 'jetzt-1' })
    await expect(firstWaiting(page)).toHaveAttribute('data-task-id', 'jetzt-1')
    await expect(page.getByTestId('task-pause-arrival')).toHaveCount(0)
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
    await expect(page.getByText('Schwebendes Jetzt-Fenster')).toBeVisible()
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
