import {
  DEFAULT_LIVERY_ID,
  DEFAULT_PART_IDS,
  getEngine,
  getFuselage,
  getLivery,
  getWings,
  type EnginePart,
  type FuselagePart,
  type Livery,
  type PartCategory,
  type WingPart,
} from './parts';

/** A persisted aircraft configuration: one part per category plus a livery. */
export interface AircraftBuild {
  fuselage: string;
  engine: string;
  wings: string;
  livery: string;
}

export interface ResolvedBuild {
  fuselage: FuselagePart;
  engine: EnginePart;
  wings: WingPart;
  livery: Livery;
}

export const DEFAULT_BUILD: AircraftBuild = {
  fuselage: DEFAULT_PART_IDS.fuselage,
  engine: DEFAULT_PART_IDS.engine,
  wings: DEFAULT_PART_IDS.wings,
  livery: DEFAULT_LIVERY_ID,
};

export const isValidBuild = (build: unknown): build is AircraftBuild => {
  if (typeof build !== 'object' || build === null) return false;
  const candidate = build as Record<string, unknown>;
  return (
    typeof candidate.fuselage === 'string' &&
    typeof candidate.engine === 'string' &&
    typeof candidate.wings === 'string' &&
    typeof candidate.livery === 'string' &&
    getFuselage(candidate.fuselage) !== undefined &&
    getEngine(candidate.engine) !== undefined &&
    getWings(candidate.wings) !== undefined &&
    getLivery(candidate.livery) !== undefined
  );
};

export const resolveBuild = (build: AircraftBuild): ResolvedBuild => {
  const fuselage = getFuselage(build.fuselage);
  const engine = getEngine(build.engine);
  const wings = getWings(build.wings);
  const livery = getLivery(build.livery);
  if (!fuselage || !engine || !wings || !livery) {
    throw new Error(`Invalid aircraft build: ${JSON.stringify(build)}`);
  }
  return { fuselage, engine, wings, livery };
};

export const withPart = (build: AircraftBuild, category: PartCategory, partId: string): AircraftBuild => ({
  ...build,
  [category]: partId,
});

export const buildsEqual = (a: AircraftBuild, b: AircraftBuild): boolean =>
  a.fuselage === b.fuselage && a.engine === b.engine && a.wings === b.wings && a.livery === b.livery;
