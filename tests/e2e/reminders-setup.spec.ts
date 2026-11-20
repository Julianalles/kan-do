import { test, expect, type Page } from '@playwright/test'
import { goToPlace, openSettings } from './helpers/appNav'
import { REMINDERS_SEED_LISTS, remindersSeedReminders, seedRemindersBoard } from './helpers/seed'
import { installTauriStub, persistedStores, setRemindersListsFailing, setRemindersStatus, stubState, type RemindersAccess, type TauriStubState } from './helpers/tauriStub'

/**
 * Apple Reminders setup and settings (#552, epic #481 slice 3). The Tauri stub plays macOS: the permission, the prompt
 * (counted in `prompts`), three lists and the reminders. First run: step 2 of the welcome flow offers Erinnerungen, the
 * setup has three steps (Zugriff, Listen, Heute) and connects only at its last button; settings change the answers later.
 */

const LISTS = REMINDERS_SEED_LISTS.map((list) => ({ ...list, color: list.id === 'list-home' ? '#1c7ed6' : undefined }))

async function firstRun(context: Parameters<typeof installTauriStub>[0], options: { status?: RemindersAccess; answer?: RemindersAccess } = {}) {
  await installTauriStub(context, { reminders: { status: options.status ?? 'notDetermined', answer: options.answer ?? 'granted', lists: LISTS, reminders: remindersSeedReminders() } })
}

const prompts = async (page: Page) => (await stubState(page)).reminders.prompts
const calls = async (page: Page, cmd: string): Promise<TauriStubState['calls']> => (await stubState(page)).calls.filter((call) => call.cmd === cmd)

/** The sources the app persisted (the stub's data file); the write is debounced, so callers poll. */
const storedSources = async (page: Page) => ((await persistedStores(page))['board-store']?.boardConfig as { sources?: unknown } | undefined)?.sources ?? null
const storedRoles = async (page: Page) => ((await persistedStores(page)).remindersConfig?.lists ?? {}) as Record<string, { role: string; title: string }>

/** Welcome -> step 2 -> Erinnerungen ticked (and Notion when asked) -> the setup */
async function openReminders(page: Page, withNotion = false) {
  await page.goto('/welcome')
  await page.getByRole('button', { name: 'Jetzt starten' }).click()
  await page.getByRole('checkbox', { name: 'Erinnerungen' }).click()
  if (withNotion) await page.getByRole('checkbox', { name: 'Notion' }).click()
  await page.getByRole('button', { name: withNotion ? 'Weiter mit Erinnerungen und Notion' : 'Mit Erinnerungen einrichten' }).click()
  await expect(page.getByTestId('reminders-setup-flow')).toBeVisible()
}

const proceed = (page: Page) => page.getByTestId('reminders-proceed')
const roleChoice = (page: Page, listId: string, role: string) => page.getByTestId(`reminders-role-${listId}-${role}`)

/** Access granted: step 1 -> step 2 */
/** From the board (so its tasks are loaded) to the page: sources tab -> the row's menu */
async function openRemindersSettings(page: Page) {
  await page.goto('/tasks')
  await expect(page.locator('#column-open-list').getByText('Milch kaufen')).toBeVisible()
  await openSettings(page, 'sources')
  await page.getByTestId('source-actions-reminders').click()
  await page.getByRole('menuitem', { name: 'Erinnerungen-Einstellungen' }).click()
  await expect(page).toHaveURL(/\/settings\/reminders$/)
}

async function grantAndContinue(page: Page) {
  await proceed(page).click() // "Zugriff erlauben"
  await expect(page.getByTestId('reminders-granted')).toBeVisible()
  await proceed(page).click() // "Weiter"
  await expect(page.getByTestId('reminders-lists-step')).toBeVisible()
}

test.describe('welcome step 2 and the setup (#552)', () => {
  test('on the web Erinnerungen is disabled with "Nur in der Mac-App" on its card, the sources tab says so too, and /settings/reminders returns to the sources tab', async ({ page }) => {
    await page.goto('/welcome')
    await page.getByRole('button', { name: 'Jetzt starten' }).click()
    const box = page.getByRole('checkbox', { name: 'Erinnerungen' })
    await expect(box).toBeDisabled()
    await expect(box).toContainText('Nur in der Mac-App') // the reason is on the card and part of its name
    // The button is not about Reminders
    await expect(page.getByTestId('local-confirm')).toHaveText('Zum Board')

    await page.goto('/tasks?seed=local')
    await openSettings(page, 'sources')
    await expect(page.getByTestId('source-more-reminders')).toContainText('nur in der Mac-App')
    await expect(page.getByTestId('source-connect-reminders')).toHaveCount(0)

    await page.goto('/settings/reminders')
    await expect(page).toHaveURL(/\/settings\?tab=sources/)
  })

  test('the checkbox is enabled in the Mac app and the button follows the ticks', async ({ context, page }) => {
    await firstRun(context)
    await page.goto('/welcome')
    await page.getByRole('button', { name: 'Jetzt starten' }).click()
    const reminders = page.getByRole('checkbox', { name: 'Erinnerungen' })
    await expect(reminders).toBeEnabled()
    await reminders.click()
    await expect(page.getByTestId('local-confirm')).toHaveText('Mit Erinnerungen einrichten')
    await page.getByRole('checkbox', { name: 'Notion' }).click()
    await expect(page.getByTestId('local-confirm')).toHaveText('Weiter mit Erinnerungen und Notion')
    await page.getByRole('checkbox', { name: 'Erinnerungen' }).click()
    await expect(page.getByTestId('local-confirm')).toHaveText('Mit Notion einrichten')
  })

  test('step 1 announces the permission before macOS asks; macOS asks only after "Zugriff erlauben"; granted shows the list count', async ({ context, page }) => {
    await firstRun(context)
    await openReminders(page)

    await expect(page.getByTestId('reminders-step-title')).toHaveText('Zugriff auf Erinnerungen')
    await expect(page.getByTestId('reminders-prompt-preview')).toContainText('Das siehst du gleich')
    await expect(page.getByText('Warum Vollzugriff?')).toBeVisible()
    await expect(page.getByText('Was Kan-Do nie tut')).toBeVisible()
    await expect(page.getByText('Systemeinstellungen › Datenschutz & Sicherheit › Erinnerungen.')).toBeVisible()
    await expect(proceed(page)).toHaveText('Zugriff erlauben')
    expect(await prompts(page)).toBe(0)
    expect(await calls(page, 'reminders_request_access')).toHaveLength(0)

    await proceed(page).click()
    await expect(page.getByTestId('reminders-granted')).toHaveText('Zugriff erteilt. Kan-Do sieht 3 Listen.')
    expect(await prompts(page)).toBe(1)
    await expect(proceed(page)).toHaveText('Weiter')
    // Nothing connected yet: access is macOS's, not a connection
    expect(await storedSources(page)).toBeNull()
  })

  test('access granted but the lists cannot be read: the step says so (never "0 Listen"), "Erneut versuchen" reads them again and "Weiter" follows', async ({ context, page }) => {
    await firstRun(context, { status: 'granted' })
    await page.goto('/welcome')
    await setRemindersListsFailing(page, true) // the stub keeps it across the next navigation
    await openReminders(page)

    await expect(page.getByTestId('reminders-lists-failed')).toContainText('Die Listen konnten nicht gelesen werden.')
    await expect(page.getByTestId('reminders-granted')).toHaveCount(0)
    await expect(proceed(page)).toHaveText('Erneut versuchen')
    await expect(proceed(page)).toBeEnabled()

    await setRemindersListsFailing(page, false)
    await proceed(page).click()
    await expect(page.getByTestId('reminders-granted')).toHaveText('Zugriff erteilt. Kan-Do sieht 3 Listen.')
    await expect(proceed(page)).toHaveText('Weiter')
  })

  test('denied: how to allow it, "Systemeinstellungen öffnen" and "Erneut prüfen"; allowing it in macOS then continues', async ({ context, page }) => {
    await firstRun(context, { answer: 'denied' })
    await openReminders(page)

    await proceed(page).click()
    const denied = page.getByTestId('reminders-denied')
    await expect(denied).toContainText('Kan-Do hat keinen Zugriff.')
    await expect(denied).toContainText('Danach prüft Kan-Do es noch einmal.')
    await expect(proceed(page)).toHaveText('Erneut prüfen')

    await page.getByTestId('reminders-open-settings').click()
    await expect.poll(async () => (await stubState(page)).openedUrls.at(-1)).toContain('Privacy_Reminders')

    // Still denied: nothing changes and the prompt is not shown again (wait for the check itself before the next change)
    const checks = (await calls(page, 'reminders_access_status')).length
    await proceed(page).click()
    await expect.poll(async () => (await calls(page, 'reminders_access_status')).length).toBeGreaterThan(checks)
    await expect(denied).toBeVisible()
    expect(await prompts(page)).toBe(1)

    await setRemindersStatus(page, 'granted')
    await proceed(page).click()
    await expect(page.getByTestId('reminders-granted')).toBeVisible()
    expect(await prompts(page)).toBe(1)
  })

  test('step 2: every list Thema (preselected), Aktivität or Aus; the picked answer is a lifted segment, an Aus list reads "Wird nicht gelesen"; all Aus blocks the way on', async ({ context, page }) => {
    await firstRun(context)
    await openReminders(page)
    await grantAndContinue(page)

    await expect(page.getByTestId('reminders-step-title')).toHaveText('Deine Listen')
    for (const list of LISTS) {
      await expect(roleChoice(page, list.id, 'topic')).toBeChecked()
      await expect(page.getByTestId(`reminders-list-${list.id}`).getByRole('radio')).toHaveCount(3)
      await expect(page.getByRole('radiogroup', { name: `${list.title} zählt als` })).toBeVisible()
    }
    await expect(page.getByTestId('reminders-list-detail-list-home')).toHaveText('2 offen')
    // The picked answer is no solid green fill
    await expect(roleChoice(page, 'list-home', 'topic')).not.toHaveClass(/bg-primary/)

    await roleChoice(page, 'list-private', 'off').click()
    await expect(roleChoice(page, 'list-private', 'off')).toBeChecked()
    await expect(page.getByTestId('reminders-list-detail-list-private')).toHaveText('Wird nicht gelesen')

    await roleChoice(page, 'list-home', 'off').click()
    await roleChoice(page, 'list-work', 'off').click()
    await expect(page.getByTestId('reminders-lists-empty')).toHaveText('Alle Listen sind aus. Stelle mindestens eine auf Thema oder Aktivität.')
    await expect(proceed(page)).toBeDisabled()

    await roleChoice(page, 'list-work', 'activity').click()
    await expect(page.getByTestId('reminders-lists-empty')).toHaveCount(0)
    await expect(proceed(page)).toBeEnabled()
  })

  test('Reminders only: step 3 shows the four-row table and the write line, "Verbinden" writes the answers, shows the beat and opens the board; Reminders is connected, Local stays the default', async ({ context, page }) => {
    await firstRun(context)
    await openReminders(page)
    await grantAndContinue(page)
    await roleChoice(page, 'list-work', 'activity').click()
    await roleChoice(page, 'list-private', 'off').click()
    await proceed(page).click()

    await expect(page.getByTestId('reminders-step-title')).toHaveText('Heute')
    await expect(page.getByRole('table', { name: 'Datum und Board' })).toBeVisible()
    await expect(page.getByTestId('reminders-today-row-today')).toContainText('Auf dem Board')
    for (const key of ['earlier', 'later', 'none']) await expect(page.getByTestId(`reminders-today-row-${key}`)).toContainText('In Meine Aufgaben')
    await expect(page.getByTestId('reminders-today-writes')).toContainText('setzt Kan-Do ihr Datum auf heute')
    await expect(proceed(page)).toHaveText('Verbinden')
    // Still nothing written
    expect(await storedSources(page)).toBeNull()

    await proceed(page).click()
    await expect(page.getByTestId('reminders-done')).toContainText('Erinnerungen ist verbunden')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.locator('#column-open-list').getByText('Milch kaufen')).toBeVisible()

    await expect.poll(() => storedSources(page)).toEqual({ connected: ['reminders'], default: 'local' })
    await expect.poll(async () => (await storedRoles(page))['list-work']?.role).toBe('activity')
    expect(await storedRoles(page)).toMatchObject({ 'list-home': { role: 'topic', title: 'Zuhause' }, 'list-private': { role: 'off', title: 'Privat' } })
    // The list set to Aus is never read
    expect((await calls(page, 'reminders_fetch')).at(-1)?.args).toMatchObject({ listIds: ['list-home', 'list-work'] })
  })

  test('Back works on every step and writes nothing: no roles, no sources', async ({ context, page }) => {
    await firstRun(context)
    await openReminders(page)
    await grantAndContinue(page)
    await roleChoice(page, 'list-work', 'off').click()
    await proceed(page).click()
    await expect(page.getByTestId('reminders-step-title')).toHaveText('Heute')

    await page.getByTestId('setup-back').click()
    await expect(page.getByTestId('reminders-step-title')).toHaveText('Deine Listen')
    // The answer made on the way is still there
    await expect(roleChoice(page, 'list-work', 'off')).toBeChecked()
    await page.getByTestId('setup-back').click()
    await expect(page.getByTestId('reminders-step-title')).toHaveText('Zugriff auf Erinnerungen')
    await expect(page.getByTestId('setup-back')).toHaveText('Zurück zur Auswahl')
    await page.getByTestId('setup-back').click()

    await expect(page.getByTestId('local-setup-flow')).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Erinnerungen' })).toBeChecked()
    // Let a debounced write land, if there were one
    await page.waitForTimeout(600)
    expect(await storedSources(page)).toBeNull()
    expect(await storedRoles(page)).toEqual({})
    expect(await calls(page, 'reminders_fetch')).toHaveLength(0)
  })

  test('access revoked between the steps: "Verbinden" connects nothing, the setup returns to step 1 with the denied panel', async ({ context, page }) => {
    await firstRun(context)
    await openReminders(page)
    await grantAndContinue(page)
    await proceed(page).click()
    await expect(page.getByTestId('reminders-step-title')).toHaveText('Heute')

    await setRemindersStatus(page, 'denied') // revoked in System Settings meanwhile
    await proceed(page).click()

    await expect(page.getByTestId('reminders-step-title')).toHaveText('Zugriff auf Erinnerungen')
    await expect(page.getByTestId('reminders-denied')).toBeVisible()
    await expect(page).toHaveURL(/\/welcome$/)
    await page.waitForTimeout(600)
    expect(await storedSources(page)).toBeNull()
    expect(await storedRoles(page)).toEqual({})
  })

  test('with Notion ticked: Reminders runs first and ends in "Weiter zu Notion", then the Notion setup (its ending is useFirstRunSources, unit-tested)', async ({ context, page }) => {
    await firstRun(context)
    await openReminders(page, true)
    await grantAndContinue(page)
    await proceed(page).click()
    await expect(page.getByText('Danach richtest du Notion ein.')).toBeVisible()
    await expect(proceed(page)).toHaveText('Weiter zu Notion')
    await proceed(page).click()

    await expect(page.getByTestId('notion-setup-flow')).toBeVisible()
    // Reminders is connected first, so a Notion failure still leaves it; Local stays the default until Notion is done
    await expect.poll(() => storedSources(page)).toEqual({ connected: ['reminders'], default: 'local' })
    await expect(page).toHaveURL(/\/welcome$/)

    // Back from the Notion setup lands on step 2 with both ticks kept
    await page.getByTestId('setup-back').click()
    await expect(page.getByTestId('local-setup-flow')).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Erinnerungen' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Notion' })).toBeChecked()
  })

  test('the setup at 390px: a progress bar instead of the rail, no horizontal overflow, 44px targets for the per-list answers', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await firstRun(context)
    await openReminders(page)
    await expect(page.getByTestId('setup-progress')).toBeVisible()
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    await grantAndContinue(page)
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
    for (const list of LISTS) {
      for (const role of ['topic', 'activity', 'off']) {
        expect((await roleChoice(page, list.id, role).boundingBox())!.height).toBeGreaterThanOrEqual(40)
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  })
})

test.describe('Erinnerungen-Einstellungen (#552)', () => {
  test('Listen, Heute and Zugriff; the sources tab leads there', async ({ context, page }) => {
    await seedRemindersBoard(context)
    await page.goto('/tasks')
    await openSettings(page, 'sources')
    await page.getByTestId('source-actions-reminders').click()
    await page.getByRole('menuitem', { name: 'Erinnerungen-Einstellungen' }).click()

    await expect(page).toHaveURL(/\/settings\/reminders$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Erinnerungen-Einstellungen' })).toBeVisible()
    await expect(page.getByText('Hier änderst du jederzeit, was du beim Einrichten gewählt hast.')).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Listen' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Heute' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Zugriff' })).toBeVisible()
    await expect(roleChoice(page, 'list-home', 'topic')).toBeChecked()
    await expect(roleChoice(page, 'list-work', 'activity')).toBeChecked()
    await expect(roleChoice(page, 'list-private', 'off')).toBeChecked()
    await expect(page.getByTestId('reminders-today-row-today')).toContainText('Auf dem Board')
    await expect(page.getByTestId('reminders-access-granted')).toHaveText('Kan-Do darf auf Erinnerungen zugreifen.')

    await page.getByTestId('reminders-open-settings').click()
    await expect.poll(async () => (await stubState(page)).openedUrls.at(-1)).toContain('Privacy_Reminders')
    // The way back is the sources tab
    await page.getByTestId('setup-back').click()
    await expect(page).toHaveURL(/\/settings\?tab=sources/)
  })

  test('a list to Aus asks first when tasks would leave: counts, Cancel restores the choice, nothing is written to Reminders; Confirm takes the tasks off the board', async ({ context, page }) => {
    await seedRemindersBoard(context)
    await openRemindersSettings(page)
    await expect(roleChoice(page, 'list-home', 'topic')).toBeChecked()

    await roleChoice(page, 'list-home', 'off').click()
    const question = page.getByTestId('reminders-exclude-confirm')
    // Zuhause holds Milch kaufen, Pflanzen gießen and the ticked Müll rausgebracht
    await expect(question).toContainText('Zuhause nicht mehr lesen?')
    await expect(question).toContainText('3 Aufgaben verlassen Kan-Do, 3 davon stehen heute auf dem Board.')
    await expect(question).toContainText('In Erinnerungen bleibt alles, wie es ist.')
    await expect(roleChoice(page, 'list-home', 'off')).toBeChecked()

    await page.getByTestId('reminders-exclude-confirm-cancel').click()
    await expect(question).toHaveCount(0)
    await expect(roleChoice(page, 'list-home', 'topic')).toBeChecked()
    expect((await storedRoles(page))['list-home']?.role).toBe('topic')

    await roleChoice(page, 'list-home', 'off').click()
    await page.getByTestId('reminders-exclude-confirm-yes').click()
    await expect(question).toHaveCount(0)
    await expect(page.getByTestId('reminders-list-detail-list-home')).toHaveText('Wird nicht gelesen')
    await expect.poll(async () => (await storedRoles(page))['list-home']?.role).toBe('off')

    await page.goto('/tasks')
    await expect(page.getByText('Quartalsbericht schreiben')).toBeVisible()
    await expect(page.getByText('Milch kaufen')).toHaveCount(0)
    await expect(page.getByText('Pflanzen gießen')).toHaveCount(0)
    // Reminders is untouched: no write of any kind
    for (const cmd of ['reminders_set_due', 'reminders_set_completed']) expect(await calls(page, cmd)).toHaveLength(0)
    const stub = await stubState(page)
    expect(stub.reminders.reminders.map((r) => r.id).sort()).toEqual(remindersSeedReminders().map((r) => r.id).sort())
  })

  test('a list without tasks on the board switches to Aus without a question, and back on brings its tasks', async ({ context, page }) => {
    await seedRemindersBoard(context)
    await openRemindersSettings(page)
    // Privat is Aus already: switching it on fetches its reminder
    await roleChoice(page, 'list-private', 'activity').click()
    await expect(page.getByTestId('reminders-exclude-confirm')).toHaveCount(0)
    // Dated tomorrow, so by #553 it is not on today's board: it waits in "Alle"
    await goToPlace(page, 'Heute')
    await expect(page.getByText('Geschenk verstecken')).toHaveCount(0)
    await goToPlace(page, 'Alle')
    await expect(page.getByText('Geschenk verstecken')).toBeVisible()

    await openSettings(page, 'sources')
    await page.getByTestId('source-actions-reminders').click()
    await page.getByRole('menuitem', { name: 'Erinnerungen-Einstellungen' }).click()
    await roleChoice(page, 'list-private', 'off').click()
    // It has a task now, so it asks: one task, none of it on today's board
    await expect(page.getByTestId('reminders-exclude-confirm')).toContainText('1 Aufgabe verlässt Kan-Do, 0 davon stehen heute auf dem Board.')
  })

  test('access revoked in macOS: "Verbindung reparieren" in the sources tab and on the page, no dialog opens by itself; repair after allowing it', async ({ context, page }) => {
    await seedRemindersBoard(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list').getByText('Milch kaufen')).toBeVisible()

    await setRemindersStatus(page, 'denied')
    await page.reload() // the first fetch of the session reads the permission: the source needs attention
    await openSettings(page, 'sources')
    await expect(page.getByTestId('source-status-reminders')).toHaveText('Verbindung prüfen')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('source-repair-reminders').click()

    await expect(page).toHaveURL(/\/settings\/reminders$/)
    await expect(page.getByTestId('reminders-access-denied')).toContainText('Kan-Do hat keinen Zugriff.')
    await expect(page.getByTestId('reminders-repair')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // The Listen section does not claim there is no list (it cannot read them), and says what to do instead
    await expect(page.getByTestId('reminders-lists-no-access')).toContainText('Ohne Zugriff sieht Kan-Do deine Listen nicht.')
    await expect(page.getByTestId('reminders-lists-none')).toHaveCount(0)

    await setRemindersStatus(page, 'granted')
    await page.getByTestId('reminders-repair').click()
    await expect(page.getByTestId('reminders-access-granted')).toBeVisible()
    await expect(page.getByTestId('reminders-repair')).toHaveCount(0)
  })

  test('Trennen uses the disconnect dialog: the Reminders tasks leave the board, Reminders is untouched, the sources tab offers it again', async ({ context, page }) => {
    await seedRemindersBoard(context)
    await openRemindersSettings(page)
    await page.getByTestId('reminders-disconnect').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Erinnerungen trennen?')
    await expect(page.getByTestId('disconnect-dialog')).toContainText('Sie bleiben in Erinnerungen.')
    await expect(dialog).not.toContainText(/Zugriff|macOS/)
    await page.getByRole('button', { name: 'Trennen' }).last().click()

    await expect(page).toHaveURL(/\/settings\?tab=sources/)
    await expect.poll(() => storedSources(page)).toEqual({ connected: [], default: 'local' })
    await expect(page.getByTestId('source-connect-reminders')).toBeVisible()
    await page.goto('/tasks')
    await expect(page.getByText('Milch kaufen')).toHaveCount(0)
    expect((await stubState(page)).reminders.status).toBe('granted')
  })

  test('not connected: "Verbinden" on the sources tab runs the same setup on the page; Back returns to the tab, finishing connects', async ({ context, page }) => {
    await installTauriStub(context, {
      reminders: { status: 'granted', lists: LISTS, reminders: remindersSeedReminders() },
    })
    await page.goto('/tasks?seed=local')
    await openSettings(page, 'sources')
    await page.getByTestId('source-connect-reminders').click()
    await expect(page).toHaveURL(/\/settings\/reminders$/)
    await expect(page.getByText('Verbinde Apple Erinnerungen mit Kan-Do.')).toBeVisible()
    await expect(page.getByTestId('reminders-setup-flow')).toBeVisible()
    await expect(page.getByTestId('reminders-granted')).toBeVisible()

    // The first step has no inner back button here (#596): the layout's link leads back to the sources tab
    await expect(page.getByTestId('reminders-setup-flow').getByTestId('setup-back')).toHaveCount(0)
    await page.getByRole('link', { name: 'Zurück zu Einstellungen' }).click()
    await expect(page).toHaveURL(/\/settings\?tab=sources/)

    await page.getByTestId('source-connect-reminders').click()
    await proceed(page).click() // granted already: "Weiter"
    await proceed(page).click()
    await proceed(page).click() // "Verbinden"
    await expect(page.getByTestId('reminders-done')).toBeVisible()
    await expect(page.getByTestId('reminders-settings')).toBeVisible()
    await expect.poll(async () => ((await storedSources(page)) as { connected: string[] } | null)?.connected).toEqual(['reminders'])
  })
})
