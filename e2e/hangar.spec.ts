import { expect, test } from '@playwright/test';
import { collectErrors, getState, openGame, openHangar, openSlot, seedProfile } from './helpers';

test.describe('hangar', () => {
  // Several model rebuilds per test; software WebGL in CI renders them slowly.
  test.beforeEach(() => {
    test.slow();
  });

  test('buys a new aircraft with a reveal, keeps the old one intact, and both survive a reload', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await seedProfile(page, { credits: 6000, racesCompleted: 1, ownedParts: ['wings-compact'] });
    await openGame(page);
    await openHangar(page);
    // Give the Meridian a non-factory wing first.
    await openSlot(page, 'wings');
    await page.getByTestId('part-wings-compact').click();
    await page.getByTestId('garage-action').click();
    await expect(page.getByTestId('part-wings-compact')).toHaveAttribute('data-status', 'installed');

    await page.getByTestId('garage-tab-aircraft').click();
    await page.getByTestId('part-airframe-bush').click();
    // Previewing an aircraft shows it before buying.
    await expect(page.getByTestId('nameplate-name')).toHaveText('Mule');
    await expect(page.getByTestId('garage-action')).toHaveText('Buy · 2,200 cr');
    await expect(page.getByTestId('garage-credits')).toHaveText('6,000');
    await page.getByTestId('garage-action').click();
    await expect(page.getByTestId('reveal')).toBeVisible();
    await expect(page.getByTestId('reveal')).toContainText('Mule');
    await page.getByTestId('reveal-close').click();
    await expect(page.getByTestId('reveal')).toBeHidden();
    await expect(page.getByTestId('garage-credits')).toHaveText('3,800');
    let state = await getState(page);
    expect(state.build.airframe).toBe('airframe-bush');
    expect(state.build.gear).toBe('gear-tundra');

    // Switching back finds the Meridian exactly as it was left.
    await page.getByTestId('part-airframe-sport').click();
    await expect(page.getByTestId('garage-action')).toHaveText('Fly the Meridian');
    await page.getByTestId('garage-action').click();
    state = await getState(page);
    expect(state.build).toMatchObject({ airframe: 'airframe-sport', wings: 'wings-compact' });

    await page.reload();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await expect(page.getByTestId('menu-aircraft')).toContainText('Meridian');
    state = await getState(page);
    expect(state.ownedParts).toContain('airframe-bush');
    expect(state.credits).toBe(3800);
    expect(state.build.wings).toBe('wings-compact');
    expect(errors).toEqual([]);
  });

  test('paint persists, never changes the flight card, and locked colours stay locked', async ({ page }) => {
    await openGame(page);
    await openHangar(page);
    const flightCard = async () => page.locator('.garage-stats').innerText();
    const before = await flightCard();
    await page.getByTestId('garage-tab-paint').click();
    await page.getByTestId('part-livery-rescue').click();
    await page.getByTestId('paint-slot-primary').click();
    await page.getByTestId('swatch-teal').click();
    await page.getByTestId('pattern-scallop').click();
    await page.getByTestId('number-up').click();
    await expect(page.getByTestId('paint-number')).toHaveText('22');
    expect(await flightCard()).toEqual(before);
    // Earned swatches need their badge.
    await page.getByTestId('paint-slot-accent').click();
    await page.getByTestId('swatch-neon').click();
    expect((await getState(page)).paint.accent).not.toBe('neon');

    await page.reload();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    const { paint } = await getState(page);
    expect(paint).toMatchObject({ primary: 'teal', pattern: 'scallop', number: 22 });
  });

  test('revert restores the aircraft as it was when the hangar opened', async ({ page }) => {
    await seedProfile(page, { credits: 5000 });
    await openGame(page);
    await openHangar(page);
    await openSlot(page, 'prop');
    await page.getByTestId('part-prop-four').click();
    await page.getByTestId('garage-action').click();
    await expect(page.getByTestId('part-prop-four')).toHaveAttribute('data-status', 'installed');
    await page.getByTestId('garage-revert').click();
    await expect(page.getByTestId('part-prop-three')).toHaveAttribute('data-status', 'installed');
    // Reverting never refunds or charges: the bought propeller stays owned.
    await expect(page.getByTestId('part-prop-four')).toHaveAttribute('data-status', 'owned');
    expect((await getState(page)).credits).toBe(4000);
  });

  test('saves a named setup and applies it again', async ({ page }) => {
    await seedProfile(page, { credits: 5000, ownedParts: ['wings-highlift', 'tail-big'] });
    await openGame(page);
    await openHangar(page);
    await openSlot(page, 'wings');
    await page.getByTestId('part-wings-highlift').click();
    await page.getByTestId('garage-action').click();
    await page.getByTestId('garage-tab-setups').click();
    await page.getByTestId('setup-name').fill('Slow and steady');
    await page.getByTestId('setup-save').click();
    await expect(page.locator('[data-testid^="setup-setup-"]')).toContainText('Slow and steady');

    // Change the wings back, then load the saved setup.
    await openSlot(page, 'wings');
    await page.getByTestId('part-wings-balanced').click();
    await page.getByTestId('garage-action').click();
    expect((await getState(page)).build.wings).toBe('wings-balanced');
    await page.getByTestId('garage-tab-setups').click();
    await page.locator('[data-testid^="setup-setup-"]').first().click();
    await page.getByTestId('garage-action').click();
    expect((await getState(page)).build.wings).toBe('wings-highlift');

    // Factory setups that need unbought parts cannot be applied.
    await page.getByTestId('setup-sport-club-racer').click();
    await expect(page.getByTestId('garage-action')).toBeDisabled();
  });

  test('a version 1 save opens with its build, livery and progress intact', async ({ page }) => {
    await seedProfile(page, {
      credits: 7777,
      racesCompleted: 4,
      ownedParts: [
        'fuselage-allrounder',
        'engine-efficient',
        'wings-balanced',
        'engine-twin',
        'fuselage-needle',
      ],
      legacyBuild: {
        fuselage: 'fuselage-allrounder',
        engine: 'engine-twin',
        wings: 'wings-balanced',
        livery: 'livery-glacier',
      },
    });
    await openGame(page);
    const state = await getState(page);
    expect(state.credits).toBe(7777);
    expect(state.build).toMatchObject({ airframe: 'airframe-sport', engine: 'engine-twin' });
    expect(state.paint.primary).toBe('ivory');
    expect(state.ownedParts).toContain('airframe-racer');
    await openHangar(page);
    await page.getByTestId('garage-tab-aircraft').click();
    await expect(page.getByTestId('part-airframe-racer')).toHaveAttribute('data-status', 'owned');
  });
});

test('swapping parts and aircraft repeatedly does not leak GPU memory', async ({ page }) => {
  test.slow();
  await seedProfile(page, {
    credits: 0,
    ownedParts: ['airframe-scout', 'wings-compact', 'wings-highlift', 'prop-four', 'tail-big'],
  });
  await openGame(page);
  await openHangar(page);
  const info = () => page.evaluate(() => window.__skyrushTest!.getRenderInfo());
  const cycle = async () => {
    await openSlot(page, 'wings');
    for (const id of ['wings-compact', 'wings-highlift', 'wings-balanced'])
      await page.getByTestId(`part-${id}`).click();
    await openSlot(page, 'prop');
    for (const id of ['prop-four', 'prop-three']) await page.getByTestId(`part-${id}`).click();
    await page.getByTestId('garage-tab-aircraft').click();
    await page.getByTestId('part-airframe-scout').click();
    await page.getByTestId('part-airframe-sport').click();
    await page.waitForTimeout(200);
  };
  await cycle();
  const baseline = await info();
  for (let i = 0; i < 4; i += 1) await cycle();
  const after = await info();
  expect(after.geometries).toBeLessThanOrEqual(baseline.geometries + 2);
  expect(after.textures).toBeLessThanOrEqual(baseline.textures + 1);
});
