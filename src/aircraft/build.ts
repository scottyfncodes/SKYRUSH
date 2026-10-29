import {
  DEFAULT_AIRFRAME_ID,
  PART_CATEGORIES,
  getAirframe,
  getPartIn,
  isCompatible,
  type Airframe,
  type EnginePart,
  type FramePart,
  type GearPart,
  type PartCategory,
  type PropPart,
  type TailPart,
  type WingPart,
} from './parts';
import { DEFAULT_PAINT, getTheme, type Paint } from './paint';

/**
 * A persisted aircraft configuration: the airframe plus one part per slot.
 * Performance is derived from this alone; paint lives beside it in `AircraftSetup`.
 */
export interface AircraftBuild {
  airframe: string;
  frame: string;
  engine: string;
  prop: string;
  wings: string;
  tail: string;
  gear: string;
}

/** Everything needed to draw an aircraft: what it is made of and how it is painted. */
export interface AircraftSetup {
  build: AircraftBuild;
  paint: Paint;
  /** Wins painted under the canopy as small gate marks (cosmetic). */
  marks?: number;
}

export interface ResolvedBuild {
  airframe: Airframe;
  frame: FramePart;
  engine: EnginePart;
  prop: PropPart;
  wings: WingPart;
  tail: TailPart;
  gear: GearPart;
}

/** The factory configuration of an airframe. */
export const defaultBuildFor = (airframe: Airframe): AircraftBuild => ({
  airframe: airframe.id,
  ...airframe.defaults,
});

export const DEFAULT_BUILD: AircraftBuild = Object.freeze(defaultBuildFor(getAirframe(DEFAULT_AIRFRAME_ID)!));

export type BuildProblem =
  | { kind: 'shape' }
  | { kind: 'unknown-airframe' }
  | { kind: 'unknown-part'; category: PartCategory }
  | { kind: 'incompatible'; category: PartCategory };

/** Explains why a build is invalid, or returns null when it is valid. */
export const buildProblem = (build: unknown): BuildProblem | null => {
  if (typeof build !== 'object' || build === null || Array.isArray(build)) return { kind: 'shape' };
  const candidate = build as Record<string, unknown>;
  if (typeof candidate.airframe !== 'string') return { kind: 'shape' };
  const airframe = getAirframe(candidate.airframe);
  if (!airframe) return { kind: 'unknown-airframe' };
  for (const category of PART_CATEGORIES) {
    const id = candidate[category];
    if (typeof id !== 'string') return { kind: 'shape' };
    const part = getPartIn(category, id);
    if (!part) return { kind: 'unknown-part', category };
    if (!isCompatible(airframe, part)) return { kind: 'incompatible', category };
  }
  return null;
};

export const isValidBuild = (build: unknown): build is AircraftBuild => buildProblem(build) === null;

export const resolveBuild = (build: AircraftBuild): ResolvedBuild => {
  if (!isValidBuild(build)) throw new Error(`Invalid aircraft build: ${JSON.stringify(build)}`);
  return {
    airframe: getAirframe(build.airframe)!,
    frame: getPartIn('frame', build.frame)!,
    engine: getPartIn('engine', build.engine)!,
    prop: getPartIn('prop', build.prop)!,
    wings: getPartIn('wings', build.wings)!,
    tail: getPartIn('tail', build.tail)!,
    gear: getPartIn('gear', build.gear)!,
  };
};

/** Copy of the build with one slot swapped. Does not check compatibility; see `canFit`. */
export const withPart = (build: AircraftBuild, category: PartCategory, partId: string): AircraftBuild => ({
  ...build,
  [category]: partId,
});

/** Whether `partId` can go in `category` on this build's airframe. */
export const canFit = (build: AircraftBuild, category: PartCategory, partId: string): boolean => {
  const airframe = getAirframe(build.airframe);
  const part = getPartIn(category, partId);
  return !!airframe && !!part && isCompatible(airframe, part);
};

export const buildsEqual = (a: AircraftBuild, b: AircraftBuild): boolean =>
  a.airframe === b.airframe && PART_CATEGORIES.every((category) => a[category] === b[category]);

/** Parts in `next` that differ from `current`, slot by slot. */
export const changedSlots = (current: AircraftBuild, next: AircraftBuild): PartCategory[] =>
  PART_CATEGORIES.filter((category) => current[category] !== next[category]);

// --- Migration from the original three-slot builds --------------------------------------

/** Original fuselage ids and the airframe each became. */
export const LEGACY_FUSELAGES: Record<string, string> = {
  'fuselage-allrounder': 'airframe-sport',
  'fuselage-needle': 'airframe-racer',
  'fuselage-heavy': 'airframe-cruiser',
};

/**
 * Converts any saved build (current or the original {fuselage, engine, wings, livery}
 * shape) into a valid current build. Parts the airframe cannot take fall back to its
 * factory parts slot by slot. Returns null when nothing usable is recognisable.
 */
export const migrateBuild = (raw: unknown): AircraftBuild | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const airframeId =
    typeof data.airframe === 'string'
      ? data.airframe
      : typeof data.fuselage === 'string'
        ? LEGACY_FUSELAGES[data.fuselage]
        : undefined;
  const airframe = airframeId ? getAirframe(airframeId) : undefined;
  if (!airframe) return null;
  const build = defaultBuildFor(airframe);
  for (const category of PART_CATEGORIES) {
    const id = data[category];
    if (typeof id !== 'string') continue;
    const part = getPartIn(category, id);
    if (part && isCompatible(airframe, part)) build[category] = part.id;
  }
  return build;
};

/** Paint from an original build's `livery` id (each became a theme with the same id). */
export const legacyPaint = (raw: unknown): Paint | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const livery = (raw as Record<string, unknown>).livery;
  if (typeof livery !== 'string') return null;
  const theme = getTheme(livery);
  return theme ? { ...theme.paint } : null;
};

export const defaultSetup = (): AircraftSetup => ({
  build: { ...DEFAULT_BUILD },
  paint: { ...DEFAULT_PAINT },
});
