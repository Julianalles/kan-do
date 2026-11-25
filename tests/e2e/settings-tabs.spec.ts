import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, SEED_TASKS } from './helpers/seed'
import { installTauriStub } from './helpers/tauriStub'
import { openSettings } from './helpers/appNav'

/** #691: Einstellungen is a tab strip of three groups (Board, Speicherorte, System); the tab lives in `?tab=`. */

const tab = (page: Page, name: string) => page.getByRole('tab', { name })
const tabNames = (page: Page) => page.getByRole('tab').allTextContents()

/** No card in Jetzt: a restarted "Start" is not answered at once by a step that is already done */
const OPEN_ONLY = SEED_TASKS.filter(task => task.status === 0)
/** A restarted record: cards in Offen are a planned day, so "Planen" (#803) is answered at once by its step; nothing else is touched */
const RESTARTED = { on: true, quietDay: null, hints: { planen: { answered: true, days: [] } } }
const hintsRow = (page: Page) => page.getByTestId('intro-hints-setting')
const hintsButton = (page: Page) => page.getByTestId('intro-hints-toggle')
const hintsRecord = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('settings-store') ?? '{}') as { introHints?: unknown }).introHints ?? null)

test.describe('Hinweise zum Einstieg in the Board tab (#804)', () => {
  test('the row names the state: "Ausschalten" turns the hints off with a toast, "Erneut zeigen" starts them from the first', async ({ context, page }) => {
    await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true, once: true })
    await page.goto('/settings')
    await expect(hintsRow(page)).toContainText('Hinweise zum Einstieg')
    await expect(hintsRow(page)).toContainText('Kurze Hinweise auf dem Board zeigen dir den nächsten Schritt.')
    await expect(hintsButton(page)).toHaveText('Ausschalten')

    await hintsButton(page).click()
    await expect(hintsButton(page)).toHaveText('Erneut zeigen')
    // The toast confirms it and says where the intros are read
    await expect(page.getByText('Hinweise ausgeschaltet', { exact: true })).toBeVisible()
    await expect(page.getByText('Du kannst sie jederzeit unter Einstellungen, Board nachlesen.', { exact: true })).toBeVisible()
    await expect.poll(async () => (await hintsRecord(page) as { on: boolean }).on).toBe(false)

    await hintsButton(page).click()
    await expect(hintsButton(page)).toHaveText('Ausschalten')
    await expect.poll(() => hintsRecord(page)).toEqual(RESTARTED)
  })

  test('the help lists exactly the intro texts, on or off, with the phone text of "Start" at 390px', async ({ context, page }) => {
    await seedLocalBoard(context, undefined, {}, undefined, { hints: true, once: true })
    await page.goto('/settings')
    const list = page.getByTestId('intro-hints-help-list')
    await expect(list.locator('li')).toHaveCount(5)
    await expect(list).toContainText('Ziehe in „Jetzt“, woran du gerade arbeitest.')
    await expect(list).toContainText('Die Zeit läuft jetzt mit.')
    await expect(list).toContainText('Viel offen? Gestapelt nach Thema oder Priorität wählst du leichter aus. Die Stapel findest du auch unter „Mehr“.')
    await expect(list).toContainText('Genug für heute? „Tag abschließen“ zeigt dir, was du geschafft hast und was offen bleibt.')
    // the planning note of "Alle" in its own words (#741): the desktop sentence here, the phone's one line below
    await expect(list).toContainText('Der Pfeil an einer Karte plant sie für heute ein. Wechsle zu „Heute“, sobald du loslegen willst.')
    await hintsButton(page).click()
    await expect(list.locator('li')).toHaveCount(5)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(list).toContainText('Halte die Karte und ziehe sie an den rechten Rand, in „Jetzt“.')
    await expect(list).toContainText('Wähle aus, was heute dran ist. Wechsle zu „Heute“, sobald du loslegen willst.')
    const button = (await hintsButton(page).boundingBox())!
    expect(button.height).toBeGreaterThanOrEqual(44)
  })

  test('an install from before the hints has no record: the row offers "Erneut zeigen", which starts them', async ({ context, page }) => {
    await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { once: true })
    await page.goto('/settings')
    expect(await hintsRecord(page)).toBeNull()
    await expect(hintsButton(page)).toHaveText('Erneut zeigen')
    await hintsButton(page).click()
    await expect.poll(() => hintsRecord(page)).toEqual(RESTARTED)
    await expect(hintsButton(page)).toHaveText('Ausschalten')
  })
})

test.describe('Einstellungen tabs (#691)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
  })

  test('three tabs in order, Board active by default and holding Fokus and the hints, nothing of the other groups', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page)
    expect((await tabNames(page)).map(n => n.trim())).toEqual(['Board', 'Speicherorte', 'System'])
    await expect(tab(page, 'Board')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('focus-switch')).toBeVisible()
    await expect(page.getByTestId('sources-connected')).toHaveCount(0)
    await expect(page.getByTestId('settings-subpages')).toHaveCount(0)
  })

  test('the Board tab holds the Arbeitszeit select under Fokus: Automatisch by default, 1 h to 12 h in half-hour steps (#306)', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page)
    const select = page.getByTestId('working-hours-select')
    await expect(select).toContainText('Automatisch')
    await expect(page.getByRole('combobox', { name: 'Arbeitszeit pro Tag' })).toBeVisible()
    await select.click()
    const options = page.getByRole('option')
    await expect(options).toHaveCount(24)
    await expect(options.nth(0)).toHaveText('Automatisch')
    await expect(options.nth(1)).toHaveText('1 h')
    await expect(options.nth(2)).toHaveText('1,5 h')
    await expect(options.nth(23)).toHaveText('12 h')
    await page.keyboard.press('Escape')
    const fokus = (await page.getByTestId('focus-switch').boundingBox())!
    expect((await select.boundingBox())!.y).toBeGreaterThan(fokus.y)
  })

  test('each group shows its own content; the tab is in the URL, an unknown tab falls back to Board', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page, 'sources')
    await expect(page.getByTestId('sources-connected')).toBeVisible()
    await expect(page.getByTestId('sources-more')).toBeVisible()
    await expect(page.getByTestId('focus-switch')).toHaveCount(0)

    await openSettings(page, 'manage')
    const links = page.getByTestId('settings-subpage-link-label')
    await expect(links).toHaveText(['Themen und Aktivitäten', 'Daten & Speicher'])
    await expect(page.getByTestId('settings-tab-lead')).toContainText('Themen und Daten pflegst du hier')

    await page.goto('/settings?tab=nonsense')
    await expect(tab(page, 'Board')).toHaveAttribute('aria-selected', 'true')
    await page.goto('/settings?tab=manage')
    await expect(tab(page, 'System')).toHaveAttribute('aria-selected', 'true')
  })

  test('back from a sub-page returns to the tab it was opened from', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page, 'manage')
    await page.getByRole('link', { name: /Daten & Speicher/ }).click()
    await expect(page).toHaveURL(/\/settings\/data$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/settings\?tab=manage$/)
    await expect(tab(page, 'System')).toHaveAttribute('aria-selected', 'true')
  })

  test('leaving a sub-page through the app bar restores its tab', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page, 'manage')
    await page.getByRole('link', { name: /Daten & Speicher/ }).click()
    await expect(page).toHaveURL(/\/settings\/data$/)
    await page.getByTestId('app-nav-place-more').click()
    await expect(page).toHaveURL(/\/settings\?tab=manage$/)
    await expect(tab(page, 'System')).toHaveAttribute('aria-selected', 'true')
  })

  test('a tab click adds no history entry', async ({ page }) => {
    await page.goto('/settings')
    const before = await page.evaluate(() => history.length)
    await tab(page, 'Speicherorte').click()
    await tab(page, 'System').click()
    expect(await page.evaluate(() => history.length)).toBe(before)
  })

  test('keyboard: arrow keys move between the tabs', async ({ page }) => {
    await page.goto('/settings')
    await tab(page, 'Board').focus()
    await page.keyboard.press('ArrowRight')
    await expect(tab(page, 'Speicherorte')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/tab=manage$/)
  })

  test.describe('390 px', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('all three labels are visible without horizontal scroll', async ({ page }) => {
      await page.goto('/settings')
      for (const name of ['Board', 'Speicherorte', 'System']) await expect(tab(page, name)).toBeInViewport({ ratio: 1 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  })
})

test.describe('Einstellungen tabs, desktop app (#691)', () => {
  test('System ends with Rechtliches: Impressum, Datenschutz, Nutzungsbedingungen and the no-affiliation line (#745)', async ({ context, page }) => {
    // Without a board the settings page redirects to /welcome (#821)
    await seedLocalBoard(context)
    await page.goto('/settings?tab=manage')
    const legal = page.getByTestId('legal-settings')
    await expect(legal.getByRole('heading', { name: 'Rechtliches', level: 2 })).toBeVisible()
    const nav = legal.getByRole('navigation', { name: 'Rechtliche Hinweise' })
    await expect(nav.getByRole('link')).toHaveText(['Impressum', 'Datenschutz', 'Nutzungsbedingungen'])
    await expect(nav.getByRole('link', { name: 'Impressum' })).toHaveAttribute('href', /^https:\/\/[^/]+\/impressum\/$/)
    await expect(legal.getByTestId('legal-no-affiliation')).toHaveText('Notion ist eine Marke von Notion Labs, Inc. Todoist ist eine Marke von Doist. Kan-do ist mit keinem der beiden Unternehmen verbunden.')
  })

  test('System also holds Updates and GitHub-Zugriff, each opening its page', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context)
    await page.goto('/settings?tab=manage')
    await expect(page.getByTestId('settings-tab-lead')).toContainText('Updates und Zugriffe')
    await expect(page.getByTestId('settings-subpage-link-label')).toHaveText(['Themen und Aktivitäten', 'Daten & Speicher', 'Updates', 'GitHub-Zugriff'])
    await page.getByRole('link', { name: /^Updates/ }).click()
    await expect(page).toHaveURL(/\/settings\/updates$/)
    await page.goBack()
    await page.getByRole('link', { name: /GitHub-Zugriff/ }).click()
    await expect(page).toHaveURL(/\/settings\/github$/)
  })
})
