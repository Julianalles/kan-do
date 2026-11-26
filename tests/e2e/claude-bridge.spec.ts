import { test, expect } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'
import { installTauriStub, stubState } from './helpers/tauriStub'

/** ADR 023: /settings/claude and the bridge loop against the stubbed desktop IPC (helpers/tauriStub.ts); nothing leaves the stub. */

const TOKEN = 'sync-token-abcdefghij'
const URL = 'https://kando-mcp.example.workers.dev'

test.describe('Claude connection (web)', () => {
  test('redirects to /tasks: there is no Keychain and no bridge on web', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/settings/claude')
    await expect(page).toHaveURL(/\/tasks$/)
  })
})

test.describe('Claude connection (desktop)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
  })

  test('empty state asks for address and token, refuses a bad address, and never shows the token afterwards', async ({ context, page }) => {
    await installTauriStub(context)
    await page.goto('/settings/claude')
    const empty = page.getByTestId('claude-bridge-empty')
    await expect(empty.getByRole('button', { name: 'Verbinden' })).toBeDisabled()

    await empty.getByLabel('Adresse des Workers').fill('http://localhost:3000')
    await empty.getByLabel('Token für Kan-do').fill(TOKEN)
    await empty.getByRole('button', { name: 'Verbinden' }).click()
    await expect(empty).toContainText('Gib eine Adresse wie')

    await empty.getByLabel('Adresse des Workers').fill(URL)
    await empty.getByRole('button', { name: 'Verbinden' }).click()
    const connected = page.getByTestId('claude-bridge-connected')
    await expect(connected).toContainText('kando-mcp.example.workers.dev')
    await expect(page.locator('body')).not.toContainText(TOKEN)

    const state = await stubState(page)
    expect(state.entries['mcp-sync-token']).toBe(TOKEN)
    expect(state.bridgeHost).toBe('kando-mcp.example.workers.dev')
  })

  test('switch off stops the loop, Trennen forgets address and token', async ({ context, page }) => {
    await installTauriStub(context)
    await page.goto('/settings/claude')
    await page.getByLabel('Adresse des Workers').fill(URL)
    await page.getByLabel('Token für Kan-do').fill(TOKEN)
    await page.getByRole('button', { name: 'Verbinden' }).click()
    const connected = page.getByTestId('claude-bridge-connected')
    await expect(connected).toBeVisible()

    await connected.getByRole('switch', { name: 'Anbindung aktiv' }).click()
    await expect(page.getByTestId('claude-bridge-status')).toContainText('ausgeschaltet')

    await connected.getByRole('button', { name: 'Trennen' }).click()
    await expect(page.getByTestId('claude-bridge-empty')).toBeVisible()
    const state = await stubState(page)
    expect(state.bridgeHost).toBeNull()
    expect(state.entries['mcp-sync-token']).toBeUndefined()
  })

  test('a queued command is applied once: the card moves to Jetzt, the result and the board go back', async ({ context, page }) => {
    await installTauriStub(context)
    await context.addInitScript(() => {
      ;(window as unknown as { __bridgeCommands: unknown[] }).__bridgeCommands = [
        { id: 'cmd-1', type: 'start_work', payload: { title: 'Konzept ausarbeiten' }, createdAt: 1 },
      ]
    })
    await page.goto('/settings/claude')
    await page.getByLabel('Adresse des Workers').fill(URL)
    await page.getByLabel('Token für Kan-do').fill(TOKEN)
    await page.getByRole('button', { name: 'Verbinden' }).click()
    await expect(page.getByTestId('claude-bridge-connected')).toBeVisible()

    const requests = async () => (await stubState(page)).calls
      .filter(call => call.cmd === 'bridge_request')
      .map(call => `${String(call.args.method)} ${String(call.args.path)}`)
    await expect.poll(requests).toContain('POST /sync/commands/cmd-1/result')
    await expect.poll(requests).toContain('PUT /sync/snapshot')

    await page.goto('/tasks')
    await expect(page.locator('#column-progress-list').getByText('Konzept ausarbeiten')).toBeVisible()
    // The Worker still lists the command (the stub never drops it): the next poll must not apply it again.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(async () => (await requests()).filter(r => r === 'POST /sync/commands/cmd-1/result').length).toBeGreaterThanOrEqual(1)
    await expect(page.locator('#column-progress-list .task-wrapper')).toHaveCount(1)
  })
})
