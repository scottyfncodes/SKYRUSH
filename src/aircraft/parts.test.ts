import { describe, expect, it } from 'vitest';
import {
  ALL_PARTS,
  DEFAULT_LIVERY_ID,
  DEFAULT_PART_IDS,
  ENGINES,
  FUSELAGES,
  LIVERIES,
  WINGS,
  describeUnlock,
  getEngine,
  getFuselage,
  getLivery,
  getPart,
  getWings,
  partsForCategory,
  type UnlockRule,
} from './parts';

describe('part catalogue', () => {
  it('has three parts per category', () => {
    expect(FUSELAGES).toHaveLength(3);
    expect(ENGINES).toHaveLength(3);
    expect(WINGS).toHaveLength(3);
    expect(ALL_PARTS).toHaveLength(9);
  });

  it('has unique part ids and livery ids', () => {
    const ids = ALL_PARTS.map((part) => part.id);
    expect(new Set(ids).size).toBe(ids.length);
    const liveryIds = LIVERIES.map((livery) => livery.id);
    expect(new Set(liveryIds).size).toBe(liveryIds.length);
  });

  it('every part has a sane price, positive mass and a category matching its list', () => {
    for (const part of FUSELAGES) expect(part.category).toBe('fuselage');
    for (const part of ENGINES) expect(part.category).toBe('engine');
    for (const part of WINGS) expect(part.category).toBe('wings');
    for (const part of ALL_PARTS) {
      expect(part.price).toBeGreaterThanOrEqual(0);
      expect(part.mass).toBeGreaterThan(0);
      expect(part.name.length).toBeGreaterThan(0);
    }
  });

  it('default parts are exactly the ones with a default unlock rule', () => {
    const defaults = ALL_PARTS.filter((part) => part.unlock.kind === 'default').map((part) => part.id);
    expect(defaults.sort()).toEqual(Object.values(DEFAULT_PART_IDS).sort());
    for (const id of Object.values(DEFAULT_PART_IDS)) expect(getPart(id)?.price).toBe(0);
    expect(getLivery(DEFAULT_LIVERY_ID)).toBeDefined();
  });

  it('typed getters only return parts of their category', () => {
    expect(getFuselage('fuselage-needle')?.id).toBe('fuselage-needle');
    expect(getFuselage('engine-twin')).toBeUndefined();
    expect(getEngine('engine-twin')?.id).toBe('engine-twin');
    expect(getEngine('wings-compact')).toBeUndefined();
    expect(getWings('wings-compact')?.id).toBe('wings-compact');
    expect(getWings('fuselage-needle')).toBeUndefined();
    expect(getPart('nope')).toBeUndefined();
    expect(getLivery('nope')).toBeUndefined();
  });

  it('partsForCategory returns the matching list', () => {
    expect(partsForCategory('fuselage')).toBe(FUSELAGES);
    expect(partsForCategory('engine')).toBe(ENGINES);
    expect(partsForCategory('wings')).toBe(WINGS);
  });
});

describe('describeUnlock', () => {
  it('returns text for every rule kind', () => {
    const rules: UnlockRule[] = [
      { kind: 'default' },
      { kind: 'purchase' },
      { kind: 'races', count: 1 },
      { kind: 'races', count: 3 },
      { kind: 'podium', count: 1 },
      { kind: 'podium', count: 2 },
    ];
    for (const rule of rules) {
      const text = describeUnlock(rule);
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    }
    expect(describeUnlock({ kind: 'races', count: 1 })).toBe('Finish 1 race to unlock');
    expect(describeUnlock({ kind: 'races', count: 3 })).toBe('Finish 3 races to unlock');
    expect(describeUnlock({ kind: 'podium', count: 1 })).toContain('once');
    expect(describeUnlock({ kind: 'podium', count: 2 })).toContain('2 times');
  });

  it('covers the rule of every catalogue part', () => {
    for (const part of ALL_PARTS) expect(describeUnlock(part.unlock).length).toBeGreaterThan(0);
  });
});
