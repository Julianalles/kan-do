import { test, expect } from '@playwright/test';
import { seedLocalBoard } from './helpers/seed';

/** Statistik opens without a wait (#376): its route is preloaded in idle time, and a wait that remains shows a thin bar. */
test.describe('Statistik first open (#376)', () => {
  test('the route code is fetched in idle time, before any click', async ({ page, context }) => {
    await seedLocalBoard(context);
    const assets: string[] = [];
    page.on('request', r => assets.push(r.url()));
    await page.goto('/tasks');
    // TasksTable is imported by the statistics page only
    await expect.poll(() => assets.some(u => /TasksTable[^/]*\.css/.test(u)), { timeout: 15_000 }).toBe(true);
    await expect(page).toHaveURL(/\/tasks/);
  });

  test('a fast navigation shows no bar', async ({ page, context }) => {
    await seedLocalBoard(context);
    const assets: string[] = [];
    page.on('request', r => assets.push(r.url()));
    await page.goto('/tasks');
    await expect(page.getByTestId('app-nav-place-statistics')).toBeVisible();
    // The idle preload must be done: its statistics-only stylesheet is the last asset of the route
    await expect.poll(() => assets.some(u => /TasksTable[^/]*\.css/.test(u)), { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-testid="nav-loading"]')!;
      (window as unknown as { __barSeen: boolean }).__barSeen = false;
      new MutationObserver(() => { if (el.style.opacity === '1') (window as unknown as { __barSeen: boolean }).__barSeen = true; })
        .observe(el, { attributes: true, attributeFilter: ['style'] });
    });
    await page.getByTestId('app-nav-place-statistics').click();
    await expect(page.getByTestId('stats-verdict')).toBeVisible();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as { __barSeen: boolean }).__barSeen)).toBe(false);
  });

  test('a navigation that waits shows the bar until the page appears', async ({ page, context }) => {
    await seedLocalBoard(context);
    // No idle preload: the click has to fetch the route
    await page.addInitScript(() => { (window as unknown as { requestIdleCallback: unknown }).requestIdleCallback = () => 0; });
    await page.goto('/tasks');
    await expect(page.getByTestId('app-nav-place-statistics')).toBeVisible();
    await page.waitForTimeout(500);
    await page.route('**/_nuxt/*.js', async (route) => { await new Promise(r => setTimeout(r, 700)); await route.continue(); });
    await page.getByTestId('app-nav-place-statistics').click();
    const bar = page.getByTestId('nav-loading');
    await expect(bar).toHaveCSS('opacity', '1', { timeout: 5000 });
    await expect(bar).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByTestId('stats-verdict')).toBeVisible({ timeout: 15_000 });
    await expect(bar).toHaveCSS('opacity', '0');
  });
});
