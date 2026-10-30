import {
  COMPONENT_CATEGORIES,
  DEFAULT_AIRFRAME_ID,
  PART_CATEGORIES,
  SECTION_CATEGORIES,
  getAirframe,
  getPartIn,
  isCompatible,
  type Airframe,
  type ComponentCategory,
  type SectionPart,
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
 * A persisted aircraft configuration: the airframe, its three fuselage sections and one
 * part per slot. Stock aircraft always carry their own sections; the Workshop Special
 * takes any. Performance is derived from this alone; paint lives beside it in `AircraftSetup`.
 */
export interface AircraftBuild {
  airframe: string;
  nose: string;
  cabin: string;
  boom: string;
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
  /** The airframe as it flies: for a Workshop Special, composed from its sections. */
  airframe: Airframe;
  nose: SectionPart;
  cabin: SectionPart;
  boom: SectionPart;
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

export const CUSTOM_AIRFRAME_ID = 'airframe-custom';

/** How much each section contributes to an airframe property (weights sum to 1). */
const SECTION_WEIGHTS = {
  mass: { nose: 0.25, cabin: 0.45, boom: 0.3 },
  dragArea: { nose: 0.3, cabin: 0.45, boom: 0.25 },
  pitchRate: { nose: 0.3, cabin: 0.2, boom: 0.5 },
  responsiveness: { nose: 0.4, cabin: 0.2, boom: 0.4 },
  stability: { nose: 0.15, cabin: 0.25, boom: 0.6 },
  rollFactor: { nose: 0.3, cabin: 0.7, boom: 0 },
  durability: { nose: 0.3, cabin: 0.5, boom: 0.2 },
  coolingBonus: { nose: 1, cabin: 0, boom: 0 },
} as const;

type SectionIds = Pick<AircraftBuild, 'airframe' | 'nose' | 'cabin' | 'boom'>;

const sourceOf = (category: 'nose' | 'cabin' | 'boom', id: string): Airframe | undefined => {
  const section = getPartIn(category, id);
  return section ? getAirframe(section.source) : undefined;
};

/**
 * The airframe a build actually flies. Stock aircraft are returned as they are. A
 * Workshop Special blends its sections' airframes: mass and drag add up section by
 * section, handling is a weighted mix, and which parts fit follows the sections:
 * single engines mount in the nose, wing engines need a cabin whose wings carry them,
 * wings and gear follow the cabin, tails follow the boom.
 */
export const effectiveAirframe = (build: SectionIds): Airframe | undefined => {
  const base = getAirframe(build.airframe);
  if (!base || base.id !== CUSTOM_AIRFRAME_ID) return base;
  const nose = sourceOf('nose', build.nose);
  const cabin = sourceOf('cabin', build.cabin);
  const boom = sourceOf('boom', build.boom);
  if (!nose || !cabin || !boom) return undefined;
  const sources = { nose, cabin, boom };
  const blend = (key: keyof typeof SECTION_WEIGHTS): number =>
    (Object.keys(sources) as (keyof typeof sources)[]).reduce(
      (sum, part) => sum + SECTION_WEIGHTS[key][part] * sources[part][key],
      0,
    );
  const twins = ['engine-twin', 'engine-pod'].filter((id) => cabin.accepts.engine.includes(id));
  // A nose without an engine bay (the Petrel's) only takes a single engine on a pylon cabin.
  const noseEngines = nose.accepts.engine.filter(
    (id) => !twins.includes(id) && id !== 'engine-twin' && id !== 'engine-pod',
  );
  const singles = nose.visual === 'seaplane' && cabin.visual !== 'seaplane' ? [] : noseEngines;
  const engines = [...singles, ...twins];
  return {
    ...base,
    mass: blend('mass'),
    dragArea: blend('dragArea'),
    pitchRate: blend('pitchRate'),
    responsiveness: blend('responsiveness'),
    stability: blend('stability'),
    rollFactor: blend('rollFactor'),
    durability: blend('durability'),
    coolingBonus: blend('coolingBonus'),
    wingScale: cabin.wingScale,
    wingSets: cabin.wingSets,
    accepts: {
      ...base.accepts,
      engine: engines.length ? engines : nose.accepts.engine,
      prop: [...new Set([...nose.accepts.prop, ...cabin.accepts.prop])],
      wings: cabin.accepts.wings,
      gear: cabin.accepts.gear,
      tail: boom.accepts.tail,
    },
  };
};

/** Display name: a Workshop Special is named after the aircraft its sections came from. */
export const buildName = (build: SectionIds): string => {
  const airframe = getAirframe(build.airframe);
  if (!airframe) return '';
  if (airframe.id !== CUSTOM_AIRFRAME_ID) return airframe.name;
  const names = [
    ...new Set([sourceOf('nose', build.nose), sourceOf('cabin', build.cabin), sourceOf('boom', build.boom)]),
  ]
    .filter((source): source is Airframe => !!source)
    .map((source) => source.name);
  return names.length > 1 ? `${names.join('–')} Special` : `${names[0] ?? 'Workshop'} Special`;
};

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
  const base = getAirframe(candidate.airframe);
  if (!base) return { kind: 'unknown-airframe' };
  // Sections first: on a Workshop Special they decide what else fits.
  for (const category of SECTION_CATEGORIES) {
    const id = candidate[category];
    if (typeof id !== 'string') return { kind: 'shape' };
    const part = getPartIn(category, id);
    if (!part) return { kind: 'unknown-part', category };
    if (!isCompatible(base, part)) return { kind: 'incompatible', category };
  }
  const airframe = effectiveAirframe(candidate as unknown as SectionIds)!;
  for (const category of COMPONENT_CATEGORIES) {
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
    airframe: effectiveAirframe(build)!,
    nose: getPartIn('nose', build.nose)!,
    cabin: getPartIn('cabin', build.cabin)!,
    boom: getPartIn('boom', build.boom)!,
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
  const airframe = effectiveAirframe(build);
  const part = getPartIn(category, partId);
  return !!airframe && !!part && isCompatible(airframe, part);
};

/**
 * Swaps a section on a Workshop Special and repairs every component that no longer
 * fits, falling back first to the old part's compatible alternative (the factory part
 * of the new section's aircraft) and then to anything that fits.
 */
export const withSection = (
  build: AircraftBuild,
  category: 'nose' | 'cabin' | 'boom',
  sectionId: string,
  owns: (id: string) => boolean = () => true,
): AircraftBuild => {
  const next = withPart(build, category, sectionId);
  const airframe = effectiveAirframe(next);
  const source = sourceOf(category, sectionId);
  if (!airframe) return next;
  for (const slot of COMPONENT_CATEGORIES) {
    const accepts = airframe.accepts[slot];
    if (accepts.includes(next[slot])) continue;
    const preferred = source?.defaults[slot];
    next[slot] =
      (preferred && accepts.includes(preferred) && owns(preferred) ? preferred : undefined) ??
      accepts.find(owns) ??
      accepts[0]!;
  }
  return next;
};

/** Components a section swap would have to replace (for the hangar's warning). */
export const sectionSwapCosts = (
  build: AircraftBuild,
  category: 'nose' | 'cabin' | 'boom',
  sectionId: string,
  owns: (id: string) => boolean = () => true,
): ComponentCategory[] => {
  const next = withSection(build, category, sectionId, owns);
  return COMPONENT_CATEGORIES.filter((slot) => next[slot] !== build[slot]);
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
  for (const category of SECTION_CATEGORIES) {
    const id = data[category];
    if (typeof id !== 'string') continue;
    const part = getPartIn(category, id);
    if (part && isCompatible(airframe, part)) build[category] = part.id;
  }
  const effective = effectiveAirframe(build) ?? airframe;
  for (const category of COMPONENT_CATEGORIES) {
    const id = data[category];
    const part = typeof id === 'string' ? getPartIn(category, id) : undefined;
    if (part && isCompatible(effective, part)) build[category] = part.id;
    else if (!effective.accepts[category].includes(build[category]))
      build[category] = effective.accepts[category][0]!;
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
