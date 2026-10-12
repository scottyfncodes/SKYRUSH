import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

/** Reads width/height from a PNG's IHDR chunk. */
const pngSize = (path: string): { width: number; height: number; colorType: number } => {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25]! };
};

const headLink = (rel: string): string | null => {
  const match = indexHtml.match(new RegExp(`<link[^>]*rel="${rel}"[^>]*href="([^"]+)"`));
  return match ? match[1]! : null;
};

describe('home screen and PWA icons', () => {
  const manifest = JSON.parse(readFileSync(join(publicDir, 'manifest.webmanifest'), 'utf8')) as {
    name: string;
    start_url: string;
    scope: string;
    display: string;
    orientation: string;
    icons: ManifestIcon[];
  };

  it('index.html links a favicon, an Apple touch icon and the manifest that all exist in public/', () => {
    for (const rel of ['icon', 'apple-touch-icon', 'manifest']) {
      const href = headLink(rel);
      expect(href, rel).not.toBeNull();
      // Root-absolute paths are rewritten by Vite with the /SKYRUSH/ base for files in public/.
      expect(href!.startsWith('/')).toBe(true);
      expect(existsSync(join(publicDir, href!.slice(1))), href!).toBe(true);
    }
    expect(indexHtml).toContain('name="apple-mobile-web-app-capable"');
    expect(indexHtml).not.toContain('data:image/svg+xml');
  });

  it('the Apple touch icon is an opaque 180×180 PNG (iOS renders transparency as black)', () => {
    const size = pngSize(join(publicDir, headLink('apple-touch-icon')!.slice(1)));
    expect(size).toMatchObject({ width: 180, height: 180 });
    // Colour type 2 = RGB, 6 = RGBA.
    expect(size.colorType).toBe(2);
  });

  it('the master icon is a square 1024×1024 PNG', () => {
    expect(pngSize(join(publicDir, 'skyrush-icon.png'))).toMatchObject({ width: 1024, height: 1024 });
  });

  it('manifest icons use paths relative to the manifest and match their declared sizes', () => {
    expect(manifest.name).toBe('SKYRUSH');
    // Relative so the app works from the GitHub Pages subpath.
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.orientation).toBe('landscape');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/')).toBe(false);
      expect(icon.src.includes('://')).toBe(false);
      const path = join(publicDir, icon.src);
      expect(existsSync(path), icon.src).toBe(true);
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(pngSize(path)).toMatchObject({ width, height });
      expect(icon.type).toBe('image/png');
    }
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose !== 'maskable')).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === '192x192')).toBe(true);
  });
});
