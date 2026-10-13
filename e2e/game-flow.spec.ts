import { expect, test } from '@playwright/test';
import {
  collectErrors,
  tap,
  getState,
  holdKeyForSimSeconds,
  openGame,
  seedProfile,
  startRaceFromMenu,
  waitForRacing,
  waitForSimSeconds,
} from './helpers';

test.describe('SKYRUSH core flow', () => {
  test('launches to the main menu without runtime errors', async ({ page }) => {
    const errors = collectErrors(page);
    await openGame(page);
    await expect(page.getByRole('heading', { name: 'SKYRUSH' })).toBeVisible();
    await expect(page.getByTestId('menu-race')).toBeVisible();
    await expect(page.getByTestId('menu-credits')).toHaveText('2,500');
    await expect(page.getByTestId('fatal')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('navigates to the garage and shows the installed build with performance values', async ({ page }) => {
    await openGame(page);
    await page.getByTestId('menu-garage').click();
    await expect(page.getByTestId('garage')).toBeVisible();
    await expect(page.getByTestId('part-fuselage-allrounder')).toHaveAttribute('data-status', 'installed');
    await expect(page.getByTestId('stat-topSpeed-value')).toHaveText(/\d+ km\/h/);
    await expect(page.getByTestId('stat-boost-value')).toHaveText(/\d+\.\d s/);
    await expect(page.getByTestId('garage-action')).toHaveText('Installed');
    await expect(page.getByTestId('garage-action')).toBeDisabled();
  });

  test('changing parts updates the performance panel and the installed build', async ({ page }) => {
    await seedProfile(page, {
      credits: 500,
      ownedParts: [
        'fuselage-allrounder',
        'engine-efficient',
        'wings-balanced',
        'wings-compact',
        'fuselage-needle',
      ],
    });
    await openGame(page);
    await page.getByTestId('menu-garage').click();
    const topSpeedBefore = await page.getByTestId('stat-topSpeed-value').textContent();
    const massBefore = await page.getByTestId('stat-mass').textContent();

    await page.getByTestId('garage-tab-wings').click();
    await page.getByTestId('part-wings-compact').click();
    // Highlighting an owned part previews the comparison before installing.
    await expect(page.getByTestId('garage-action')).toHaveText('Install');
    const topSpeedPreview = await page.getByTestId('stat-topSpeed-value').textContent();
    expect(topSpeedPreview).not.toEqual(topSpeedBefore);

    await page.getByTestId('garage-action').click();
    await expect(page.getByTestId('part-wings-compact')).toHaveAttribute('data-status', 'installed');
    await expect(page.getByTestId('garage-action')).toHaveText('Installed');
    expect(await page.getByTestId('stat-mass').textContent()).not.toEqual(massBefore);
    expect((await getState(page)).build.wings).toBe('wings-compact');

    // Fuselage swap changes stability and turning as well.
    await page.getByTestId('garage-tab-fuselage').click();
    await page.getByTestId('part-fuselage-needle').click();
    await page.getByTestId('garage-action').click();
    await expect(page.getByTestId('part-fuselage-needle')).toHaveAttribute('data-status', 'installed');
    expect((await getState(page)).build.fuselage).toBe('fuselage-needle');

    // The build persists across a reload.
    await page.reload();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    expect((await getState(page)).build).toMatchObject({
      fuselage: 'fuselage-needle',
      wings: 'wings-compact',
    });
  });

  test('purchases a component exactly once and explains locked parts', async ({ page }) => {
    await seedProfile(page, { credits: 2000 });
    await openGame(page);
    await page.getByTestId('menu-garage').click();
    await page.getByTestId('garage-tab-wings').click();
    await page.getByTestId('part-wings-compact').click();
    await expect(page.getByTestId('garage-action')).toHaveText(/Buy for 1,500 cr/);
    await page.getByTestId('garage-action').click();
    await expect(page.getByTestId('garage-credits')).toHaveText('500');
    await expect(page.getByTestId('part-wings-compact')).toHaveAttribute('data-status', 'installed');
    await expect(page.getByTestId('garage-action')).toHaveText('Installed');
    await expect(page.getByTestId('garage-action')).toBeDisabled();

    // Not enough credits for the next set.
    await page.getByTestId('part-wings-highlift').click();
    await expect(page.getByTestId('garage-action')).toBeDisabled();
    await expect(page.getByTestId('garage-note')).toContainText('Need 1,200 more credits');

    // Locked part explains its unlock condition.
    await page.getByTestId('garage-tab-engine').click();
    await page.getByTestId('part-engine-pulse').click();
    await expect(page.getByTestId('garage-action')).toHaveText('Locked');
    await expect(page.getByTestId('garage-note')).toContainText('podium');

    await page.reload();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await expect(page.getByTestId('menu-credits')).toHaveText('500');
  });

  test('enters a race with a countdown, live HUD and real-time flight', async ({ page }) => {
    const errors = collectErrors(page);
    await openGame(page);
    await startRaceFromMenu(page);
    await expect(page.getByTestId('hud-countdown')).toHaveText(/[123]/);
    await expect(page.getByTestId('hud-position')).toHaveText(/\d(st|nd|rd|th)/);
    await expect(page.getByTestId('hud-progress')).toHaveText('Gate 1 / 15');
    await waitForRacing(page);
    const before = await getState(page);
    await waitForSimSeconds(page, 1);
    const after = await getState(page);
    expect(after.race!.clock).toBeGreaterThan(before.race!.clock);
    expect(after.race!.z).toBeGreaterThan(before.race!.z); // flying forward along the opening straight
    await expect(page.getByTestId('hud-timer')).toHaveText(/00:0\d\.\d{3}/);
    expect(errors).toEqual([]);
  });

  test('keyboard flight controls change the aircraft state', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard controls are desktop-only');
    // ~7 s of simulated flight plus a restart countdown; software WebGL in CI runs the
    // simulation well below real time, so this needs more than the default 60 s.
    test.slow();
    await openGame(page);
    await startRaceFromMenu(page);
    await waitForRacing(page);

    // Pitch up: altitude climbs.
    const start = await getState(page);
    await holdKeyForSimSeconds(page, 'KeyW', 1.5);
    const climbed = await getState(page);
    expect(climbed.race!.y).toBeGreaterThan(start.race!.y + 5);

    // Bank right: the aircraft moves to the right of the opening straight (screen-right is -X).
    const beforeRight = await getState(page);
    await holdKeyForSimSeconds(page, 'KeyD', 2);
    const afterRight = await getState(page);
    expect(afterRight.race!.x).toBeLessThan(beforeRight.race!.x - 10);
    // Restart so the left turn also starts from the straight, then bank left.
    await page.keyboard.press('KeyR');
    await waitForRacing(page);
    const beforeLeft = await getState(page);
    await holdKeyForSimSeconds(page, 'KeyA', 2);
    const afterLeft = await getState(page);
    expect(afterLeft.race!.x).toBeGreaterThan(beforeLeft.race!.x + 10);

    // Airbrake: speed drops.
    const beforeBrake = await getState(page);
    await holdKeyForSimSeconds(page, 'Space', 1.5);
    const afterBrake = await getState(page);
    expect(afterBrake.race!.speed).toBeLessThan(beforeBrake.race!.speed);

    // Boost: reserve is consumed.
    const beforeBoost = await getState(page);
    await holdKeyForSimSeconds(page, 'ShiftLeft', 1.2);
    const afterBoost = await getState(page);
    expect(afterBoost.race!.boost).toBeLessThan(beforeBoost.race!.boost - 0.05);
    expect(afterBoost.race!.heat).toBeGreaterThan(beforeBoost.race!.heat);
  });

  test('pauses, resumes and restarts the race', async ({ page }) => {
    await openGame(page);
    await startRaceFromMenu(page);
    await waitForRacing(page);
    await waitForSimSeconds(page, 0.3);
    // Pause via a real touch tap on mobile and Escape on desktop; both are published controls.
    const pauseButton = page.getByTestId('touch-pause');
    if (await pauseButton.isVisible()) await tap(page, pauseButton);
    else await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause')).toBeVisible();
    const paused = await getState(page);
    expect(paused.race!.paused).toBe(true);
    await page.waitForTimeout(600);
    const stillPaused = await getState(page);
    expect(stillPaused.race!.clock).toBeCloseTo(paused.race!.clock, 5);

    await page.getByTestId('pause-resume').click();
    await expect(page.getByTestId('pause')).toBeHidden();
    await waitForSimSeconds(page, 0.3);
    expect((await getState(page)).race!.clock).toBeGreaterThan(paused.race!.clock);

    if (await pauseButton.isVisible()) await tap(page, pauseButton);
    else await page.keyboard.press('Escape');
    await page.getByTestId('pause-restart').click();
    await expect(page.getByTestId('pause')).toBeHidden();
    const restarted = await getState(page);
    expect(restarted.race!.phase).toBe('countdown');
    expect(restarted.race!.gatesPassed).toBe(0);
    expect(restarted.race!.clock).toBe(0);
  });

  test('completes a race through the test harness, shows results, rewards and persists progress', async ({
    page,
  }) => {
    await openGame(page);
    await startRaceFromMenu(page);
    await waitForRacing(page);
    await page.evaluate(() => window.__skyrushTest!.simulateToFinish());
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('results-position')).toHaveText(/\d(st|nd|rd|th)/);
    await expect(page.getByTestId('results-time')).toHaveText(/\d\d:\d\d\.\d{3}/);
    await expect(page.getByTestId('results-credits')).toHaveText(/\+[\d,]+/);
    await expect(page.getByTestId('results-standings').locator('tr')).toHaveCount(4);
    const state = await getState(page);
    expect(state.race!.finished).toBe(true);
    expect(state.race!.gatesPassed).toBe(15);
    expect(state.credits).toBeGreaterThan(2500);
    // Finishing a race unlocks the Tandem Twin for purchase.
    await expect(page.getByTestId('results-unlocks')).toContainText('Tandem Twin');

    // Race again without reloading: a fresh countdown.
    await page.getByTestId('results-again').click();
    await expect(page.getByTestId('hud')).toBeVisible();
    const again = await getState(page);
    expect(again.race!.phase).toBe('countdown');
    expect(again.race!.gatesPassed).toBe(0);

    // Back to the garage, and progress survives a reload.
    const pauseButton = page.getByTestId('touch-pause');
    if (await pauseButton.isVisible()) await pauseButton.click();
    else await page.keyboard.press('Escape');
    await page.getByTestId('pause-quit').click();
    await expect(page.getByTestId('garage')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await expect(page.getByTestId('menu-races')).toHaveText('1');
    expect((await getState(page)).credits).toBe(state.credits);
  });

  test('bonus rings score, refill boost and show in the HUD and results', async ({ page }) => {
    await openGame(page);
    await startRaceFromMenu(page);
    await waitForRacing(page);
    await page.evaluate(() => window.__skyrushTest!.approachRing(0, 120));
    await expect
      .poll(async () => (await getState(page)).race?.style.rings, { timeout: 30_000, intervals: [100] })
      .toBe(1);
    await expect(page.getByTestId('hud-rings')).toHaveText('◯ 1/6');
    await expect(page.getByTestId('hud-style')).not.toHaveText('0');

    await page.evaluate(() => window.__skyrushTest!.simulateToFinish());
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('results-highlights')).toContainText('1/6');
    await expect(page.getByTestId('results-next')).toBeVisible();
  });

  test('returning players go straight from the menu to the grid; Enter replays from results', async ({
    page,
  }) => {
    await seedProfile(page, { racesCompleted: 3 });
    await openGame(page);
    await page.getByTestId('menu-race').click();
    await expect(page.getByTestId('hud')).toBeVisible();
    await expect(page.getByTestId('briefing')).toBeHidden();
    await waitForRacing(page);
    await page.evaluate(() => window.__skyrushTest!.simulateToFinish());
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('results')).toBeHidden();
    const again = await getState(page);
    expect(again.screen).toBe('race');
    expect(again.race!.phase).toBe('countdown');
    expect(again.race!.style.score).toBe(0);
  });

  test('recovers from malformed saved data', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('skyrush.profile.v1', '{not json'));
    const errors = collectErrors(page);
    await openGame(page);
    await expect(page.getByTestId('menu-credits')).toHaveText('2,500');
    expect(errors).toEqual([]);
  });
});
