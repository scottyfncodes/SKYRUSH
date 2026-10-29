#!/usr/bin/env node
// Rasterizes scripts/icon/skyrush-icon.svg into the PNG app icons in public/.
//
//   node scripts/icon/render-icon.mjs [--preview <path.png>]
//
// Uses the Playwright-managed headless Chromium (no extra deps). Each size is
// rendered straight from the vector source so small sizes stay crisp.
// Variants are produced by injecting a transform/style into the SVG:
//   - maskable: subject scaled into the 80% safe zone, background untouched
//   - favicon:  detail layers hidden, aircraft enlarged for 32px legibility
// The aircraft itself is scripts/icon/aircraft.png (from build-aircraft.mjs),
// inlined into the SVG as a data URI before rendering.
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const outDir = resolve(root, 'public');
const aircraftPng = await readFile(resolve(here, 'aircraft.png'));
const svgSource = (await readFile(resolve(here, 'skyrush-icon.svg'), 'utf8')).replace(
  'href="aircraft.png"',
  `href="data:image/png;base64,${aircraftPng.toString('base64')}"`,
);

const previewArgIndex = process.argv.indexOf('--preview');
const previewPath = previewArgIndex > -1 ? resolve(process.argv[previewArgIndex + 1]) : null;

/** Scale the #subject-wrap group about the canvas centre. */
function withSubjectScale(svg, scale, dx = 0, dy = 0) {
  const t = `translate(${512 + dx} ${512 + dy}) scale(${scale}) translate(-512 -512)`;
  return svg.replace('<g id="subject-wrap">', `<g id="subject-wrap" transform="${t}">`);
}

function withStyle(svg, css) {
  return svg.replace('</svg>', `<style>${css}</style></svg>`);
}

const variants = {
  full: svgSource,
  maskable: withSubjectScale(svgSource, 0.8),
  favicon: withStyle(withSubjectScale(svgSource, 1.22, -20, 10), '.detail{display:none}'),
};

const outputs = [
  { file: 'skyrush-icon.png', size: 1024, variant: 'full' },
  { file: 'skyrush-icon-512.png', size: 512, variant: 'full' },
  { file: 'skyrush-icon-192.png', size: 192, variant: 'full' },
  { file: 'apple-touch-icon.png', size: 180, variant: 'full' },
  { file: 'skyrush-icon-maskable-512.png', size: 512, variant: 'maskable' },
  { file: 'favicon-32.png', size: 32, variant: 'favicon' },
];

const browser = await chromium.launch({ executablePath: process.env.SKYRUSH_CHROMIUM || undefined });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  async function renderSvg(svg, size) {
    await page.setViewportSize({ width: size, height: size });
    const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#000">${sized}</body></html>`,
    );
    return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size, height: size } });
  }

  await mkdir(outDir, { recursive: true });
  const rendered = {};
  for (const { file, size, variant } of outputs) {
    const png = await renderSvg(variants[variant], size);
    await writeFile(resolve(outDir, file), png);
    rendered[file] = png;
    console.log(`wrote public/${file} (${size}x${size}, ${(png.length / 1024).toFixed(1)} KB)`);
  }

  if (previewPath) {
    // Home-Screen-style contact sheet: master, iOS-masked tiles at several
    // sizes on a dark wallpaper, the maskable variant with its safe zone, and
    // the favicon at 1x and enlarged (pixelated) to judge legibility.
    const b64 = (f) => `data:image/png;base64,${rendered[f].toString('base64')}`;
    const tile = (src, px) =>
      `<div class="t"><img src="${src}" style="width:${px}px;height:${px}px;border-radius:${(px * 0.2237).toFixed(1)}px"><span>${px}px</span></div>`;
    const html = `<!doctype html><html><head><style>
      body{margin:0;width:1800px;height:1100px;font:600 18px system-ui,sans-serif;color:#cfd8ea;
        background:radial-gradient(circle at 70% 20%,#3b2a5e,#141826 55%,#07080d);display:flex;gap:48px;padding:40px;box-sizing:border-box}
      .master{width:1024px;height:1024px;flex:none}
      .col{display:flex;flex-direction:column;gap:28px}
      .row{display:flex;gap:28px;align-items:flex-end}
      .t{display:flex;flex-direction:column;align-items:center;gap:8px}
      .t img{box-shadow:0 6px 18px rgba(0,0,0,.45)}
      .mask{position:relative;width:256px;height:256px}
      .mask img{width:256px;height:256px}
      .mask i{position:absolute;inset:25.6px;border:2px dashed rgba(255,255,255,.8);border-radius:50%}
      .px{image-rendering:pixelated}
    </style></head><body>
      <img class="master" src="${b64('skyrush-icon.png')}">
      <div class="col">
        <div class="row">${tile(b64('skyrush-icon.png'), 180)}${tile(b64('skyrush-icon.png'), 120)}${tile(b64('skyrush-icon-192.png'), 76)}</div>
        <div class="row">${tile(b64('skyrush-icon-192.png'), 60)}${tile(b64('skyrush-icon-192.png'), 40)}${tile(b64('favicon-32.png'), 32)}
          <div class="t"><img class="px" src="${b64('favicon-32.png')}" style="width:128px;height:128px"><span>favicon x4</span></div></div>
        <div class="row"><div class="t"><div class="mask"><img src="${b64('skyrush-icon-maskable-512.png')}"><i></i></div><span>maskable + safe zone</span></div>
          <div class="t"><img src="${b64('skyrush-icon-maskable-512.png')}" style="width:150px;height:150px;border-radius:50%"><span>circle mask</span></div></div>
      </div></body></html>`;
    await page.setViewportSize({ width: 1800, height: 1100 });
    await page.setContent(html);
    await page.waitForLoadState('load');
    await mkdir(dirname(previewPath), { recursive: true });
    await writeFile(previewPath, await page.screenshot({ type: 'png' }));
    console.log(`wrote preview ${previewPath}`);
  }
} finally {
  await browser.close();
}
