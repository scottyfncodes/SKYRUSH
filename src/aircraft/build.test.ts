import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUILD,
  buildsEqual,
  isValidBuild,
  resolveBuild,
  withPart,
  type AircraftBuild,
} from './build';

describe('isValidBuild', () => {
  it('accepts the default build', () => {
    expect(isValidBuild(DEFAULT_BUILD)).toBe(true);
  });

  it('rejects null, primitives and arrays', () => {
    expect(isValidBuild(null)).toBe(false);
    expect(isValidBuild(undefined)).toBe(false);
    expect(isValidBuild(42)).toBe(false);
    expect(isValidBuild('fuselage-needle')).toBe(false);
    expect(isValidBuild([])).toBe(false);
  });

  it('rejects unknown ids', () => {
    expect(isValidBuild({ ...DEFAULT_BUILD, fuselage: 'fuselage-nope' })).toBe(false);
    expect(isValidBuild({ ...DEFAULT_BUILD, engine: 'engine-nope' })).toBe(false);
    expect(isValidBuild({ ...DEFAULT_BUILD, wings: 'wings-nope' })).toBe(false);
    expect(isValidBuild({ ...DEFAULT_BUILD, livery: 'livery-nope' })).toBe(false);
  });

  it('rejects ids of the wrong part type in a slot', () => {
    expect(isValidBuild({ ...DEFAULT_BUILD, fuselage: 'engine-twin' })).toBe(false);
    expect(isValidBuild({ ...DEFAULT_BUILD, engine: 'wings-compact' })).toBe(false);
    expect(isValidBuild({ ...DEFAULT_BUILD, wings: 'fuselage-needle' })).toBe(false);
  });

  it('rejects missing or non-string fields', () => {
    const { livery: _livery, ...noLivery } = DEFAULT_BUILD;
    expect(isValidBuild(noLivery)).toBe(false);
    expect(isValidBuild({ ...DEFAULT_BUILD, engine: 3 })).toBe(false);
  });
});

describe('resolveBuild', () => {
  it('resolves every slot of a valid build', () => {
    const resolved = resolveBuild(DEFAULT_BUILD);
    expect(resolved.fuselage.id).toBe(DEFAULT_BUILD.fuselage);
    expect(resolved.engine.id).toBe(DEFAULT_BUILD.engine);
    expect(resolved.wings.id).toBe(DEFAULT_BUILD.wings);
    expect(resolved.livery.id).toBe(DEFAULT_BUILD.livery);
  });

  it('throws on an invalid build', () => {
    expect(() => resolveBuild({ ...DEFAULT_BUILD, engine: 'engine-nope' })).toThrow(/Invalid aircraft build/);
    expect(() => resolveBuild({ ...DEFAULT_BUILD, livery: '' })).toThrow();
  });
});

describe('withPart', () => {
  it('swaps only the requested category and returns a new object', () => {
    const next = withPart(DEFAULT_BUILD, 'engine', 'engine-twin');
    expect(next).not.toBe(DEFAULT_BUILD);
    expect(next.engine).toBe('engine-twin');
    expect(next.fuselage).toBe(DEFAULT_BUILD.fuselage);
    expect(next.wings).toBe(DEFAULT_BUILD.wings);
    expect(next.livery).toBe(DEFAULT_BUILD.livery);
    expect(DEFAULT_BUILD.engine).toBe('engine-efficient');
  });

  it('swaps fuselage and wings independently', () => {
    const a = withPart(DEFAULT_BUILD, 'fuselage', 'fuselage-heavy');
    const b = withPart(a, 'wings', 'wings-compact');
    expect(b).toEqual<AircraftBuild>({
      ...DEFAULT_BUILD,
      fuselage: 'fuselage-heavy',
      wings: 'wings-compact',
    });
  });
});

describe('buildsEqual', () => {
  it('compares by value', () => {
    expect(buildsEqual(DEFAULT_BUILD, { ...DEFAULT_BUILD })).toBe(true);
    expect(buildsEqual(DEFAULT_BUILD, withPart(DEFAULT_BUILD, 'wings', 'wings-highlift'))).toBe(false);
    expect(buildsEqual(DEFAULT_BUILD, { ...DEFAULT_BUILD, livery: 'livery-signal' })).toBe(false);
  });
});
