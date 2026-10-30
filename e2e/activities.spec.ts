import { expect, test, type Page } from '@playwright/test';
import { collectErrors, openGame, seedProfile, tap } from './helpers';

interface ActivityState {
  screen: string;
  credits: number;
  licenceStars: number;
  discoveries: string[];
  activities: Record<string, { best: number | null; medal: number; runs: number }>;
  activity: null | {
    id: string;
    kind: string;
    phase: string;
    clock: number;
    score: number;
    condition: number;
    nextStop: number;
    carrying: boolean;
    found: number;
    inBox: boolean;
    altitude: number;
    speed: number;
  };
  race: null | { phase: string; circuitId: string };
}

const state = (page: Page) =>
  page.evaluate(() => window.__skyrushTest!.getState()) as unknown as Promise<ActivityState>;

/** Taps on touch devices and clicks elsewhere, so both input paths are exercised. */
const press = async (page: Page, testId: string, within?: string): Promise<void> => {
  const root = within ? page.getByTestId(within) : page;
  const target = root.getByTestId(testId).first();
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await tap(page, target);
  else await target.click();
};

const openBoard = async (page: Page): Promise<void> => {
  await press(page, 'menu-board');
  await expect(page.getByTestId('flight-board')).toBeVisible();
};

/** Opens a row on the board and flies it. */
const flyRow = async (page: Page, kind: string): Promise<void> => {
  await page.getByTestId(`board-row-${kind}`).locator('.board-row__summary').click();
  await expect(page.getByTestId(`board-row-${kind}`)).toHaveClass(/is-open/);
  await press(page, 'board-fly');
  await expect(page.getByTestId('hud')).toBeVisible();
};

const pause = async (page: Page): Promise<void> => {
  const pauseButton = page.getByTestId('touch-pause');
  if (await pauseButton.isVisible()) await pauseButton.click();
  else await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause')).toBeVisible();
};

test.describe('activities', () => {
  test('the flight board lists every activity in a region and follows the region picker', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await openGame(page);
    await openBoard(page);
    const rows = page.getByTestId('board-list').locator('.board-row');
    await expect(rows).toHaveCount(5);
    for (const kind of ['race', 'trial', 'show', 'precision', 'explore'])
      await expect(page.getByTestId(`board-row-${kind}`)).toBeVisible();
    // Opening a row shows its brief, medal targets and how well the aircraft suits it.
    await page.getByTestId('board-row-show').locator('.board-row__summary').click();
    await expect(page.getByTestId('board-row-show')).toContainText('Bronze');
    await expect(page.getByTestId('board-fit')).toContainText(/fit/);
    // The next region has a delivery instead of a show.
    await page.locator('.board-side .course-select__arrow').last().click();
    await expect(page.getByTestId('board-row-delivery')).toBeVisible();
    await expect(page.getByTestId('board-row-show')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('an air show runs on aerobatic controls, scores figures and awards a medal that persists', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await openGame(page);
    await openBoard(page);
    await flyRow(page, 'show');
    await expect.poll(async () => (await state(page)).activity?.phase, { timeout: 30_000 }).toBe('flying');
    await page.evaluate(() => window.__skyrushTest!.placeInShowBox());
    await page.evaluate(() => window.__skyrushTest!.simulateToFinish());
    await expect(page.getByTestId('activity-results')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('activity-value')).toHaveText(/[\d,]+/);
    const after = await state(page);
    const record = after.activities['caldera-ridge:show'];
    expect(record?.runs).toBe(1);
    expect(record?.best).toBeGreaterThan(0);
    expect(after.credits).toBeGreaterThan(2500);
    // The record survives a reload.
    await page.reload();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    expect((await state(page)).activities['caldera-ridge:show']?.runs).toBe(1);
    expect(errors).toEqual([]);
  });

  test('a delivery hooks the cargo, delivers it and earns a medal', async ({ page }) => {
    const errors = collectErrors(page);
    await seedProfile(page, { racesCompleted: 1 });
    await openGame(page);
    await openBoard(page);
    // Frostline Pass holds the Summit Relay.
    await page.locator('.board-side .course-select__arrow').last().click();
    await flyRow(page, 'delivery');
    await expect.poll(async () => (await state(page)).activity?.phase, { timeout: 30_000 }).toBe('flying');
    await expect(page.getByTestId('hud-wind')).toBeVisible();
    await page.evaluate(() => window.__skyrushTest!.simulateToFinish());
    await expect(page.getByTestId('activity-results')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('activity-medal')).toContainText(/medal/i);
    const record = (await state(page)).activities['frostline-pass:delivery'];
    expect(record?.medal).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('a time trial races a ghost and saves your lap as the next ghost', async ({ page }) => {
    const errors = collectErrors(page);
    await openGame(page);
    await openBoard(page);
    await flyRow(page, 'trial');
    await expect(page.getByTestId('hud-position')).toHaveText(/±0\.00|[+−]\d/);
    await expect.poll(async () => (await state(page)).race?.phase, { timeout: 30_000 }).toBe('racing');
    await page.evaluate(() => window.__skyrushTest!.simulateToFinish());
    await expect(page.getByTestId('activity-results')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('activity-highlights')).toContainText('club pace');
    const ghost = await page.evaluate(() => localStorage.getItem('skyrush.ghost.v1.caldera-ridge'));
    expect(ghost).not.toBeNull();
    // Trying again chases your own lap now.
    await press(page, 'activity-again');
    await expect(page.getByTestId('hud-progress')).toContainText('your best');
    expect(errors).toEqual([]);
  });

  test('a precision run ends on a miss or at the finish and reports accuracy', async ({ page }) => {
    const errors = collectErrors(page);
    await openGame(page);
    await openBoard(page);
    await flyRow(page, 'precision');
    await expect(page.getByTestId('hud-progress')).toContainText('Accuracy');
    await expect.poll(async () => (await state(page)).race?.phase, { timeout: 30_000 }).toBe('racing');
    await page.evaluate(() => window.__skyrushTest!.simulateToFinish());
    await expect(page.getByTestId('activity-results')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('activity-highlights')).toContainText('Accuracy');
    expect((await state(page)).activities['caldera-ridge:precision']?.runs).toBe(1);
    expect(errors).toEqual([]);
  });

  test('free flight ends from the pause menu and logs the flight', async ({ page }) => {
    const errors = collectErrors(page);
    await openGame(page);
    await openBoard(page);
    await flyRow(page, 'explore');
    await expect(page.getByTestId('hud-progress')).toHaveText('Discoveries');
    await pause(page);
    await expect(page.getByTestId('pause-quit')).toHaveText('End flight');
    await page.getByTestId('pause-quit').click();
    await expect(page.getByTestId('activity-results')).toBeVisible();
    await expect(page.getByTestId('activity-medal')).toContainText('Flight logged');
    await press(page, 'activity-board');
    await expect(page.getByTestId('flight-board')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('licence stars unlock the Starling biplane in the hangar', async ({ page }) => {
    await page.addInitScript(() => {
      if (window.localStorage.getItem('skyrush.e2e.seeded') === '1') return;
      window.localStorage.setItem('skyrush.e2e.seeded', '1');
      window.localStorage.setItem(
        'skyrush.profile.v1',
        JSON.stringify({
          version: 2,
          credits: 9000,
          ownedParts: [],
          activities: {
            'caldera-ridge:show': { best: 14000, medal: 3, runs: 2 },
            'caldera-ridge:trial': { best: 95, medal: 2, runs: 1 },
            'coral-coast:show': { best: 9000, medal: 2, runs: 1 },
          },
          discoveries: ['caldera:comet'],
        }),
      );
    });
    await openGame(page);
    expect((await state(page)).licenceStars).toBe(8);
    await expect(page.getByTestId('menu-licence')).toHaveText('8/56');
    await press(page, 'menu-garage');
    await expect(page.getByTestId('garage')).toBeVisible();
    await page.getByTestId('garage-tab-aircraft').click();
    await page.getByTestId('part-airframe-stunt').click();
    await expect(page.getByTestId('garage-action')).toHaveText(/Buy · 3,600 cr/);
    await page.getByTestId('garage-action').click();
    await expect(page.getByTestId('nameplate-name')).toHaveText('Starling');
  });

  test('the flight board fits the screen with thumb-sized targets', async ({ page }) => {
    await openGame(page);
    await openBoard(page);
    const viewport = page.viewportSize()!;
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
    for (const row of await page.locator('.board-row__summary').all()) {
      const box = (await row.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    const fly = (await page.getByTestId('board-fly').boundingBox())!;
    expect(fly.height).toBeGreaterThanOrEqual(44);
    expect(fly.y + fly.height).toBeLessThanOrEqual(viewport.height + 1);
  });
});
