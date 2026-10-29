import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import type { Paint } from '../../aircraft/paint';
import { swatchColor } from '../../aircraft/paint';
import type { FramePart } from '../../aircraft/parts';

/**
 * Paints the fuselage livery onto a canvas laid out in the body's UV space:
 * x runs round the fuselage (0 bottom, ¼ left, ½ top, ¾ right) and y runs nose
 * (top) to tail (bottom), linear in metres along the body.
 */

export const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

const luminance = (color: number): number => {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/** Ink or ivory, whichever reads on the given colour. */
export const contrastOn = (color: number): string => (luminance(color) > 0.55 ? '#17233b' : '#f1e8d4');

export interface BodyLiveryOptions {
  paint: Paint;
  frame: FramePart['visual'];
  /** Body length (m) and circumference at its widest (m). */
  length: number;
  circumference: number;
  /** Registration text painted on the rear fuselage. */
  registration: string;
  /** Where (0..1 along the body) the canopy sits, for victory marks and the pilot stencil. */
  canopyV: number;
  /** Whether a nose engine leaves exhaust stains along the cowl line. */
  exhaustStains: boolean;
  /** Wins, painted as small gate marks under the canopy. */
  marks: number;
}

const W = 512;
const H = 1024;

export const createBodyTexture = (options: BodyLiveryOptions): Texture => {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (ctx) paintBody(ctx, options);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

const paintBody = (ctx: CanvasRenderingContext2D, o: BodyLiveryOptions): void => {
  const { paint } = o;
  const primary = swatchColor(paint.primary);
  const secondary = hex(swatchColor(paint.secondary));
  const accent = hex(swatchColor(paint.accent));
  const nose = hex(swatchColor(paint.nose));
  const px = (u: number) => u * W;
  const py = (v: number) => v * H;
  /** Fills a u-range on both sides symmetrically about the top (u = 0.5). */
  const sideBand = (u0: number, u1: number, v0: number, v1: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(px(u0), py(v0), px(u1 - u0), py(v1 - v0));
    ctx.fillRect(px(1 - u1), py(v0), px(u1 - u0), py(v1 - v0));
  };

  ctx.fillStyle = hex(primary);
  ctx.fillRect(0, 0, W, H);

  // Belly: secondary underside on every scheme.
  const belly = paint.pattern === 'split' ? 0.21 : 0.1;
  ctx.fillStyle = secondary;
  ctx.fillRect(0, 0, px(belly), H);
  ctx.fillRect(px(1 - belly), 0, px(belly), H);

  switch (paint.pattern) {
    case 'split':
      // Accent pinstripe along the colour break.
      sideBand(belly, belly + 0.012, 0, 1, accent);
      break;
    case 'cheatline':
      sideBand(0.235, 0.275, 0.02, 0.97, accent);
      sideBand(0.226, 0.232, 0.02, 0.97, secondary);
      sideBand(0.278, 0.284, 0.02, 0.97, secondary);
      break;
    case 'checker': {
      const rows = 3;
      const cols = 16;
      const band = 0.11;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          ctx.fillStyle = (r + c) % 2 === 0 ? accent : hex(primary);
          ctx.fillRect(px(c / cols), py((r * band) / rows), px(1 / cols) + 1, py(band / rows) + 1);
        }
      }
      ctx.fillStyle = secondary;
      ctx.fillRect(0, py(band), W, py(0.006));
      break;
    }
    case 'bands':
      ctx.fillStyle = accent;
      ctx.fillRect(0, py(0.56), W, py(0.07));
      ctx.fillRect(0, py(0.67), W, py(0.07));
      ctx.fillRect(0, 0, W, py(0.035));
      break;
    case 'scallop': {
      // Scallops sweep back from the nose along each flank.
      ctx.fillStyle = accent;
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 3;
      for (const centre of [0.25, 0.75]) {
        ctx.beginPath();
        ctx.moveTo(px(centre - 0.25), 0);
        const lobes = 3;
        for (let i = 0; i <= 60; i += 1) {
          const u = centre - 0.25 + (i / 60) * 0.5;
          const offset = Math.abs(u - centre) / 0.25; // 0 at the flank centre, 1 top/bottom
          const lobe = Math.abs(Math.sin(((u - centre + 0.25) / 0.5) * Math.PI * lobes));
          const v = 0.42 - offset * 0.26 - lobe * 0.06;
          ctx.lineTo(px(u), py(Math.max(0.04, v)));
        }
        ctx.lineTo(px(centre + 0.25), 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'plain':
      break;
  }

  // Nose band in the nose colour where the cowl meets the fuselage.
  ctx.fillStyle = nose;
  ctx.fillRect(0, 0, W, py(0.012));

  // Frame finish.
  ctx.save();
  switch (o.frame) {
    case 'light': {
      // Doped fabric over stringers: soft shading between stringer lines aft of the cockpit.
      const from = py(0.48);
      for (let i = 0; i < 24; i += 1) {
        const x = (i / 24) * W;
        const gradient = ctx.createLinearGradient(x, 0, x + W / 24, 0);
        gradient.addColorStop(0, 'rgba(0,0,0,0.14)');
        gradient.addColorStop(0.5, 'rgba(255,255,255,0.05)');
        gradient.addColorStop(1, 'rgba(0,0,0,0.14)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, from, W / 24, H - from);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 0; i < 6; i += 1) ctx.fillRect(0, from + i * 70, W, 3);
      break;
    }
    case 'composite': {
      ctx.globalAlpha = 0.07;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      for (let i = -H; i < W + H; i += 9) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + H, H);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Bare carbon spine.
      ctx.fillStyle = '#23262b';
      ctx.fillRect(px(0.485), py(0.3), px(0.03), py(0.68));
      break;
    }
    case 'reinforced': {
      ctx.fillStyle = 'rgba(20,20,24,0.45)';
      for (const v of [0.18, 0.32, 0.46, 0.6, 0.74, 0.86]) {
        for (let x = 0; x < W; x += 9) ctx.fillRect(x, py(v), 3, 3);
      }
      for (const u of [0.18, 0.32, 0.68, 0.82]) {
        for (let y = py(0.05); y < H; y += 9) ctx.fillRect(px(u), y, 3, 3);
      }
      // Steel keel plate on the belly.
      ctx.fillStyle = '#6d7178';
      ctx.fillRect(0, py(0.2), px(0.035), py(0.6));
      ctx.fillRect(px(0.965), py(0.2), px(0.035), py(0.6));
      break;
    }
    case 'standard': {
      ctx.fillStyle = 'rgba(20,20,24,0.16)';
      for (const v of [0.2, 0.42, 0.64, 0.84]) for (let x = 0; x < W; x += 12) ctx.fillRect(x, py(v), 2, 2);
      break;
    }
  }
  ctx.restore();

  // Panel lines.
  ctx.fillStyle = 'rgba(10,12,20,0.28)';
  for (const v of [0.13, 0.36, 0.58, 0.8]) ctx.fillRect(0, py(v), W, 2);
  ctx.fillRect(px(0.2), py(0.13), 2, py(0.23));
  ctx.fillRect(px(0.8), py(0.13), 2, py(0.23));

  // Exhaust staining streaks back from the stacks.
  if (o.exhaustStains) {
    for (const u of [0.31, 0.69]) {
      const gradient = ctx.createLinearGradient(0, 0, 0, py(0.3));
      gradient.addColorStop(0, 'rgba(30,26,24,0.5)');
      gradient.addColorStop(1, 'rgba(30,26,24,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(px(u - 0.02), 0);
      ctx.lineTo(px(u + 0.02), 0);
      ctx.lineTo(px(u + 0.045), py(0.3));
      ctx.lineTo(px(u - 0.045), py(0.3));
      ctx.closePath();
      ctx.fill();
    }
  }

  // Text and markings are drawn in metres on each flank.
  const metresU = W / o.circumference;
  const metresV = H / o.length;
  const onFlank = (side: 1 | -1, u: number, v: number, draw: () => void) => {
    ctx.save();
    ctx.translate(px(side === 1 ? u : 1 - u), py(v));
    ctx.scale(metresU, metresV);
    // Left flank (side 1): text runs toward the tail; right flank mirrors it so it also reads nose-first.
    ctx.rotate(side === 1 ? Math.PI / 2 : -Math.PI / 2);
    draw();
    ctx.restore();
  };

  // Race number in a meatball roundel on the rear fuselage.
  const numberV = Math.min(0.62, o.canopyV + 0.2);
  const discColor = luminance(primary) > 0.55 ? '#17233b' : '#f1e8d4';
  const numberColor = luminance(primary) > 0.55 ? '#f1e8d4' : '#17233b';
  for (const side of [1, -1] as const) {
    onFlank(side, 0.25, numberV, () => {
      ctx.fillStyle = discColor;
      ctx.beginPath();
      ctx.arc(0, 0, 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 0.05;
      ctx.stroke();
      ctx.fillStyle = numberColor;
      ctx.font = `700 0.46px Georgia, 'Times New Roman', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(o.paint.number), 0, 0.03);
    });
    // Registration toward the tail.
    onFlank(side, 0.27, 0.84, () => {
      ctx.fillStyle = contrastOn(primary);
      ctx.font = `600 0.17px 'Courier New', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.registration, 0, 0);
    });
    // Maintenance stencil by the firewall.
    onFlank(side, 0.2, 0.06, () => {
      ctx.fillStyle = contrastOn(primary);
      ctx.globalAlpha = 0.7;
      ctx.font = `600 0.07px 'Courier New', monospace`;
      ctx.textAlign = 'left';
      ctx.fillText('OIL  23 L  ·  FUEL 100/130', 0, 0);
      ctx.globalAlpha = 1;
    });
  }

  // Victory marks under the left side of the canopy: one small gate per win.
  const marks = Math.min(12, Math.max(0, Math.floor(o.marks)));
  if (marks > 0) {
    onFlank(1, 0.36, o.canopyV - 0.04, () => {
      ctx.strokeStyle = contrastOn(primary);
      ctx.lineWidth = 0.022;
      for (let i = 0; i < marks; i += 1) {
        const x = i * 0.13;
        ctx.strokeRect(x, -0.05, 0.08, 0.1);
      }
    });
  }
};

/** Insignia decal texture (square, transparent background). */
export const createInsigniaTexture = (paint: Paint): Texture | null => {
  if (paint.insignia === 'none') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const accent = hex(swatchColor(paint.accent));
    const secondary = hex(swatchColor(paint.secondary));
    const light = '#f1e8d4';
    const c = size / 2;
    switch (paint.insignia) {
      case 'roundel':
        for (const [radius, color] of [
          [62, secondary],
          [46, light],
          [26, accent],
        ] as const) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(c, c, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'chevron':
        ctx.fillStyle = secondary;
        ctx.beginPath();
        ctx.arc(c, c, 62, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(c - 40, c + 22);
        ctx.lineTo(c, c - 26);
        ctx.lineTo(c + 40, c + 22);
        ctx.lineTo(c + 22, c + 22);
        ctx.lineTo(c, c - 4);
        ctx.lineTo(c - 22, c + 22);
        ctx.closePath();
        ctx.fill();
        break;
      case 'bolt':
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(c, c, 62, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(c + 10, c - 50);
        ctx.lineTo(c - 26, c + 6);
        ctx.lineTo(c - 2, c + 6);
        ctx.lineTo(c - 12, c + 50);
        ctx.lineTo(c + 26, c - 8);
        ctx.lineTo(c + 2, c - 8);
        ctx.closePath();
        ctx.fill();
        break;
      case 'swallow':
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(c, c, 62, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = secondary;
        ctx.beginPath();
        // A swallow in flight: swept wings and a forked tail.
        ctx.moveTo(c, c - 30);
        ctx.quadraticCurveTo(c - 20, c - 10, c - 52, c - 2);
        ctx.quadraticCurveTo(c - 22, c + 2, c - 8, c + 10);
        ctx.lineTo(c - 18, c + 44);
        ctx.lineTo(c, c + 22);
        ctx.lineTo(c + 18, c + 44);
        ctx.lineTo(c + 8, c + 10);
        ctx.quadraticCurveTo(c + 22, c + 2, c + 52, c - 2);
        ctx.quadraticCurveTo(c + 20, c - 10, c, c - 30);
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(c, c - 22, 7, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};

/** Soft radial texture for propeller blur discs: transparent hub, faint disc, painted tip ring. */
export const createPropDiscTexture = (tip: number): Texture => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    gradient.addColorStop(0, 'rgba(30,32,36,0)');
    gradient.addColorStop(0.2, 'rgba(30,32,36,0.35)');
    gradient.addColorStop(0.84, 'rgba(40,42,46,0.22)');
    gradient.addColorStop(0.86, `${hex(tip)}aa`);
    gradient.addColorStop(0.97, `${hex(tip)}88`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};
