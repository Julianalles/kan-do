import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'
import { installTauriStub, setReminderDue, setRemindersStatus, stubState } from './helpers/tauriStub'
import { dropSettled, hover, pickUp } from './helpers/dnd'

/**
 * #370: the desktop app feels native. Control labels are not selectable text, content and fields still are, and the
 * browser's context menu is gone (except in text fields). The Tauri stub makes `isTauri()` true, the production build
 * makes `import.meta.dev` false: the same conditions as the installed app. #398: reload, print and zoom chords and the
 * drag of a link or an image are cancelled. #393: pressable controls show the arrow cursor.
 */

const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? '')

/** Dispatches a right click; resolves to whether the app cancelled the browser's menu. */
const contextMenuCancelled = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)!
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    return event.defaultPrevented
  }, selector)

/** Dispatches a key chord on `body`; resolves to whether the app cancelled it (`preventDefault`). */
const keydownCancelled = (page: Page, init: KeyboardEventInit) =>
  page.evaluate((chord) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...chord })
    document.body.dispatchEvent(event)
    return event.defaultPrevented
  }, init)

/** Dispatches a `dragstart` on an element built from `html` (appended to `body`); resolves to whether it was cancelled. */
const dragstartCancelled = (page: Page, html: string) =>
  page.evaluate((markup) => {
    const host = document.createElement('div')
    host.innerHTML = markup
    document.body.append(host)
    const event = new Event('dragstart', { bubbles: true, cancelable: true })
    host.firstElementChild!.dispatchEvent(event)
    host.remove()
    return event.defaultPrevented
  }, html)

/** The computed cursor of an element built from `html` (appended to `body`, so it inherits the page's rules). */
const cursorOf = (page: Page, html: string, disabled = false) =>
  page.evaluate(({ markup, off }) => {
    const host = document.createElement('div')
    host.innerHTML = markup
    document.body.append(host)
    const el = host.firstElementChild as HTMLElement
    const target = el.querySelector('a, button') as HTMLElement | null ?? el
    if (off) (target as HTMLButtonElement).disabled = true
    const cursor = getComputedStyle(target).cursor
    host.remove()
    return cursor
  }, { markup: html, off: disabled })

test.describe('Native feel (desktop)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
    await installTauriStub(context, {})
  })

  test('a double click on a control label selects nothing, content on a page stays selectable', async ({ page }) => {
    await page.goto('/settings?tab=sources')
    await expect(page.locator('html')).toHaveAttribute('data-shell', 'desktop')
    const heading = page.getByRole('heading', { name: 'Deine Verbindungen', level: 2 })
    await expect(heading).toBeVisible()

    const button = page.getByTestId('data-folder-change')
    await button.dblclick()
    expect(await selectedText(page)).toBe('')

    await heading.dblclick()
    expect(await selectedText(page)).toBe('')

    const path = page.getByTestId('data-folder-path')
    await path.dblclick()
    expect((await selectedText(page)).length).toBeGreaterThan(0)
  })

  test('a text field keeps selecting and editing', async ({ page }) => {
    await page.goto('/tasks/add')
    const title = page.getByRole('textbox').first()
    await title.fill('Kopierbarer Text')
    await title.selectText()
    expect(await title.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart!, el.selectionEnd!))).toBe('Kopierbarer Text')
  })

  test('no browser context menu on a label, but the native one in a text field', async ({ page }) => {
    await page.goto('/settings?tab=sources')
    await expect(page.getByTestId('data-folder-change')).toBeVisible()
    expect(await contextMenuCancelled(page, '[data-testid="data-folder-change"]')).toBe(true)
    expect(await contextMenuCancelled(page, 'body')).toBe(true)

    // selected text keeps Copy, but only on the selection itself
    await page.getByTestId('data-folder-path').dblclick()
    expect(await selectedText(page)).not.toBe('')
    expect(await contextMenuCancelled(page, '[data-testid="data-folder-path"] [aria-hidden="true"]')).toBe(false)
    expect(await contextMenuCancelled(page, '[data-testid="data-folder-change"]')).toBe(true)

    await page.goto('/tasks/add')
    await expect(page.getByRole('textbox').first()).toBeVisible()
    expect(await contextMenuCancelled(page, 'input[type="text"], input:not([type]), textarea')).toBe(false)
  })

  test('reload, print and zoom chords are cancelled, editing and the app\'s own chords are not (#398)', async ({ page }) => {
    await page.goto('/tasks/add')
    await expect(page.getByRole('textbox').first()).toBeVisible()
    // Cmd on macOS, Ctrl elsewhere (the engine here decides); the other modifier is a text binding and passes
    const mac = await page.evaluate(() => /mac|iphone|ipad/i.test(navigator.platform))
    const mod = mac ? 'metaKey' : 'ctrlKey'
    const other = mac ? 'ctrlKey' : 'metaKey'
    for (const chord of [
      { key: 'F5' },
      { key: 'r', [mod]: true },
      { key: 'R', [mod]: true, shiftKey: true },
      { key: 'p', [mod]: true },
      { key: '=', [mod]: true },
      { key: '+', [mod]: true },
      { key: '-', [mod]: true },
      { key: '0', [mod]: true },
    ]) {
      expect(await keydownCancelled(page, chord), JSON.stringify(chord)).toBe(true)
    }
    for (const chord of [
      { key: 'z', [mod]: true },
      { key: 'c', [mod]: true },
      { key: 'v', [mod]: true },
      { key: 'a', [mod]: true },
      { key: 'n', [mod]: true },
      { key: '1', [mod]: true },
      { key: 'p', [other]: true }, // macOS Ctrl+P is "up one line" in a text field
      { key: 'r', [other]: true },
      { key: 'r' },
      { key: '-' },
    ]) {
      expect(await keydownCancelled(page, chord), JSON.stringify(chord)).toBe(false)
    }
    // typing still works
    const title = page.getByRole('textbox').first()
    await title.fill('r-p+0')
    await expect(title).toHaveValue('r-p+0')
  })

  test('a link or an image cannot be dragged out of the window, anything else keeps its drag (#398)', async ({ page }) => {
    await page.goto('/settings/data')
    await expect(page.locator('html')).toHaveAttribute('data-shell', 'desktop')
    expect(await dragstartCancelled(page, '<a href="https://example.com">link</a>')).toBe(true)
    expect(await dragstartCancelled(page, '<img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">')).toBe(true)
    expect(await dragstartCancelled(page, '<div>text</div>')).toBe(false)
    const userDrag = await page.evaluate(() => {
      const a = document.createElement('a')
      a.href = 'https://example.com'
      document.body.append(a)
      const value = getComputedStyle(a).getPropertyValue('-webkit-user-drag')
      a.remove()
      return value
    })
    expect(userDrag).toBe('none')
  })

  test('a task still drags between columns with the desktop marker set (#398)', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.locator('html')).toHaveAttribute('data-shell', 'desktop')
    const source = page.locator('.task-wrapper[data-task-id="seed-open-1"]')
    const target = page.locator('#column-waiting-list .task-wrapper[data-task-id="seed-waiting-1"]')
    await expect(source).toBeVisible()
    await pickUp(page, source)
    await hover(page, target)
    await page.mouse.up()
    await dropSettled(page)
    await expect(page.locator('#column-waiting-list .task-wrapper[data-task-id="seed-open-1"]')).toHaveCount(1)
  })

  test('controls show the arrow cursor, a disabled one not-allowed, a link in copyable text the hand (#393)', async ({ page }) => {
    await page.goto('/settings?tab=sources')
    await expect(page.getByTestId('data-folder-change')).toBeVisible()
    expect(await page.getByTestId('data-folder-change').evaluate(el => getComputedStyle(el).cursor)).toBe('default')
    expect(await cursorOf(page, '<button type="button">x</button>')).toBe('default')
    expect(await cursorOf(page, '<div role="option" class="cursor-pointer">x</div>')).toBe('default')
    expect(await cursorOf(page, '<a href="/tasks">x</a>')).toBe('default')
    expect(await cursorOf(page, '<button type="button">x</button>', true)).toBe('not-allowed')
    expect(await cursorOf(page, '<p data-selectable><a href="https://example.com">x</a></p>')).toBe('pointer')
  })

  test('the task card shows the arrow, a control with a deliberate cursor keeps it (#393)', async ({ page }) => {
    await page.goto('/tasks')
    const card = page.locator('.task-wrapper[data-task-id="seed-open-1"] .task')
    await expect(card).toBeVisible()
    // the card's own scoped `.task { cursor: pointer }` does not bring the hand back
    expect(await card.evaluate(el => getComputedStyle(el).cursor)).toBe('default')
    // a control that sets its own cursor (text, grab, not-allowed) is not overridden by the arrow rule
    expect(await cursorOf(page, '<button type="button" class="cursor-text">x</button>')).toBe('text')
    expect(await cursorOf(page, '<button type="button" class="cursor-grab">x</button>')).toBe('grab')
  })
})

test.describe('Native feel (web)', () => {
  test('the web app keeps the browser selection and context menu', async ({ page, context }) => {
    await seedLocalBoard(context)
    await page.goto('/settings')
    await expect(page.locator('html')).not.toHaveAttribute('data-shell', 'desktop')
    expect(await contextMenuCancelled(page, 'body')).toBe(false)
    // #398, #393: the browser keeps reload, print, zoom, the link drag and the hand cursor
    expect(await keydownCancelled(page, { key: 'r', metaKey: true })).toBe(false)
    expect(await keydownCancelled(page, { key: 'r', ctrlKey: true })).toBe(false)
    expect(await keydownCancelled(page, { key: 'p', ctrlKey: true })).toBe(false)
    expect(await keydownCancelled(page, { key: '=', metaKey: true })).toBe(false)
    expect(await dragstartCancelled(page, '<a href="https://example.com">link</a>')).toBe(false)
    expect(await cursorOf(page, '<button type="button">x</button>')).toBe('pointer')
  })
})

/**
 * #550: the Tauri stub answers the `reminders_*` commands like `src-tauri/src/reminders.rs` (the slices 2 to 4 of #481 test
 * against it): the prompt only from `reminders_request_access`, compare-and-set writes, the list guard, a recurring tick.
 */
test.describe('Reminders stub', () => {
  type Outcome = { ok: true, value: unknown } | { ok: false, error: unknown }
  const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
    page.evaluate(async ({ cmd: command, args: payload }) => {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__
      try {
        return { ok: true, value: await internals.invoke(command, payload) }
      } catch (error) {
        return { ok: false, error }
      }
    }, { cmd, args }) as Promise<Outcome>

  test('mirrors the bridge contract', async ({ page, context }) => {
    await seedLocalBoard(context)
    await installTauriStub(context, {
      reminders: {
        lists: [{ id: 'L1', title: 'Heute' }, { id: 'L2', title: 'Privat', color: '#ff8800' }],
        reminders: [
          { id: 'a', listId: 'L1', title: 'A', due: { date: '2026-11-20', time: '09:30' } },
          { id: 'b', listId: 'L2', title: 'B' },
          { id: 'old', listId: 'L1', title: 'Old', completed: true, completedAt: 100 },
          { id: 'r', listId: 'L1', title: 'R', due: { date: '2026-11-20' }, recurrence: { rule: 'FREQ=WEEKLY;INTERVAL=1' }, nextDue: { date: '2026-11-27' } },
        ],
      },
    })
    await page.goto('/settings')
    const allowed = ['L1']

    // Undecided: the status never prompts, reads and writes are refused.
    expect(await invoke(page, 'reminders_access_status')).toEqual({ ok: true, value: 'notDetermined' })
    expect(await invoke(page, 'reminders_lists')).toEqual({ ok: false, error: 'access-denied' })
    expect(await invoke(page, 'reminders_set_due', { id: 'a', expectedDate: '2026-11-20', date: '2026-11-21', allowedListIds: allowed })).toEqual({ ok: false, error: 'access-denied' })
    expect((await stubState(page)).reminders.prompts).toBe(0)

    // Only the request prompts, once.
    expect(await invoke(page, 'reminders_request_access')).toEqual({ ok: true, value: 'granted' })
    expect(await invoke(page, 'reminders_request_access')).toEqual({ ok: true, value: 'granted' })
    expect((await stubState(page)).reminders.prompts).toBe(1)

    expect(await invoke(page, 'reminders_lists')).toEqual({
      ok: true,
      value: [
        { id: 'L1', title: 'Heute', color: null, openCount: 2, allowsWrites: true },
        { id: 'L2', title: 'Privat', color: '#ff8800', openCount: 1, allowsWrites: true },
      ],
    })
    const fetched = await invoke(page, 'reminders_fetch', { listIds: ['L1', 'GONE'], completedSince: 1000 })
    expect(fetched.ok && (fetched.value as { reminders: { id: string }[] }).reminders.map(r => r.id)).toEqual(['a', 'r'])
    expect(fetched.ok && (fetched.value as { missingListIds: string[] }).missingListIds).toEqual(['GONE'])

    // Compare-and-set keeps the time; a moved date is `changed` and writes nothing; a list outside the allowed ones is `not-read`.
    expect(await invoke(page, 'reminders_set_due', { id: 'a', expectedDate: '2026-11-20', date: '2026-11-21', allowedListIds: allowed }))
      .toEqual({ ok: true, value: { date: '2026-11-21', time: '09:30' } })
    expect(await invoke(page, 'reminders_set_due', { id: 'a', expectedDate: '2026-11-20', date: '2026-11-22', allowedListIds: allowed })).toEqual({ ok: false, error: 'changed' })
    await setReminderDue(page, 'a', '2026-12-01')
    expect(await invoke(page, 'reminders_set_due', { id: 'a', expectedDate: '2026-11-21', date: '2026-11-22', allowedListIds: allowed })).toEqual({ ok: false, error: 'changed' })
    expect(await invoke(page, 'reminders_set_due', { id: 'b', expectedDate: null, date: '2026-11-22', allowedListIds: allowed })).toEqual({ ok: false, error: 'not-read' })
    expect(await invoke(page, 'reminders_set_due', { id: 'b', expectedDate: null, date: 'tomorrow', allowedListIds: ['L2'] })).toEqual({ ok: false, error: 'invalid-request' })

    // A recurring tick moves to the next date; the occurrence that is gone is `changed`.
    expect(await invoke(page, 'reminders_set_completed', { id: 'r', completed: true, occurrenceDate: '2026-11-19', allowedListIds: allowed })).toEqual({ ok: false, error: 'changed' })
    expect(await invoke(page, 'reminders_set_completed', { id: 'r', completed: true, occurrenceDate: '2026-11-20', allowedListIds: allowed }))
      .toEqual({ ok: true, value: { completed: false, due: { date: '2026-11-27', time: null } } })
    expect((await invoke(page, 'reminders_set_completed', { id: 'a', completed: true, allowedListIds: allowed })).ok).toBe(true)

    // The user turns the permission off in System Settings.
    await setRemindersStatus(page, 'denied')
    expect(await invoke(page, 'reminders_access_status')).toEqual({ ok: true, value: 'denied' })
    expect(await invoke(page, 'reminders_fetch', { listIds: ['L1'], completedSince: 0 })).toEqual({ ok: false, error: 'access-denied' })
    expect(await invoke(page, 'reminders_open_settings')).toEqual({ ok: true, value: null })
    expect((await stubState(page)).openedUrls).toContain('x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders')
    expect((await stubState(page)).calls.some(call => call.cmd === 'reminders_set_completed')).toBe(true)
  })
})
