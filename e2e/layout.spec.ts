import { expect, test, type Locator, type Page } from '@playwright/test';
import { getState, openGame, startRaceFromMenu, waitForRacing } from './helpers';

const expectInsideViewport = async (page: Page, locator: Locator, label: string): Promise<void> => {
  const viewport = page.viewportSize()!;
  const box = await locator.boundingBox();
  expect(box, `${label} should be rendered`).not.toBeNull();
  expect(box!.x, `${label} left edge`).toBeGreaterThanOrEqual(-1);
  expect(box!.y, `${label} top edge`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${label} right edge`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height, `${label} bottom edge`).toBeLessThanOrEqual(viewport.height + 1);
};

const expectNoOverlap = async (a: Locator, b: Locator, label: string): Promise<void> => {
  const boxA = await a.boundingBox();
  const boxB = await b.boundingBox();
  expect(boxA).not.toBeNull();
  expect(boxB).not.toBeNull();
  const overlaps =
    boxA!.x < boxB!.x + boxB!.width &&
    boxA!.x + boxA!.width > boxB!.x &&
    boxA!.y < boxB!.y + boxB!.height &&
    boxA!.y + boxA!.height > boxB!.y;
  expect(overlaps, `${label} should not overlap`).toBe(false);
};

test.describe('responsive layout', () => {
  test('menu and garage fit the viewport without horizontal scroll', async ({ page }) => {
    await openGame(page);
    await expectInsideViewport(page, page.getByTestId('menu-race'), 'race button');
    await expectInsideViewport(page, page.getByTestId('menu-credits'), 'credits');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByTestId('menu-garage').click();
    await expectInsideViewport(page, page.getByTestId('garage-tab-setups'), 'setups tab');
    await expectInsideViewport(page, page.getByTestId('garage-race'), 'garage race button');
    await expectInsideViewport(page, page.getByTestId('garage-action'), 'garage action');
    await expectInsideViewport(page, page.getByTestId('stat-topSpeed-value'), 'top speed stat');
    await expectInsideViewport(page, page.getByTestId('nameplate-name'), 'aircraft name');
    await expectNoOverlap(
      page.getByTestId('garage-tab-gear'),
      page.getByTestId('part-engine-efficient'),
      'slots and part list',
    );
    // Section and slot labels are not clipped.
    for (const tab of ['aircraft', 'parts', 'paint', 'setups']) {
      const clipped = await page
        .getByTestId(`garage-tab-${tab}`)
        .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(clipped, `${tab} tab label clipped`).toBe(false);
    }
    // Every section keeps the page free of horizontal scroll, and touch targets stay comfortable.
    for (const section of ['aircraft', 'paint', 'setups']) {
      await page.getByTestId(`garage-tab-${section}`).click();
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(sideways, section).toBeLessThanOrEqual(0);
    }
    for (const id of ['swatch-ivory', 'pattern-plain', 'number-up']) {
      await page.getByTestId('garage-tab-paint').click();
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(Math.min(box.width, box.height), `${id} target`).toBeGreaterThanOrEqual(32);
    }
  });

  test('garage panels do not overlap on a narrow landscape phone', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone layout only');
    await page.setViewportSize({ width: 812, height: 375 });
    await openGame(page);
    await page.getByTestId('menu-garage').click();
    await expect(page.getByTestId('garage')).toBeVisible();
    const detail = page.locator('.garage-detail');
    await expectNoOverlap(detail, page.locator('.garage-right'), 'detail and performance panel');
    await expectNoOverlap(detail, page.locator('.garage-left'), 'detail and part list');
    await expectInsideViewport(page, page.getByTestId('garage-race'), 'race button');
  });

  test('race HUD and controls are visible and well separated', async ({ page, isMobile }) => {
    await openGame(page);
    await startRaceFromMenu(page);
    await waitForRacing(page);
    for (const id of ['hud-position', 'hud-timer', 'hud-gate', 'hud-speed', 'hud-boost', 'hud-heat']) {
      await expect(page.getByTestId(id)).toBeVisible();
      await expectInsideViewport(page, page.getByTestId(id), id);
    }
    await expectNoOverlap(page.getByTestId('hud-speed'), page.getByTestId('hud-boost'), 'speed and boost');
    await expectNoOverlap(page.getByTestId('hud-timer'), page.getByTestId('hud-gate'), 'timer and gate');
    // The combo meter sits under the timer and clear of the corner panels.
    const combo = page.locator('.hud-style');
    await expect(combo).toBeVisible();
    await expectInsideViewport(page, combo, 'combo meter');
    await expectNoOverlap(combo, page.getByTestId('hud-timer'), 'combo and timer');
    await expectNoOverlap(combo, page.getByTestId('hud-gate'), 'combo and gate');
    await expectNoOverlap(combo, page.getByTestId('hud-position'), 'combo and position');
    await expectNoOverlap(combo, page.getByTestId('hud-speed'), 'combo and speed');

    const touch = page.getByTestId('touch-controls');
    if (isMobile) {
      await expect(touch).toBeVisible();
      for (const id of ['touch-stick', 'touch-throttle', 'touch-boost', 'touch-brake', 'touch-pause']) {
        await expect(page.getByTestId(id)).toBeVisible();
        await expectInsideViewport(page, page.getByTestId(id), id);
        const box = await page.getByTestId(id).boundingBox();
        expect(Math.min(box!.width, box!.height), `${id} touch target size`).toBeGreaterThanOrEqual(44);
      }
      await expectNoOverlap(
        page.getByTestId('touch-stick'),
        page.getByTestId('hud-boost'),
        'stick and meters',
      );
      await expectNoOverlap(
        page.getByTestId('touch-boost'),
        page.getByTestId('hud-boost'),
        'boost button and meters',
      );
      await expectNoOverlap(
        page.getByTestId('touch-pause'),
        page.getByTestId('hud-gate'),
        'pause and gate panel',
      );
      await expectNoOverlap(
        page.getByTestId('touch-pause'),
        page.getByTestId('hud-speed'),
        'pause and speed',
      );
      await expectNoOverlap(page.getByTestId('touch-pause'), combo, 'pause and combo');
      await expect(page.getByTestId('rotate-prompt')).toBeHidden();
    } else {
      await expect(touch).toBeHidden();
    }
  });

  test('touch controls fly the aircraft on mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'touch-only');
    await openGame(page);
    await startRaceFromMenu(page);
    await waitForRacing(page);
    const stick = page.getByTestId('touch-stick');
    const box = (await stick.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const before = await page.evaluate(() => window.__skyrushTest!.getState().race!.y);
    // Hold the stick up (pitch up) for a moment using a touchscreen gesture.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: cx, y: cy - box.height * 0.45 }],
    });
    const startClock = (await getState(page)).race!.clock;
    await expect
      .poll(async () => (await getState(page)).race!.clock, { timeout: 60_000, intervals: [100] })
      .toBeGreaterThan(startClock + 1.5);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await page.evaluate(() => window.__skyrushTest!.getState().race!.y);
    expect(after).toBeGreaterThan(before + 5);

    // Stick right banks and turns right: the aircraft drifts toward -X (screen-right).
    const beforeRight = await getState(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: cx + box.width * 0.45, y: cy }],
    });
    await expect
      .poll(async () => (await getState(page)).race!.clock, { timeout: 60_000, intervals: [100] })
      .toBeGreaterThan(beforeRight.race!.clock + 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const afterRight = await getState(page);
    expect(afterRight.race!.x).toBeLessThan(beforeRight.race!.x - 10);
    // Releasing the stick recentres the knob (no stuck input).
    const knobTransform = await stick
      .locator('.touch-stick__knob')
      .evaluate((el) => getComputedStyle(el).transform);
    expect(knobTransform === 'none' || knobTransform === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
  });

  test('pause and results dialogs fit on screen', async ({ page }) => {
    await openGame(page);
    await startRaceFromMenu(page);
    await waitForRacing(page);
    await page.evaluate(() => window.__skyrushTest!.simulateToFinish());
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 15_000 });
    await expectInsideViewport(page, page.getByTestId('results-position'), 'results position');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Replay is reachable without scrolling, even on a short landscape phone.
    await expectInsideViewport(page, page.getByTestId('results-again'), 'race again button');
    await expectInsideViewport(page, page.getByTestId('results-highlights'), 'run highlights');
  });
});
