import { describe, expect, it } from 'vitest';
import {
  AIRFRAMES,
  ALL_ITEMS,
  ALL_PARTS,
  PART_CATEGORIES,
  airframesAccepting,
  describeUnlock,
  getAirframe,
  getItem,
  getPart,
  getPartIn,
  isCompatible,
  partsForCategory,
  type UnlockRule,
} from './parts';

describe('aircraft catalogue', () => {
  it('has seven stock airframes, one per archetype, plus the Workshop Special', () => {
    expect(AIRFRAMES).toHaveLength(8);
    expect(new Set(AIRFRAMES.map((a) => a.archetype)).size).toBe(8);
    expect(new Set(AIRFRAMES.map((a) => a.visual)).size).toBe(8);
  });

  it('every stock airframe brings a nose, cabin and tail boom section', () => {
    for (const airframe of AIRFRAMES.filter((a) => a.id !== 'airframe-custom')) {
      for (const category of ['nose', 'cabin', 'boom'] as const) {
        const section = getPartIn(category, airframe.defaults[category]);
        expect(section?.kind === 'part' && 'source' in section && section.source).toBe(airframe.id);
        expect(airframe.accepts[category]).toEqual([airframe.defaults[category]]);
      }
    }
  });

  it('has several parts in every slot', () => {
    for (const category of PART_CATEGORIES)
      expect(partsForCategory(category).length).toBeGreaterThanOrEqual(4);
  });

  it('has unique ids across airframes and parts', () => {
    const ids = ALL_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every item explains itself: role, strength, trade-off and copy without em dashes', () => {
    for (const item of ALL_ITEMS) {
      for (const text of [
        item.name,
        item.tagline,
        item.description,
        item.role,
        item.strength,
        item.tradeoff,
      ]) {
        expect(text.length, item.id).toBeGreaterThan(0);
        expect(text, item.id).not.toContain('—');
      }
      expect(item.price).toBeGreaterThanOrEqual(0);
    }
    for (const part of ALL_PARTS) expect(part.look.length, part.id).toBeGreaterThan(0);
  });

  it('defaults and sections are free; everything sold has a price', () => {
    for (const item of ALL_ITEMS) {
      const free =
        item.unlock.kind === 'default' || item.unlock.kind === 'airframe' || item.unlock.kind === 'rival';
      if (free) expect(item.price, item.id).toBe(0);
      else expect(item.price, item.id).toBeGreaterThan(0);
    }
  });

  it('prerequisites point at real items of the same slot', () => {
    for (const part of ALL_PARTS) {
      if (!part.requires) continue;
      const required = getPart(part.requires);
      expect(required, part.id).toBeDefined();
      expect(required!.category).toBe(part.category);
    }
  });

  it('typed getters only return parts of their category', () => {
    expect(getPartIn('engine', 'engine-twin')?.id).toBe('engine-twin');
    expect(getPartIn('engine', 'wings-compact')).toBeUndefined();
    expect(getPartIn('wings', 'wings-compact')?.id).toBe('wings-compact');
    expect(getPart('nope')).toBeUndefined();
    expect(getAirframe('engine-twin')).toBeUndefined();
    expect(getItem('airframe-scout')?.kind).toBe('airframe');
  });
});

describe('compatibility', () => {
  it('every airframe accepts only real parts of the right slot, including its own defaults', () => {
    for (const airframe of AIRFRAMES) {
      for (const category of PART_CATEGORIES) {
        expect(airframe.accepts[category].length, `${airframe.id} ${category}`).toBeGreaterThan(0);
        for (const id of airframe.accepts[category]) expect(getPartIn(category, id), id).toBeDefined();
        expect(airframe.accepts[category]).toContain(airframe.defaults[category]);
      }
    }
  });

  it('every part fits at least one airframe', () => {
    for (const part of ALL_PARTS) expect(airframesAccepting(part).length, part.id).toBeGreaterThan(0);
  });

  it('encodes the physical rules: floats for water aircraft, twins for big wings, seaplane only on floats', () => {
    const seaplane = getAirframe('airframe-seaplane')!;
    const scout = getAirframe('airframe-scout')!;
    const racer = getAirframe('airframe-racer')!;
    expect(seaplane.accepts.gear).toEqual(['gear-floats']);
    expect(isCompatible(scout, getPart('gear-floats')!)).toBe(false);
    expect(isCompatible(scout, getPart('engine-twin')!)).toBe(false);
    expect(isCompatible(racer, getPart('wings-glider')!)).toBe(false);
    expect(isCompatible(getAirframe('airframe-bush')!, getPart('gear-floats')!)).toBe(true);
    expect(isCompatible(getAirframe('airframe-cruiser')!, getPart('engine-twin')!)).toBe(true);
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
      { kind: 'wins', count: 1 },
      { kind: 'style', score: 3000 },
    ];
    for (const rule of rules) expect(describeUnlock(rule).length).toBeGreaterThan(0);
    expect(describeUnlock({ kind: 'races', count: 1 })).toBe('Finish 1 race to unlock');
    expect(describeUnlock({ kind: 'races', count: 3 })).toBe('Finish 3 races to unlock');
    expect(describeUnlock({ kind: 'podium', count: 1 })).toContain('once');
    expect(describeUnlock({ kind: 'podium', count: 2 })).toContain('2 times');
    expect(describeUnlock({ kind: 'style', score: 3000 })).toContain('3,000');
  });
});
