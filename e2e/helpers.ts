import { expect, type Locator, type Page } from '@playwright/test';

export interface SeedProfile {
  credits?: number;
  ownedParts?: string[];
  build?: { fuselage: string; engine: string; wings: string; livery: string };
  racesCompleted?: number;
  podiums?: number;
  wins?: number;
  bestTime?: number | null;
}

/** Writes a profile into localStorage before the app boots. */
export const seedProfile = async (page: Page, seed: SeedProfile): Promise<void> => {
  await page.addInitScript((data: SeedProfile) => {
    // Seed once per browser context so reloads exercise real persistence.
    if (window.localStorage.getItem('skyrush.e2e.seeded') === '1') return;
    window.localStorage.setItem('skyrush.e2e.seeded', '1');
    const profile = {
      version: 1,
      credits: data.credits ?? 2500,
      ownedParts: data.ownedParts ?? ['fuselage-allrounder', 'engine-efficient', 'wings-balanced'],
      build: data.build ?? {
        fuselage: 'fuselage-allrounder',
        engine: 'engine-efficient',
        wings: 'wings-balanced',
        livery: 'livery-ember',
      },
      bestTime: data.bestTime ?? null,
      bestTimeBuild: null,
      racesCompleted: data.racesCompleted ?? 0,
      podiums: data.podiums ?? 0,
      wins: data.wins ?? 0,
      history: [],
      settings: { assist: 0.6, invertPitch: false, audio: false, sensitivity: 1 },
    };
    window.localStorage.setItem('skyrush.profile.v1', JSON.stringify(profile));
  }, seed);
};

export const collectErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
};

export const openGame = async (page: Page): Promise<void> => {
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 20_000 });
};

export interface RaceState {
  phase: string;
  clock: number;
  nextGate: number;
  gatesPassed: number;
  position: number;
  finished: boolean;
  speed: number;
  altitude: number;
  boost: number;
  heat: number;
  paused: boolean;
  x: number;
  y: number;
  z: number;
  style: { score: number; rings: number; multiplier: number; chain: number };
}

export const getState = async (page: Page) =>
  page.evaluate(() => window.__skyrushTest!.getState()) as Promise<{
    screen: string;
    credits: number;
    build: { fuselage: string; engine: string; wings: string; livery: string };
    race: RaceState | null;
  }>;

export const startRaceFromMenu = async (page: Page): Promise<void> => {
  await page.getByTestId('menu-race').click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await page.getByTestId('briefing-start').click();
  await expect(page.getByTestId('hud')).toBeVisible();
};

/** Waits until the countdown has finished and the race clock is running. */
export const waitForRacing = async (page: Page): Promise<void> => {
  await expect.poll(async () => (await getState(page)).race?.phase, { timeout: 30_000 }).toBe('racing');
};

/** Advances until the race clock has moved by `seconds` of simulated time (frame rate independent). */
export const waitForSimSeconds = async (page: Page, seconds: number): Promise<void> => {
  const start = (await getState(page)).race?.clock ?? 0;
  await expect
    .poll(async () => (await getState(page)).race?.clock ?? 0, { timeout: 60_000, intervals: [100] })
    .toBeGreaterThan(start + seconds);
};

/** Holds a key for a given amount of simulated race time. */
export const holdKeyForSimSeconds = async (page: Page, key: string, seconds: number): Promise<void> => {
  await page.keyboard.down(key);
  try {
    await waitForSimSeconds(page, seconds);
  } finally {
    await page.keyboard.up(key);
  }
};

/** Taps with real touch events (touchstart/touchend), unlike locator.click() which uses the mouse. */
export const tap = async (page: Page, locator: Locator): Promise<void> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Cannot tap an element without a bounding box');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
};
