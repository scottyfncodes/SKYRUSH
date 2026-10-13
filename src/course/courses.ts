import type { GateKind } from './gates';
import { DEFAULT_MOUNTAINS, type MountainProfile } from './terrain';
import { CALDERA_THEME, CORAL_THEME, EMBER_THEME, FROSTLINE_THEME, type CourseTheme } from './themes';

export interface GateSpec {
  x: number;
  z: number;
  floor: number;
  clearance: number;
  kind?: GateKind;
  width?: number;
  height?: number;
}

/**
 * Bonus rings sit low over the ground between two gates, 40–60 m below the
 * safe racing line. Diving for one is a visible, optional risk: more points and
 * a boost refill, but less room for error near the ground and a climb to make
 * the next gate. `after` is the gate the segment starts from.
 */
export interface RingSpec {
  after: number;
  t: number;
  lateral: number;
  height: number;
}

export interface Landmark {
  kind: 'tower' | 'hangar' | 'arch' | 'spire' | 'pylon' | 'antenna' | 'grandstand' | 'lighthouse';
  x: number;
  z: number;
  rotation?: number;
  scale?: number;
}

/** Everything that defines a course. Every course starts facing +Z from its spawn. */
export interface CourseSpec {
  id: string;
  name: string;
  location: string;
  description: string;
  /** One-word character of the course, shown on its card. */
  character: string;
  gates: readonly GateSpec[];
  spawn: { x: number; z: number; floor: number; altitude: number };
  /** Extra route points after the finish so the carved valley continues past it. */
  tail: readonly { x: number; z: number; floor: number }[];
  rings: readonly RingSpec[];
  landmarks: readonly Landmark[];
  valleyWidth: number;
  valleyBlend: number;
  mountains: MountainProfile;
  seaLevel?: number;
  parTime: number;
  ceiling: number;
  bounds: number;
  theme: CourseTheme;
}

/**
 * Caldera Ridge: the inaugural SKYRUSH test circuit.
 * A fast run north out of the facility, a long climbing sweep over the ridge,
 * a plunge back into the canyon, the Needle chicane, and a sweeping return home.
 */
const CALDERA_RIDGE: CourseSpec = {
  id: 'caldera-ridge',
  name: 'Caldera Ridge',
  location: 'Sector 7 Proving Grounds',
  description:
    'Fifteen gates through a carved canyon: a flat-out opening straight, a long climb over the ridge, the Needle chicane and a sweeping return to the facility.',
  character: 'Balanced',
  gates: [
    { x: 0, z: 150, floor: 0, clearance: 52, kind: 'start' },
    { x: 60, z: 760, floor: 4, clearance: 52 },
    { x: 350, z: 1320, floor: 18, clearance: 56 },
    { x: 850, z: 1680, floor: 60, clearance: 66 },
    { x: 1450, z: 1760, floor: 125, clearance: 92, kind: 'summit' },
    { x: 1960, z: 1400, floor: 84, clearance: 70 },
    { x: 2060, z: 800, floor: 32, clearance: 58 },
    { x: 1720, z: 340, floor: 12, clearance: 52 },
    { x: 1260, z: 560, floor: 10, clearance: 50, kind: 'chicane', width: 42 },
    { x: 900, z: 240, floor: 10, clearance: 50, kind: 'chicane', width: 42 },
    { x: 500, z: -260, floor: 2, clearance: 54 },
    { x: -60, z: -660, floor: 0, clearance: 58 },
    { x: -620, z: -440, floor: 16, clearance: 60 },
    { x: -770, z: 160, floor: 42, clearance: 70 },
    { x: -330, z: 620, floor: 20, clearance: 56, kind: 'finish', width: 52 },
  ],
  spawn: { x: 0, z: -420, floor: 0, altitude: 55 },
  tail: [{ x: 100, z: 1000, floor: 10 }],
  rings: [
    { after: 0, t: 0.55, lateral: 0, height: 12 },
    { after: 2, t: 0.5, lateral: -14, height: 13 },
    { after: 5, t: 0.6, lateral: 12, height: 13 },
    { after: 7, t: 0.5, lateral: 0, height: 12 },
    { after: 10, t: 0.5, lateral: 16, height: 11 },
    { after: 12, t: 0.45, lateral: -12, height: 13 },
  ],
  landmarks: [
    { kind: 'hangar', x: -140, z: -520, rotation: 0, scale: 1 },
    { kind: 'hangar', x: 150, z: -560, rotation: 0.1, scale: 1.2 },
    { kind: 'grandstand', x: -120, z: 120, rotation: Math.PI / 2 },
    { kind: 'tower', x: 130, z: -40 },
    { kind: 'pylon', x: 650, z: 1500 },
    { kind: 'spire', x: 1250, z: 2100, scale: 1.4 },
    { kind: 'spire', x: 1750, z: 2050, scale: 1 },
    { kind: 'antenna', x: 1470, z: 1980 },
    { kind: 'arch', x: 1240, z: 560, rotation: 0.35 },
    { kind: 'spire', x: 2350, z: 1100, scale: 1.2 },
    { kind: 'pylon', x: 1080, z: 400 },
    { kind: 'spire', x: 380, z: -720, scale: 0.9 },
    { kind: 'antenna', x: -920, z: -120 },
    { kind: 'spire', x: -1050, z: 400, scale: 1.3 },
    { kind: 'tower', x: -480, z: 800 },
  ],
  valleyWidth: 150,
  valleyBlend: 420,
  mountains: DEFAULT_MOUNTAINS,
  parTime: 105,
  ceiling: 900,
  bounds: 4200,
  theme: CALDERA_THEME,
};

/**
 * Frostline Pass: a climbing alpine circuit. Pine valleys, a long ascent to the
 * High Pass gate at 370 m, then a fast descent and a twisting run home.
 */
const FROSTLINE_PASS: CourseSpec = {
  id: 'frostline-pass',
  name: 'Frostline Pass',
  location: 'Halden Range Alpine Station',
  description:
    'A cold, technical climb: pine valleys, a long ascent to the High Pass gate between snowbound peaks, then a fast descent and a twisting run back to the station.',
  character: 'Climbing',
  gates: [
    { x: 0, z: 180, floor: 40, clearance: 52, kind: 'start' },
    { x: -120, z: 760, floor: 58, clearance: 54 },
    { x: -520, z: 1220, floor: 92, clearance: 58 },
    { x: -1080, z: 1380, floor: 140, clearance: 62 },
    { x: -1600, z: 1080, floor: 190, clearance: 66 },
    { x: -1820, z: 520, floor: 236, clearance: 74 },
    { x: -1500, z: 20, floor: 280, clearance: 90, kind: 'summit' },
    { x: -1000, z: -300, floor: 228, clearance: 66 },
    { x: -560, z: -100, floor: 170, clearance: 56, kind: 'chicane', width: 42 },
    { x: -300, z: -460, floor: 130, clearance: 56, kind: 'chicane', width: 42 },
    { x: -520, z: -960, floor: 92, clearance: 58 },
    { x: -60, z: -1320, floor: 62, clearance: 58 },
    { x: 480, z: -1100, floor: 50, clearance: 56 },
    { x: 720, z: -580, floor: 44, clearance: 56 },
    { x: 400, z: -60, floor: 40, clearance: 56, kind: 'finish', width: 52 },
  ],
  spawn: { x: 0, z: -420, floor: 40, altitude: 55 },
  tail: [{ x: 120, z: 500, floor: 40 }],
  rings: [
    { after: 0, t: 0.5, lateral: 0, height: 12 },
    { after: 2, t: 0.55, lateral: 12, height: 13 },
    { after: 4, t: 0.5, lateral: -10, height: 13 },
    { after: 7, t: 0.5, lateral: 0, height: 12 },
    { after: 10, t: 0.5, lateral: -12, height: 12 },
    { after: 12, t: 0.5, lateral: 10, height: 12 },
  ],
  landmarks: [
    { kind: 'hangar', x: -150, z: -540, rotation: 0, scale: 1 },
    { kind: 'hangar', x: 160, z: -580, rotation: -0.1, scale: 1.1 },
    { kind: 'tower', x: 140, z: -60 },
    { kind: 'grandstand', x: -130, z: 140, rotation: Math.PI / 2 },
    { kind: 'antenna', x: -1500, z: -230 },
    { kind: 'antenna', x: -1250, z: 260 },
    { kind: 'spire', x: -2150, z: 760, scale: 1.5 },
    { kind: 'spire', x: -1950, z: -150, scale: 1.2 },
    { kind: 'spire', x: -800, z: 1700, scale: 1.3 },
    { kind: 'pylon', x: -760, z: -260 },
    { kind: 'pylon', x: -280, z: -780 },
    { kind: 'spire', x: 300, z: -1500, scale: 1.1 },
    { kind: 'tower', x: 900, z: -820 },
  ],
  valleyWidth: 140,
  valleyBlend: 380,
  mountains: {
    offsetX: 7300,
    offsetZ: -4100,
    ridgeWavelength: 1500,
    ridgeThreshold: 0.2,
    ridgeAmplitude: 1050,
    rollingWavelength: 2400,
    rollingAmplitude: 220,
    base: 30,
    detailAmplitude: 32,
  },
  parTime: 104,
  ceiling: 1100,
  bounds: 4200,
  theme: FROSTLINE_THEME,
};

/**
 * Coral Coast: a low, fast archipelago run over open water, threading channels
 * between jungle islands with one hop over a saddle ridge.
 */
const CORAL_COAST: CourseSpec = {
  id: 'coral-coast',
  name: 'Coral Coast',
  location: 'Tamarau Archipelago',
  description:
    'Low and fast over turquoise water: thread the channels between jungle islands and sea stacks, hop the Saddle ridge, then a slalom back to the floating start pad.',
  character: 'Fast',
  gates: [
    { x: 0, z: 200, floor: -4, clearance: 40, kind: 'start' },
    { x: 180, z: 820, floor: -6, clearance: 40 },
    { x: 640, z: 1240, floor: -6, clearance: 42 },
    { x: 1260, z: 1300, floor: -6, clearance: 40 },
    { x: 1760, z: 900, floor: -6, clearance: 44 },
    { x: 1900, z: 300, floor: 28, clearance: 60, kind: 'summit' },
    { x: 1560, z: -260, floor: -6, clearance: 40 },
    { x: 1000, z: -480, floor: -6, clearance: 38, kind: 'chicane', width: 42 },
    { x: 620, z: -140, floor: -6, clearance: 38, kind: 'chicane', width: 42 },
    { x: 60, z: -520, floor: -6, clearance: 40 },
    { x: -420, z: -760, floor: -6, clearance: 42 },
    { x: -900, z: -300, floor: -6, clearance: 44 },
    { x: -820, z: 380, floor: -6, clearance: 42 },
    { x: -360, z: 700, floor: -4, clearance: 44, kind: 'finish', width: 52 },
  ],
  spawn: { x: 0, z: -380, floor: -4, altitude: 46 },
  tail: [{ x: 0, z: 1100, floor: -6 }],
  rings: [
    { after: 0, t: 0.55, lateral: 0, height: 10 },
    { after: 2, t: 0.5, lateral: -12, height: 10 },
    { after: 3, t: 0.5, lateral: 10, height: 10 },
    { after: 6, t: 0.5, lateral: 0, height: 10 },
    { after: 9, t: 0.5, lateral: 12, height: 10 },
    { after: 11, t: 0.5, lateral: -12, height: 10 },
  ],
  landmarks: [
    { kind: 'lighthouse', x: 160, z: -470 },
    { kind: 'grandstand', x: -140, z: 140, rotation: Math.PI / 2 },
    { kind: 'tower', x: 140, z: -20 },
    { kind: 'spire', x: 420, z: 1020, scale: 0.6 },
    { kind: 'spire', x: 960, z: 1520, scale: 0.75 },
    { kind: 'spire', x: 1500, z: 1180, scale: 0.55 },
    { kind: 'lighthouse', x: 2120, z: 420 },
    { kind: 'spire', x: 1260, z: -560, scale: 0.6 },
    { kind: 'spire', x: 820, z: -360, scale: 0.5 },
    { kind: 'spire', x: -240, z: -900, scale: 0.7 },
    { kind: 'spire', x: -1100, z: 60, scale: 0.65 },
    { kind: 'arch', x: -880, z: 40, rotation: Math.PI / 2 + 0.1, scale: 0.75 },
    { kind: 'pylon', x: -620, z: 640 },
  ],
  valleyWidth: 120,
  valleyBlend: 160,
  mountains: {
    offsetX: -5000,
    offsetZ: 12500,
    ridgeWavelength: 1700,
    ridgeThreshold: 0.66,
    ridgeAmplitude: 700,
    rollingWavelength: 2200,
    rollingAmplitude: 90,
    base: -80,
    detailAmplitude: 14,
  },
  seaLevel: 0,
  parTime: 103,
  ceiling: 800,
  bounds: 4200,
  theme: CORAL_THEME,
};

/**
 * Ember Mesa: a dusk run between terraced red mesas. Tight, technical turns, a
 * natural arch, and a hop over a mesa top at the far end.
 */
const EMBER_MESA: CourseSpec = {
  id: 'ember-mesa',
  name: 'Ember Mesa',
  location: 'Red Shelf Badlands',
  description:
    'Racing into the sunset between terraced mesas: a tight chicane under the Ember Arch, a hop across a mesa top at the far end and a long, shadowed run home.',
  character: 'Technical',
  gates: [
    { x: 0, z: 160, floor: 0, clearance: 50, kind: 'start' },
    { x: -300, z: 700, floor: 6, clearance: 52 },
    { x: -260, z: 1280, floor: 12, clearance: 52 },
    { x: 260, z: 1600, floor: 20, clearance: 56 },
    { x: 860, z: 1460, floor: 30, clearance: 58 },
    { x: 1180, z: 980, floor: 34, clearance: 54, kind: 'chicane', width: 42 },
    { x: 900, z: 560, floor: 30, clearance: 54, kind: 'chicane', width: 42 },
    { x: 1260, z: 160, floor: 24, clearance: 56 },
    { x: 1800, z: -80, floor: 32, clearance: 62 },
    { x: 2160, z: -560, floor: 80, clearance: 80, kind: 'summit' },
    { x: 1860, z: -1080, floor: 40, clearance: 60 },
    { x: 1080, z: -980, floor: 20, clearance: 56 },
    { x: 560, z: -640, floor: 10, clearance: 54 },
    { x: 420, z: -60, floor: 4, clearance: 54, kind: 'finish', width: 52 },
  ],
  spawn: { x: 0, z: -400, floor: 0, altitude: 55 },
  tail: [{ x: 300, z: 500, floor: 4 }],
  rings: [
    { after: 0, t: 0.5, lateral: 0, height: 12 },
    { after: 2, t: 0.5, lateral: 12, height: 12 },
    { after: 4, t: 0.5, lateral: -10, height: 12 },
    { after: 7, t: 0.5, lateral: 0, height: 12 },
    { after: 10, t: 0.5, lateral: 12, height: 12 },
    { after: 11, t: 0.5, lateral: -10, height: 12 },
  ],
  landmarks: [
    { kind: 'hangar', x: -150, z: -520, rotation: 0, scale: 1 },
    { kind: 'hangar', x: 160, z: -560, rotation: 0.08, scale: 1.1 },
    { kind: 'tower', x: 140, z: -40 },
    { kind: 'grandstand', x: -130, z: 120, rotation: Math.PI / 2 },
    { kind: 'arch', x: 1040, z: 770, rotation: 0.95, scale: 1.05 },
    { kind: 'spire', x: -620, z: 1000, scale: 1.2 },
    { kind: 'spire', x: 560, z: 1900, scale: 1.4 },
    { kind: 'spire', x: 1500, z: 640, scale: 1.1 },
    { kind: 'antenna', x: 2380, z: -380 },
    { kind: 'pylon', x: 2000, z: -820 },
    { kind: 'spire', x: 1400, z: -1300, scale: 1.2 },
    { kind: 'pylon', x: 820, z: -860 },
  ],
  valleyWidth: 140,
  valleyBlend: 260,
  mountains: {
    offsetX: 12000,
    offsetZ: 3300,
    ridgeWavelength: 1100,
    ridgeThreshold: 0.24,
    ridgeAmplitude: 620,
    rollingWavelength: 2300,
    rollingAmplitude: 130,
    base: -10,
    detailAmplitude: 5,
    terrace: { step: 52, sharpness: 0.24 },
  },
  parTime: 100,
  ceiling: 900,
  bounds: 4200,
  theme: EMBER_THEME,
};

export const COURSES: readonly CourseSpec[] = [CALDERA_RIDGE, FROSTLINE_PASS, CORAL_COAST, EMBER_MESA];
export const DEFAULT_COURSE_ID = CALDERA_RIDGE.id;

export const getCourseSpec = (id: string): CourseSpec | undefined =>
  COURSES.find((course) => course.id === id);
export const isCourseId = (id: unknown): id is string => typeof id === 'string' && !!getCourseSpec(id);
