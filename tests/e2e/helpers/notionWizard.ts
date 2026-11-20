/**
 * @module notionWizard
 * @description Drives the Notion setup flow (intro, token, database, properties, further properties, status) on the Notion stub, for the specs
 * that end a flow with a real connection (the welcome page's "In Notion", the settings stage's "Verbinden", #324, #652).
 */

import { expect, type Page } from '@playwright/test'
import { notionStubSessionToken } from './seed'

/**
 * Enters a stub token and presses "Weiter" and finally "Verbinden" until the setup is gone (the welcome page and the stage of /settings/notion run the same flow, #652). Every press waits for
 * the step to change first (the token and database steps validate against the stub before they advance), so
 * no step is pressed twice. The stub's defaults need no input beyond the token.
 *
 * "Weiter" on the properties step stays disabled until the schema is auto-mapped (#358), so waiting for the
 * enabled button is enough. `pauseMs` waits that long after each step has arrived, like a person reading it (the motion guard: a press during the pane's 300 ms height motion is not a flow a person does). The current step is the `aria-current` item of the flow's rail.
 */
export async function completeNotionWizard(page: Page, token: string = notionStubSessionToken(), options: { pauseMs?: number } = {}): Promise<void> {
  const flow = page.getByTestId('notion-setup-flow')
  const proceed = page.getByTestId('wizard-proceed')
  const currentStep = flow.locator('[aria-current="step"]').first()

  // A setup run starts with the intro "Vorbereitung" (#441); the repair of a broken connection starts at the token step
  // (detected by the current step, not by the button label: "Weiter" is also the token step's button)
  if ((await currentStep.innerText().catch(() => '')).includes('Vorbereitung')) await proceed.click()
  await flow.getByPlaceholder('Integrationstoken eingeben').fill(token)
  for (let press = 0; press < 16; press++) {
    await expect(proceed).toBeEnabled()
    const isLastStep = (await proceed.innerText()).trim() === 'Verbinden'
    const before = await currentStep.innerText()
    await proceed.click()
    if (isLastStep) break
    await expect(currentStep).not.toHaveText(before, { useInnerText: true })
    if (options.pauseMs) await page.waitForTimeout(options.pauseMs)
  }
  await expect(flow).toHaveCount(0, { timeout: 10_000 })
}
