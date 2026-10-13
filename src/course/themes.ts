/**
 * Art direction for each course: sky, light, atmosphere, ground palette and props.
 * Pure data (hex colours, numbers) so the UI can preview a course without three.js.
 */

export type ScatterKind = 'pine' | 'palm' | 'boulder' | 'cactus' | 'shrub';

export interface ScatterRule {
  kind: ScatterKind;
  count: number;
  /** Ground altitude range (m) the prop may stand on. */
  minAltitude: number;
  maxAltitude: number;
  /** 0 = flat, 1 = vertical; steeper ground is skipped. */
  maxSlope: number;
  scale: readonly [number, number];
  /** Keep the racing corridor clear: minimum distance (m) from the route. */
  routeClearance: number;
}

export interface StrataBands {
  colors: readonly number[];
  /** Vertical thickness (m) of one band. */
  spacing: number;
  /** 0..1 how strongly bands tint cliffs. */
  strength: number;
}

export interface TerrainPalette {
  /** Valley floor and open flats. */
  floor: number;
  /** Patches of vegetation on gentle ground. */
  vegetation: number;
  vegetationAltitude: readonly [number, number];
  vegetationAmount: number;
  /** Slope range over which vegetation thins out. Default [0.35, 0.65]. */
  vegetationSlope?: readonly [number, number];
  rock: number;
  rockAltitude: readonly [number, number];
  /** Slope range (0 flat .. 1 vertical) over which bare rock takes over. Default [0.22, 0.55]. */
  rockSlope?: readonly [number, number];
  cliff: number;
  strata?: StrataBands;
  /** Snow or bleached rock on the highest ground. */
  peak: number;
  peakAltitude: readonly [number, number];
  /** Sand fringe around the water line. */
  beach?: { color: number; height: number };
}

export interface CourseTheme {
  id: string;
  /** Short mood line for the course card, e.g. "Golden hour". */
  mood: string;
  sky: {
    zenith: number;
    horizon: number;
    /** Colour below the horizon (seen past the terrain edge). */
    ground: number;
    /** 0..1 cloud cover. */
    clouds: number;
    cloudLit: number;
    cloudShade: number;
  };
  sun: {
    /** Direction toward the sun (need not be normalised). */
    direction: readonly [number, number, number];
    color: number;
    intensity: number;
    /** Colour of the halo around the sun disc in the sky. */
    glow: number;
  };
  hemisphere: { sky: number; ground: number; intensity: number };
  ambient: number;
  fog: { color: number; near: number; far: number };
  exposure: number;
  terrain: TerrainPalette;
  water?: { shallow: number; deep: number; foam: number };
  scatter: readonly ScatterRule[];
  /** Colour of natural landmarks (spires, arches, sea stacks). */
  landmarkRock: number;
  /** Snow caps on spires. */
  landmarkSnow?: boolean;
}

export const CALDERA_THEME: CourseTheme = {
  id: 'caldera',
  mood: 'Desert canyon · golden afternoon',
  sky: {
    zenith: 0x2b5191,
    horizon: 0xf2d3a6,
    ground: 0xc9a77f,
    clouds: 0.28,
    cloudLit: 0xfff1dc,
    cloudShade: 0xc79f86,
  },
  sun: { direction: [-0.55, 0.72, -0.3], color: 0xffeccc, intensity: 2.7, glow: 0xffc27a },
  hemisphere: { sky: 0xcfe0ff, ground: 0x7a5a40, intensity: 0.75 },
  ambient: 0.12,
  fog: { color: 0xe3c7a2, near: 900, far: 5400 },
  exposure: 1.05,
  terrain: {
    floor: 0xcdb085,
    vegetation: 0x8c8a5a,
    vegetationAltitude: [-20, 60],
    vegetationAmount: 0.5,
    rock: 0x9a6c50,
    rockAltitude: [14, 80],
    cliff: 0x4f3d36,
    strata: { colors: [0xb8784f, 0xd9a676, 0x8e5a42, 0xc98f63], spacing: 11, strength: 0.55 },
    peak: 0xeee6da,
    peakAltitude: [420, 620],
  },
  scatter: [
    {
      kind: 'boulder',
      count: 520,
      minAltitude: -30,
      maxAltitude: 260,
      maxSlope: 0.5,
      scale: [2.5, 9],
      routeClearance: 70,
    },
    {
      kind: 'cactus',
      count: 420,
      minAltitude: -30,
      maxAltitude: 70,
      maxSlope: 0.25,
      scale: [0.8, 1.5],
      routeClearance: 110,
    },
    {
      kind: 'shrub',
      count: 700,
      minAltitude: -30,
      maxAltitude: 120,
      maxSlope: 0.35,
      scale: [1, 2.4],
      routeClearance: 40,
    },
  ],
  landmarkRock: 0x8a5d45,
};

export const FROSTLINE_THEME: CourseTheme = {
  id: 'frostline',
  mood: 'Alpine pass · crisp morning',
  sky: {
    zenith: 0x2a63b8,
    horizon: 0xdcebf7,
    ground: 0xc8d6e2,
    clouds: 0.45,
    cloudLit: 0xffffff,
    cloudShade: 0xa9b8cc,
  },
  sun: { direction: [0.6, 0.55, -0.45], color: 0xfff4e4, intensity: 2.9, glow: 0xfff0d0 },
  hemisphere: { sky: 0xdbe9ff, ground: 0x3e4a44, intensity: 0.85 },
  ambient: 0.14,
  fog: { color: 0xd3e2ef, near: 800, far: 5000 },
  exposure: 1.0,
  terrain: {
    floor: 0x8f9c74,
    vegetation: 0x3c5a3e,
    vegetationAltitude: [-20, 330],
    vegetationAmount: 0.75,
    rock: 0x707985,
    rockAltitude: [120, 360],
    cliff: 0x3b4049,
    peak: 0xf3f6fa,
    peakAltitude: [300, 470],
  },
  scatter: [
    {
      kind: 'pine',
      count: 2200,
      minAltitude: 0,
      maxAltitude: 420,
      maxSlope: 0.45,
      scale: [0.8, 1.6],
      routeClearance: 120,
    },
    {
      kind: 'boulder',
      count: 260,
      minAltitude: 0,
      maxAltitude: 700,
      maxSlope: 0.6,
      scale: [2, 7],
      routeClearance: 70,
    },
  ],
  landmarkRock: 0x6c7480,
  landmarkSnow: true,
};

export const CORAL_THEME: CourseTheme = {
  id: 'coral',
  mood: 'Tropical archipelago · midday',
  sky: {
    zenith: 0x1666cf,
    horizon: 0xc2e9f7,
    ground: 0x5fb8c9,
    clouds: 0.5,
    cloudLit: 0xffffff,
    cloudShade: 0xb3c7d8,
  },
  sun: { direction: [0.25, 0.9, 0.2], color: 0xfff8ea, intensity: 3.0, glow: 0xfff6dc },
  hemisphere: { sky: 0xd8f1ff, ground: 0x4c6a52, intensity: 0.85 },
  ambient: 0.14,
  fog: { color: 0xc6e6f2, near: 1000, far: 6000 },
  exposure: 1.0,
  terrain: {
    floor: 0xe6d3a3,
    vegetation: 0x3f8a3c,
    vegetationAltitude: [5, 400],
    vegetationAmount: 1,
    vegetationSlope: [0.6, 0.9],
    rock: 0x7f7a6b,
    rockAltitude: [170, 320],
    rockSlope: [0.55, 0.9],
    cliff: 0x55524a,
    peak: 0x6f8f52,
    peakAltitude: [400, 600],
    beach: { color: 0xf2e3b8, height: 5 },
  },
  water: { shallow: 0x3ad8cf, deep: 0x0a4f86, foam: 0xf4fbff },
  scatter: [
    {
      kind: 'palm',
      count: 1200,
      minAltitude: 2,
      maxAltitude: 120,
      maxSlope: 0.4,
      scale: [0.8, 1.3],
      routeClearance: 90,
    },
    {
      kind: 'shrub',
      count: 900,
      minAltitude: 6,
      maxAltitude: 260,
      maxSlope: 0.5,
      scale: [1.5, 3.5],
      routeClearance: 60,
    },
    {
      kind: 'boulder',
      count: 160,
      minAltitude: 0,
      maxAltitude: 12,
      maxSlope: 0.6,
      scale: [2, 6],
      routeClearance: 70,
    },
  ],
  landmarkRock: 0x8a7f6c,
};

export const EMBER_THEME: CourseTheme = {
  id: 'ember',
  mood: 'Red mesas · dusk',
  sky: {
    zenith: 0x23194a,
    horizon: 0xff8f52,
    ground: 0x8a4a3c,
    clouds: 0.38,
    cloudLit: 0xffb38a,
    cloudShade: 0x6b3b5e,
  },
  sun: { direction: [-0.75, 0.2, 0.62], color: 0xffa266, intensity: 2.6, glow: 0xff7a3d },
  hemisphere: { sky: 0x9a7fe0, ground: 0x6a3426, intensity: 1.05 },
  ambient: 0.22,
  fog: { color: 0xd98463, near: 700, far: 4800 },
  exposure: 1.12,
  terrain: {
    floor: 0xbd6d43,
    vegetation: 0x7a6a42,
    vegetationAltitude: [-20, 50],
    vegetationAmount: 0.3,
    rock: 0xa64b2c,
    rockAltitude: [10, 70],
    cliff: 0x5a2a1f,
    strata: { colors: [0xc0623a, 0x8f3a24, 0xd88a55, 0x9c4a2d, 0xe0a070], spacing: 9, strength: 0.75 },
    peak: 0xe2a575,
    peakAltitude: [600, 800],
  },
  scatter: [
    {
      kind: 'boulder',
      count: 650,
      minAltitude: -30,
      maxAltitude: 400,
      maxSlope: 0.55,
      scale: [2.5, 10],
      routeClearance: 70,
    },
    {
      kind: 'shrub',
      count: 500,
      minAltitude: -30,
      maxAltitude: 60,
      maxSlope: 0.3,
      scale: [1, 2.2],
      routeClearance: 40,
    },
  ],
  landmarkRock: 0x9e4a2c,
};
