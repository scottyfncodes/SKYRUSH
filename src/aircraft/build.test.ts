import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUILD,
  buildProblem,
  buildsEqual,
  canFit,
  changedSlots,
  defaultBuildFor,
  isValidBuild,
  legacyPaint,
  migrateBuild,
  resolveBuild,
  withPart,
  type AircraftBuild,
} from './build';
import { AIRFRAMES, getAirframe } from './parts';
import { FACTORY_SETUPS } from './setups';
import { getTheme } from './paint';

describe('isValidBuild', () => {
  it('accepts every airframe’s factory build and every factory setup', () => {
    for (const airframe of AIRFRAMES) expect(isValidBuild(defaultBuildFor(airframe)), airframe.id).toBe(true);
    for (const setup of FACTORY_SETUPS) expect(buildProblem(setup.build), setup.id).toBeNull();
  });

  it('rejects null, primitives and arrays', () => {
    expect(isValidBuild(null)).toBe(false);
    expect(isValidBuild(undefined)).toBe(false);
    expect(isValidBuild(42)).toBe(false);
    expect(isValidBuild('airframe-sport')).toBe(false);
    expect(isValidBuild([])).toBe(false);
  });

  it('rejects unknown ids and ids in the wrong slot', () => {
    expect(buildProblem({ ...DEFAULT_BUILD, airframe: 'airframe-nope' })).toEqual({
      kind: 'unknown-airframe',
    });
    expect(buildProblem({ ...DEFAULT_BUILD, engine: 'engine-nope' })).toEqual({
      kind: 'unknown-part',
      category: 'engine',
    });
    expect(buildProblem({ ...DEFAULT_BUILD, engine: 'wings-compact' })).toEqual({
      kind: 'unknown-part',
      category: 'engine',
    });
  });

  it('rejects parts the airframe cannot take', () => {
    const scout = defaultBuildFor(getAirframe('airframe-scout')!);
    expect(buildProblem({ ...scout, gear: 'gear-floats' })).toEqual({
      kind: 'incompatible',
      category: 'gear',
    });
    expect(buildProblem({ ...scout, engine: 'engine-twin' })).toEqual({
      kind: 'incompatible',
      category: 'engine',
    });
    expect(canFit(scout, 'gear', 'gear-floats')).toBe(false);
    expect(canFit(scout, 'gear', 'gear-tundra')).toBe(true);
  });

  it('rejects missing or non-string fields', () => {
    const { tail: _tail, ...noTail } = DEFAULT_BUILD;
    expect(isValidBuild(noTail)).toBe(false);
    expect(isValidBuild({ ...DEFAULT_BUILD, engine: 3 })).toBe(false);
  });
});

describe('resolveBuild', () => {
  it('resolves every slot of a valid build', () => {
    const resolved = resolveBuild(DEFAULT_BUILD);
    expect(resolved.airframe.id).toBe(DEFAULT_BUILD.airframe);
    expect(resolved.engine.id).toBe(DEFAULT_BUILD.engine);
    expect(resolved.gear.id).toBe(DEFAULT_BUILD.gear);
  });

  it('throws on an invalid build', () => {
    expect(() => resolveBuild({ ...DEFAULT_BUILD, engine: 'engine-nope' })).toThrow(/Invalid aircraft build/);
  });
});

describe('withPart / buildsEqual / changedSlots', () => {
  it('swaps only the requested slot and returns a new object', () => {
    const next = withPart(DEFAULT_BUILD, 'engine', 'engine-twin');
    expect(next).not.toBe(DEFAULT_BUILD);
    expect(next.engine).toBe('engine-twin');
    expect(changedSlots(DEFAULT_BUILD, next)).toEqual(['engine']);
    expect(DEFAULT_BUILD.engine).toBe('engine-efficient');
  });

  it('compares by value', () => {
    expect(buildsEqual(DEFAULT_BUILD, { ...DEFAULT_BUILD })).toBe(true);
    expect(buildsEqual(DEFAULT_BUILD, withPart(DEFAULT_BUILD, 'wings', 'wings-highlift'))).toBe(false);
  });
});

describe('migrateBuild (version 1 saves)', () => {
  it('maps the original fuselages to airframes and keeps compatible parts', () => {
    const migrated = migrateBuild({
      fuselage: 'fuselage-allrounder',
      engine: 'engine-twin',
      wings: 'wings-compact',
      livery: 'livery-glacier',
    });
    expect(migrated).toEqual<AircraftBuild>({
      ...DEFAULT_BUILD,
      engine: 'engine-twin',
      wings: 'wings-compact',
    });
  });

  it('falls back to factory parts for slots the new airframe cannot take', () => {
    const migrated = migrateBuild({
      fuselage: 'fuselage-needle',
      engine: 'engine-twin',
      wings: 'wings-highlift',
    });
    const racer = defaultBuildFor(getAirframe('airframe-racer')!);
    expect(migrated).toEqual({ ...racer });
    expect(
      migrateBuild({ fuselage: 'fuselage-heavy', engine: 'engine-efficient', wings: 'wings-balanced' }),
    ).toEqual({
      ...defaultBuildFor(getAirframe('airframe-cruiser')!),
      engine: 'engine-efficient',
      wings: 'wings-balanced',
    });
  });

  it('returns null for unrecognisable data', () => {
    expect(migrateBuild(null)).toBeNull();
    expect(migrateBuild({ fuselage: 'fuselage-nope' })).toBeNull();
    expect(migrateBuild('nope')).toBeNull();
  });

  it('turns an old livery id into the theme of the same name', () => {
    expect(legacyPaint({ livery: 'livery-glacier' })).toEqual(getTheme('livery-glacier')!.paint);
    expect(legacyPaint({ livery: 'livery-unknown' })).toBeNull();
  });
});
