#!/usr/bin/env node
// Renders the icon's aircraft with the game's own procedural model (the Meridian in
// its Vintage Air-Racer livery) to scripts/icon/aircraft.png, a transparent image
// that skyrush-icon.svg places over the painted sky.
//
//   node scripts/icon/build-aircraft.mjs && node scripts/icon/render-icon.mjs
//
// AIRCRAFT_VIEW='yaw=125&bank=28' overrides the pose (see aircraft-shot.ts).
// SKYRUSH_CHROMIUM=/path/to/chrome uses a specific Chromium binary.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const POSE = 'yaw=122&bank=30&pitch=-20&distance=21.5&azimuth=10&elevation=22&throttle=0.75';
const view = process.env.AIRCRAFT_VIEW ? `${POSE}&${process.env.AIRCRAFT_VIEW}` : POSE;

const server = await createServer({ root, logLevel: 'error', server: { port: 0 } });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.SKYRUSH_CHROMIUM || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  page.on('pageerror', (error) => console.error(error));
  const url = new URL(`scripts/icon/aircraft-shot.html?${view}`, server.resolvedUrls.local[0]);
  await page.goto(url.href);
  await page.waitForFunction(() => globalThis.__shot, null, { timeout: 120_000 });
  const data = await page.evaluate(() => globalThis.__shot);
  await writeFile(resolve(here, 'aircraft.png'), Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote scripts/icon/aircraft.png');
} finally {
  await browser.close();
  await server.close();
}
