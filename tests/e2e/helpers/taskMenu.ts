import type { Locator, Page } from '@playwright/test'

/**
 * The task sheet's ⋯ menu (#705): open in source, move to source and Delete live behind it, not in a footer row.
 * Nuxt UI's dropdown items carry no test id, so an item is found by its role and label.
 */
export const taskMenu = (page: Page): Locator => page.getByTestId('task-menu')

export const taskMenuItem = (page: Page, name: string | RegExp): Locator => page.getByRole('menuitem', { name, exact: typeof name === 'string' })

/** Opens the menu and returns the item with this label, once it shows. */
export async function openTaskMenu(page: Page, name: string | RegExp): Promise<Locator> {
  await taskMenu(page).click()
  const item = taskMenuItem(page, name)
  await item.waitFor()
  return item
}
