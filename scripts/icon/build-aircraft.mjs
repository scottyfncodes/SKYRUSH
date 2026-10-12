#!/usr/bin/env node
// Generates the SKYRUSH jet (plus contrails, flame and speed streaks) for
// skyrush-icon.svg by projecting a tiny hand-built 3D model, so the bank reads
// as real geometry instead of a flat planform. The output replaces the block
// between the AIRCRAFT:BEGIN / AIRCRAFT:END markers in skyrush-icon.svg.
//
//   node scripts/icon/build-aircraft.mjs && node scripts/icon/render-icon.mjs
//
// Body frame: x forward, y starboard, z up. Port (y < 0) is the near, low wing.
// AIRCRAFT_VIEW='{"roll":55}' overrides camera parameters for experiments.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(here, 'skyrush-icon.svg');

const deg = Math.PI / 180;
const NEAR = -1;
const FAR = 1;
const VIEW = {
  roll: 85, // port (near) wing down
  yaw: 50, // nose away from the viewer -> seen from behind / side
  elev: -28, // camera height relative to the wing plane
  axisAngle: 36, // on-screen climb angle of the fuselage axis
  persp: 800, // smaller = stronger perspective
  scale: 1.14,
  cx: 486,
  cy: 474,
  ...(process.env.AIRCRAFT_VIEW ? JSON.parse(process.env.AIRCRAFT_VIEW) : {}),
};

// ---------------------------------------------------------------- math
const norm = (v) => {
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
};
const dot = (a, b) => a.reduce((s, c, i) => s + c * b[i], 0);

function toCam0([x, y, z]) {
  const r = VIEW.roll * deg;
  const by = y * Math.cos(r) - z * Math.sin(r);
  const bz = y * Math.sin(r) + z * Math.cos(r);
  let X = x;
  let Y = bz;
  let Z = -by; // port side faces the viewer
  const w = VIEW.yaw * deg;
  [X, Z] = [X * Math.cos(w) + Z * Math.sin(w), -X * Math.sin(w) + Z * Math.cos(w)];
  const e = VIEW.elev * deg;
  [Y, Z] = [Y * Math.cos(e) - Z * Math.sin(e), Y * Math.sin(e) + Z * Math.cos(e)];
  return [X, Y, Z];
}
const SCREEN_ROT = (() => {
  const n = toCam0([300, 0, 0]);
  const t = toCam0([-260, 0, 0]);
  return VIEW.axisAngle * deg - Math.atan2(n[1] - t[1], n[0] - t[0]);
})();
/** body vector -> camera space (X right, Y up, Z toward viewer) */
function toCam(p) {
  const [X, Y, Z] = toCam0(p);
  const c = Math.cos(SCREEN_ROT);
  const s = Math.sin(SCREEN_ROT);
  return [X * c - Y * s, X * s + Y * c, Z];
}
/** body point -> [sx, sy, depth] */
function proj(p) {
  const [X, Y, Z] = toCam(p);
  const k = (VIEW.persp / (VIEW.persp - Z)) * VIEW.scale;
  return [VIEW.cx + X * k, VIEW.cy - Y * k, Z];
}
const LIGHT = norm([0.5, 0.65, 0.58]); // the sun: up-right, a little toward us
const camN = (n) => norm(toCam(n));
const shade = (n) => Math.max(0, dot(camN(n), LIGHT));

const f = (n) => n.toFixed(1);
const path = (pts, close = true) =>
  'M' + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join(' L') + (close ? ' Z' : '');

const NOSE = proj([262, 0, 0]);
const TAIL = proj([-258, 0, 0]);
const AX = norm([NOSE[0] - TAIL[0], NOSE[1] - TAIL[1]]);
const PERP = [-AX[1], AX[0]];
const perpOf = (p) => p[0] * PERP[0] + p[1] * PERP[1];

const mix = (c1, c2, t) => {
  const a = c1.match(/\w\w/g).map((h) => parseInt(h, 16));
  const b = c2.match(/\w\w/g).map((h) => parseInt(h, 16));
  const k = Math.min(1, Math.max(0, t));
  return (
    '#' +
    a
      .map((v, i) =>
        Math.round(v + (b[i] - v) * k)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
};

// ---------------------------------------------------------------- fuselage
// [x, halfWidth, halfHeight]: short nose, wide blended mid-section
const STATIONS = [
  [262, 0, 0],
  [248, 9, 8],
  [224, 19, 16],
  [188, 31, 26],
  [140, 44, 34],
  [84, 60, 39],
  [24, 74, 41],
  [-40, 74, 40],
  [-104, 62, 37],
  [-166, 49, 33],
  [-222, 41, 30],
  [-258, 38, 28],
];
const ring = (x, w, h, t, z0 = 0) => [x, w * Math.cos(t), z0 + h * Math.sin(t)];
const ringN = (w, h, t) => [0, Math.cos(t) / Math.max(w, 1e-3), Math.sin(t) / Math.max(h, 1e-3)];
const interp = (x, idx) => {
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const a = STATIONS[i];
    const b = STATIONS[i + 1];
    if (x <= a[0] && x >= b[0]) return a[idx] + ((b[idx] - a[idx]) * (a[0] - x)) / (a[0] - b[0]);
  }
  return 0;
};
const fuseH = (x) => interp(x, 2);

/**
 * Screen region covered by the part of a loft where `keep(t, w, h)` holds:
 * per station, the extreme projected points across the aircraft axis.
 */
function loft(stations, keep = () => true, z0fn = () => 0) {
  const left = [];
  const right = [];
  for (const [x, w, h] of stations) {
    let lo = null;
    let hi = null;
    for (let i = 0; i < 96; i++) {
      const t = (2 * Math.PI * i) / 96;
      if (w > 0 && !keep(t, w, h)) continue;
      const p = proj(ring(x, w, h, t, z0fn(x)));
      if (!lo || perpOf(p) < perpOf(lo)) lo = p;
      if (!hi || perpOf(p) > perpOf(hi)) hi = p;
    }
    if (lo) {
      left.push(lo);
      right.push(hi);
    }
  }
  return { left, right, poly: [...left, ...right.slice().reverse()] };
}
const visible = (t, w, h) => camN(ringN(w, h, t))[2] > 0;
const litPart = (t, w, h) => visible(t, w, h) && shade(ringN(w, h, t)) > 0.68;

const fuse = loft(STATIONS);
const fuseLit = loft(STATIONS, litPart);

// ---------------------------------------------------------------- wings
// starboard planform [x, y]; broad and swept, root buried in the body
const WING = [
  [176, 40],
  [96, 78],
  [-110, 292],
  [-124, 310],
  [-142, 320],
  [-166, 322],
  [-188, 316],
  [-198, 302],
  [-176, 150],
  [-200, 40],
];
const DIHEDRAL = 3 * deg;
const THICK = 12;
const wingZ = (y, top) =>
  -12 + (Math.abs(y) - 40) * Math.tan(DIHEDRAL) + (top ? 1 : -1) * THICK * (1 - (Math.abs(y) - 40) / 420);
const wing3d = (side, top, poly = WING) => poly.map(([x, y]) => [x, side * y, wingZ(y, top)]);
function clipY(poly, yMin) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a[1] >= yMin) out.push(a);
    if (a[1] >= yMin !== b[1] >= yMin) {
      const t = (yMin - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, yMin]);
    }
  }
  return out;
}
const WING_TIP = clipY(WING, 266);
const wingTopN = (side) => [0, -side * Math.sin(DIHEDRAL), Math.cos(DIHEDRAL)];

// ---------------------------------------------------------------- V-fins
const CANT = 32 * deg;
const FIN = [
  [-170, 0],
  [-230, 46],
  [-244, 50],
  [-258, 48],
  [-258, 0],
];
const finPt = (side, x, v) => [x, side * (12 + v * Math.sin(CANT)), fuseH(x) * 0.8 + v * Math.cos(CANT)];
const fin3d = (side, poly = FIN) => poly.map(([x, v]) => finPt(side, x, v));

// ---------------------------------------------------------------- canopy
const CANOPY = [
  [206, 0, 0],
  [190, 12, 12],
  [166, 19, 20],
  [138, 22, 24],
  [110, 20, 21],
  [86, 13, 13],
  [72, 0, 0],
];
const canopyZ = (x) => fuseH(x) * 0.8;
const canopy = loft(CANOPY, (t, w, h) => t <= Math.PI && visible(t, w, h), canopyZ);
const HALF = norm([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
const canopySpec = CANOPY.slice(1, -2).map(([x, w, h]) => {
  let best = -2;
  let bestT = Math.PI / 2;
  for (let i = 0; i <= 64; i++) {
    const t = (Math.PI * i) / 64;
    const d = dot(camN(ringN(w, h, t)), HALF);
    if (d > best) {
      best = d;
      bestT = t;
    }
  }
  return proj(ring(x, w * 0.82, h * 0.82, bestT, canopyZ(x)));
});

// ---------------------------------------------------------------- stripe
const STRIPE_ST = STATIONS.filter(([x]) => x <= 236);
const surfLine = (t) => STRIPE_ST.map(([x, w, h]) => proj(ring(x, w * 1.01, h * 1.01, t)));
const stripe = [...surfLine(Math.PI / 2 - 0.2), ...surfLine(Math.PI / 2 + 0.2).reverse()];

// ---------------------------------------------------------------- contrails
// Begin exactly at each wingtip and arc with the turn (port turn: the path
// already flown bends away to starboard as we look back along it).
function trail(side) {
  const tip = [-152, side * 320, wingZ(320, true)];
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const s = (i / 48) * 1100;
    pts.push(proj([tip[0] - s, tip[1] + 0.0007 * s * s, tip[2] - 0.00012 * s * s]));
  }
  return pts;
}
function ribbon(center, w0, w1) {
  const L = [];
  const R = [];
  for (let i = 0; i < center.length; i++) {
    const a = center[Math.max(0, i - 1)];
    const b = center[Math.min(center.length - 1, i + 1)];
    const d = norm([b[0] - a[0], b[1] - a[1]]);
    const w = (w0 + (w1 - w0) * Math.pow(i / (center.length - 1), 0.85)) / 2;
    L.push([center[i][0] - d[1] * w, center[i][1] + d[0] * w]);
    R.push([center[i][0] + d[1] * w, center[i][1] - d[0] * w]);
  }
  return [...L, ...R.reverse()];
}

// ---------------------------------------------------------------- assemble
const defs = [];
const out = [];
const lin = (id, p0, p1, stops) => {
  defs.push(
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(p0[0])}" y1="${f(p0[1])}" x2="${f(p1[0])}" y2="${f(p1[1])}">` +
      stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('') +
      '</linearGradient>',
  );
  return `url(#${id})`;
};
const accent = (id, pts) => {
  let a = pts[0];
  let b = pts[0];
  for (const p of pts) {
    if (p[1] < a[1]) a = p;
    if (p[1] > b[1]) b = p;
  }
  return lin(id, a, b, [
    [0, '#ffb43a'],
    [0.45, '#ffa524'],
    [1, '#ff6a1f'],
  ]);
};

// contrails + speed streaks (hidden in the favicon)
const tN = trail(NEAR);
const tF = trail(FAR);
const trailGrad = (id, pts) =>
  lin(id, pts[0], pts[pts.length - 1], [
    [0, '#ffffff', 1],
    [0.45, '#ffffff', 0.72],
    [1, '#ffffff', 0],
  ]);
const rN = ribbon(tN, 8 * VIEW.scale, 72 * VIEW.scale);
const rF = ribbon(tF, 6 * VIEW.scale, 50 * VIEW.scale);
const gN = trailGrad('trN', tN);
const gF = trailGrad('trF', tF);
const streak = (cx, cy, len, w) => {
  const a = [cx - (AX[0] * len) / 2, cy - (AX[1] * len) / 2];
  const b = [cx + (AX[0] * len) / 2, cy + (AX[1] * len) / 2];
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const o = [(PERP[0] * w) / 2, (PERP[1] * w) / 2];
  return `<path d="M${f(a[0])} ${f(a[1])} Q${f(m[0] + o[0])} ${f(m[1] + o[1])} ${f(b[0])} ${f(b[1])} Q${f(m[0] - o[0])} ${f(m[1] - o[1])} ${f(a[0])} ${f(a[1])} Z"/>`;
};
out.push('<g class="detail">');
out.push(
  `<g filter="url(#blur6)" opacity="0.5"><path d="${path(rF)}" fill="${gF}"/><path d="${path(rN)}" fill="${gN}"/></g>`,
);
out.push(`<path d="${path(rF)}" fill="${gF}"/><path d="${path(rN)}" fill="${gN}"/>`);
out.push(
  `<g fill="#ffffff" opacity="0.55">${streak(250, 200, 280, 10)}${streak(140, 420, 200, 8)}${streak(800, 600, 240, 9)}</g>`,
);
out.push('</g>');

// flame glow sits behind the airframe
const nozzleC = proj([-258, 0, 0]);
const flameTip = proj([-350, 0, 0]);
const FD = norm([flameTip[0] - nozzleC[0], flameTip[1] - nozzleC[1]]);
const FP = [-FD[1], FD[0]];
const glowC = [(nozzleC[0] + flameTip[0]) / 2, (nozzleC[1] + flameTip[1]) / 2];
const flameAng = (Math.atan2(FD[1], FD[0]) * 180) / Math.PI;
out.push(
  `<ellipse class="detail" cx="${f(glowC[0])}" cy="${f(glowC[1])}" rx="${f(100 * VIEW.scale)}" ry="${f(50 * VIEW.scale)}" transform="rotate(${f(flameAng)} ${f(glowC[0])} ${f(glowC[1])})" fill="#ff8a2a" opacity="0.35" filter="url(#blur14)"/>`,
);

out.push('<g filter="url(#planeShadow)">');

function drawWing(side, id) {
  const top = wing3d(side, true).map(proj);
  const bottom = wing3d(side, false).map(proj);
  const topFacing = camN(wingTopN(side))[2] > 0;
  const s = shade(wingTopN(side));
  const topCol = mix('#8ea6da', '#ffffff', (side === NEAR ? 0.15 : 0.35) + 0.8 * s);
  const root = proj([10, side * 170, 0]);
  const tip = proj([-150, side * 170, 0]);
  const underFill = lin(id + 'u', root, tip, [
    [0, '#334c8f'],
    [1, '#5876bb'],
  ]);
  const topFill = lin(id + 't', root, tip, [
    [0, '#ffffff'],
    [0.35, mix(topCol, '#ffffff', 0.45)],
    [1, mix(topCol, '#93a8d8', 0.55)],
  ]);
  const tipTop = wing3d(side, true, WING_TIP).map(proj);
  const tipBottom = wing3d(side, false, WING_TIP).map(proj);
  const le = `<path d="${path(wing3d(side, true, WING.slice(0, 3)).map(proj), false)}" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`;
  if (topFacing) {
    out.push(`<path d="${path(bottom)}" fill="${underFill}"/>`);
    out.push(`<path d="${path(tipBottom)}" fill="#c4521a"/>`);
    out.push(`<path d="${path(top)}" fill="${topFill}"/>`);
    const sheen = wing3d(side, true, [
      [70, 84],
      [-120, 280],
      [-150, 282],
      [40, 90],
    ]).map(proj);
    out.push(`<path d="${path(sheen)}" fill="#ffffff" opacity="0.55" filter="url(#soft)"/>`);
    out.push(`<path d="${path(tipTop)}" fill="${accent(id + 'a', tipTop)}"/>`);
    out.push(le);
  } else {
    out.push(`<path d="${path(top)}" fill="${topFill}"/>`);
    out.push(`<path d="${path(tipTop)}" fill="${accent(id + 'a', tipTop)}"/>`);
    out.push(`<path d="${path(bottom)}" fill="${underFill}"/>`);
    out.push(`<path d="${path(tipBottom)}" fill="#d9601f"/>`);
  }
}
function drawFin(side, id) {
  const poly = fin3d(side).map(proj);
  let n = [0, side * Math.cos(CANT), -Math.sin(CANT)];
  if (camN(n)[2] < 0) n = n.map((c) => -c);
  const col = mix('#6f88c2', '#ffffff', 0.3 + 0.85 * shade(n));
  out.push(
    `<path d="${path(poly)}" fill="${lin(id, poly[0], poly[2], [
      [0, mix(col, '#ffffff', 0.3)],
      [1, mix(col, '#8ea3d4', 0.3)],
    ])}"/>`,
  );
  const tipPoly = fin3d(side, clipY(FIN, 34)).map(proj);
  out.push(`<path d="${path(tipPoly)}" fill="${accent(id + 'a', tipPoly)}"/>`);
}

// far (raised) wing first: the fuselage hides its root
drawWing(FAR, 'wF');
drawFin(FAR, 'finF');
// near (low) wing, then a soft occlusion shadow where it meets the body
drawWing(NEAR, 'wN');
const ao = [
  [130, -56],
  [40, -80],
  [-60, -80],
  [-170, -58],
].map(([x, y]) => proj([x, y, wingZ(Math.abs(y), true)]));
out.push(
  `<path d="${path(ao, false)}" fill="none" stroke="#0a1f5e" stroke-width="${f(26 * VIEW.scale)}" stroke-linecap="round" opacity="0.45" filter="url(#soft)"/>`,
);

// fuselage: shadow-tone body, lit region over it (terminator follows the roll)
const mid = proj([0, 0, 0]);
const g0 = [mid[0] + PERP[0] * 80, mid[1] + PERP[1] * 80];
const g1 = [mid[0] - PERP[0] * 80, mid[1] - PERP[1] * 80];
const litMid = fuseLit.poly.length ? fuseLit.left[Math.floor(fuseLit.left.length / 2)] : mid;
const litSideFirst = perpOf(litMid) > perpOf(mid);
const [G0, G1] = litSideFirst ? [g0, g1] : [g1, g0];
out.push(
  `<path d="${path(fuse.poly)}" fill="${lin('fB', G0, G1, [
    [0, '#c4d2ef'],
    [0.4, '#7690cb'],
    [1, '#334f93'],
  ])}"/>`,
);
out.push(
  `<path d="${path(fuseLit.poly)}" fill="${lin('fT', G0, G1, [
    [0, '#ffffff'],
    [0.6, '#f4f7ff'],
    [1, '#dfe7f7'],
  ])}"/>`,
);
out.push(
  `<path d="${path(fuse.poly)}" fill="${lin('fTail', NOSE, TAIL, [
    [0.5, '#14307a', 0],
    [1, '#14307a', 0.25],
  ])}"/>`,
);
out.push(
  `<path d="${path(stripe)}" fill="${lin('stp', NOSE, TAIL, [
    [0, '#ffb43a'],
    [1, '#ff6a1f'],
  ])}"/>`,
);
const rimSide = litSideFirst ? fuse.left : fuse.right;
out.push(
  `<path d="${path(rimSide.slice(1, -1), false)}" fill="none" stroke="#fff1cc" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
);

// canopy + crisp highlight
out.push(
  `<path d="${path(canopy.poly)}" fill="${lin('cp', canopySpec[0], proj([140, 0, canopyZ(140) - 10]), [
    [0, '#3a68cf'],
    [0.45, '#11286b'],
    [1, '#060f33'],
  ])}"/>`,
);
out.push(
  `<path d="${path(canopySpec, false)}" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
);

drawFin(NEAR, 'finN');

// nozzle (tail faces the viewer) + afterburner cone
const nozzle = loft([
  [-246, 40, 30],
  [-262, 35, 26],
]);
out.push(`<path d="${path(nozzle.poly)}" fill="#26304a"/>`);
const hot = loft([
  [-262, 25, 18],
  [-263, 25, 18],
]);
out.push(`<path d="${path(hot.poly)}" fill="#ffe08a"/>`);
out.push('</g>');

const fw = 26 * VIEW.scale;
const c1 = [nozzleC[0] + FD[0] * 45, nozzleC[1] + FD[1] * 45];
out.push(
  `<path d="M${f(nozzleC[0] + FP[0] * fw)} ${f(nozzleC[1] + FP[1] * fw)} Q${f(c1[0] + FP[0] * fw)} ${f(c1[1] + FP[1] * fw)} ${f(flameTip[0])} ${f(flameTip[1])} Q${f(c1[0] - FP[0] * fw)} ${f(c1[1] - FP[1] * fw)} ${f(nozzleC[0] - FP[0] * fw)} ${f(nozzleC[1] - FP[1] * fw)} Z" fill="${lin(
    'flm',
    nozzleC,
    flameTip,
    [
      [0, '#fffbe6'],
      [0.25, '#ffd27a'],
      [0.6, '#ff8a2a', 0.8],
      [1, '#ff6a1f', 0],
    ],
  )}"/>`,
);

const block = `<!-- AIRCRAFT:BEGIN (generated by build-aircraft.mjs; do not edit by hand) -->\n<defs>\n${defs.join('\n')}\n</defs>\n${out.join('\n')}\n<!-- AIRCRAFT:END -->`;
const svg = await readFile(svgPath, 'utf8');
await writeFile(svgPath, svg.replace(/<!-- AIRCRAFT:BEGIN[\s\S]*?<!-- AIRCRAFT:END -->/, block));
console.log(`aircraft written (view ${JSON.stringify(VIEW)})`);
