import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD, defaultBuildFor } from '../aircraft/build';
import { getAirframe } from '../aircraft/parts';
import { DEFAULT_PAINT, getTheme } from '../aircraft/paint';
import {
  MAX_HISTORY,
  STARTING_CREDITS,
  activeBuild,
  activeEntry,
  createDefaultProfile,
  factoryPaint,
  sanitiseProfile,
  type PlayerProfile,
} from './profile';
import {
  SAVE_KEY,
  clearProfile,
  createMemoryStorage,
  loadProfile,
  saveProfile,
  type StorageLike,
} from './save';

const defaults = createDefaultProfile();

const throwingStorage = (): StorageLike => ({
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
});

describe('save/load round trip', () => {
  it('restores a saved profile exactly: aircraft, parts, paint, setups and progress', () => {
    const storage = createMemoryStorage();
    const scout = getAirframe('airframe-scout')!;
    const profile: PlayerProfile = {
      ...createDefaultProfile(),
      credits: 4321,
      ownedParts: [
        ...defaults.ownedParts,
        'wings-compact',
        'airframe-scout',
        ...Object.values(scout.defaults),
      ],
      activeAircraft: 'airframe-scout',
      hangar: {
        'airframe-sport': {
          build: { ...DEFAULT_BUILD, wings: 'wings-compact' },
          paint: getTheme('livery-signal')!.paint,
        },
        'airframe-scout': {
          build: defaultBuildFor(scout),
          paint: { ...DEFAULT_PAINT, primary: 'teal', pattern: 'bands', number: 33 },
        },
      },
      setups: [{ id: 'setup-1', name: 'Fast one', build: { ...DEFAULT_BUILD }, paint: { ...DEFAULT_PAINT } }],
      revealed: ['airframe-sport', 'airframe-scout'],
      bestTime: 98.5,
      bestTimeBuild: { ...DEFAULT_BUILD },
      bestTimes: { 'caldera-ridge': 98.5, 'coral-coast': 101.25 },
      selectedCircuit: 'ember-mesa',
      racesCompleted: 3,
      podiums: 2,
      wins: 1,
      history: [
        {
          circuitId: 'caldera-ridge',
          position: 2,
          time: 98.5,
          rawTime: 94.5,
          missedGates: 1,
          credits: 1000,
          date: '2026-01-02T03:04:05.000Z',
          build: { ...DEFAULT_BUILD },
          style: 6400,
        },
      ],
      settings: { assist: 0.3, invertPitch: true, audio: false, sensitivity: 1.2, haptics: false },
      bestStyle: 6400,
      bestMultiplier: 2.5,
      badges: ['ring-runner'],
      badgeProgress: { 'ring-runner': 1, bullseye: 0.5 },
    };
    expect(saveProfile(storage, profile)).toBe(true);
    const loaded = loadProfile(storage);
    expect(loaded.recovered).toBe(false);
    expect(loaded.profile).toEqual({ ...profile, ownedParts: loaded.profile.ownedParts });
    expect([...loaded.profile.ownedParts].sort()).toEqual([...new Set(profile.ownedParts)].sort());
  });

  it('supports a custom key and clearProfile', () => {
    const storage = createMemoryStorage();
    saveProfile(storage, createDefaultProfile(), 'custom');
    expect(loadProfile(storage, 'custom').recovered).toBe(false);
    expect(loadProfile(storage).recovered).toBe(true);
    clearProfile(storage, 'custom');
    expect(loadProfile(storage, 'custom').recovered).toBe(true);
  });
});

describe('migrating version 1 saves', () => {
  const v1 = {
    version: 1,
    credits: 5100,
    ownedParts: [
      'fuselage-allrounder',
      'engine-efficient',
      'wings-balanced',
      'fuselage-needle',
      'engine-twin',
      'wings-compact',
    ],
    build: {
      fuselage: 'fuselage-allrounder',
      engine: 'engine-twin',
      wings: 'wings-compact',
      livery: 'livery-glacier',
    },
    bestTime: 101.2,
    bestTimeBuild: {
      fuselage: 'fuselage-needle',
      engine: 'engine-efficient',
      wings: 'wings-compact',
      livery: 'livery-ember',
    },
    racesCompleted: 6,
    podiums: 3,
    wins: 2,
    history: [
      {
        circuitId: 'caldera-ridge',
        position: 1,
        time: 101.2,
        rawTime: 101.2,
        missedGates: 0,
        credits: 1800,
        date: '2026-01-02T03:04:05.000Z',
        build: {
          fuselage: 'fuselage-heavy',
          engine: 'engine-twin',
          wings: 'wings-balanced',
          livery: 'livery-midnight',
        },
      },
    ],
    settings: { assist: 0.4, invertPitch: false, audio: true, sensitivity: 1 },
  };

  it('keeps credits, progress and every owned part, turning fuselages into aircraft', () => {
    const profile = sanitiseProfile(v1);
    expect(profile.version).toBe(2);
    expect(profile.credits).toBe(5100);
    expect(profile.racesCompleted).toBe(6);
    expect(profile.wins).toBe(2);
    for (const id of ['airframe-sport', 'airframe-racer', 'engine-twin', 'wings-compact'])
      expect(profile.ownedParts).toContain(id);
    expect(profile.ownedParts.some((id) => id.startsWith('fuselage-'))).toBe(false);
    expect(Object.keys(profile.hangar).sort()).toEqual(['airframe-racer', 'airframe-sport']);
  });

  it('keeps the installed build and its livery on the matching aircraft', () => {
    const profile = sanitiseProfile(v1);
    expect(profile.activeAircraft).toBe('airframe-sport');
    expect(activeBuild(profile)).toEqual({ ...DEFAULT_BUILD, engine: 'engine-twin', wings: 'wings-compact' });
    expect(activeEntry(profile).paint).toEqual(getTheme('livery-glacier')!.paint);
    expect(profile.hangar['airframe-racer']!.paint).toEqual(factoryPaint('airframe-racer'));
  });

  it('migrates history and best-time builds instead of dropping them', () => {
    const profile = sanitiseProfile(v1);
    expect(profile.history).toHaveLength(1);
    expect(profile.history[0]!.build.airframe).toBe('airframe-cruiser');
    expect(profile.history[0]!.style).toBe(0);
    expect(profile.bestTimeBuild?.airframe).toBe('airframe-racer');
    expect(profile.bestTimes['caldera-ridge']).toBe(101.2);
  });

  it('marks owned aircraft as already revealed', () => {
    expect(sanitiseProfile(v1).revealed.sort()).toEqual(['airframe-racer', 'airframe-sport']);
  });

  it('a locked earned livery falls back to the factory paint', () => {
    const profile = sanitiseProfile({ ...v1, build: { ...v1.build, livery: 'livery-neon' }, badges: [] });
    expect(activeEntry(profile).paint).toEqual(factoryPaint('airframe-sport'));
  });
});

describe('loadProfile recovery', () => {
  it('returns defaults + recovered on a missing key, invalid JSON or non-objects', () => {
    expect(loadProfile(createMemoryStorage())).toEqual({ profile: defaults, recovered: true });
    for (const raw of ['{not json', '42', '"string"', 'true', 'null']) {
      const storage = createMemoryStorage();
      storage.setItem(SAVE_KEY, raw);
      const result = loadProfile(storage);
      expect(result.recovered, raw).toBe(true);
      expect(result.profile, raw).toEqual(defaults);
    }
  });

  it('returns defaults + recovered when getItem throws', () => {
    expect(loadProfile(throwingStorage())).toEqual({ profile: defaults, recovered: true });
  });

  it('repairs a partially corrupt object without flagging recovery', () => {
    const storage = createMemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ credits: -50, ownedParts: 'nope' }));
    const result = loadProfile(storage);
    expect(result.recovered).toBe(false);
    expect(result.profile.credits).toBe(0);
    expect(result.profile.ownedParts).toEqual(defaults.ownedParts);
  });
});

describe('saveProfile', () => {
  it('returns false when setItem throws', () => {
    expect(saveProfile(throwingStorage(), createDefaultProfile())).toBe(false);
  });

  it('clearProfile swallows storage errors', () => {
    expect(() => clearProfile(throwingStorage())).not.toThrow();
  });
});

describe('sanitiseProfile', () => {
  it('returns defaults for non-objects', () => {
    for (const raw of [null, undefined, 7, 'x']) expect(sanitiseProfile(raw)).toEqual(defaults);
  });

  it('repairs credits', () => {
    expect(sanitiseProfile({ credits: -100 }).credits).toBe(0);
    expect(sanitiseProfile({ credits: Number.NaN }).credits).toBe(STARTING_CREDITS);
    expect(sanitiseProfile({ credits: 'lots' }).credits).toBe(STARTING_CREDITS);
    expect(sanitiseProfile({ credits: 1234.9 }).credits).toBe(1234);
    expect(sanitiseProfile({ credits: 1e12 }).credits).toBe(9_999_999);
  });

  it('drops unknown owned ids and always keeps the starter', () => {
    const profile = sanitiseProfile({ ownedParts: ['wings-compact', 'bogus', 42, 'wings-compact', null] });
    expect([...profile.ownedParts].sort()).toEqual([...defaults.ownedParts, 'wings-compact'].sort());
  });

  it('reverts fitted-but-not-owned parts and incompatible parts slot by slot', () => {
    const profile = sanitiseProfile({
      version: 2,
      ownedParts: ['wings-compact', 'gear-floats'],
      activeAircraft: 'airframe-sport',
      hangar: {
        'airframe-sport': {
          build: { ...DEFAULT_BUILD, engine: 'engine-twin', wings: 'wings-compact', gear: 'gear-floats' },
          paint: DEFAULT_PAINT,
        },
      },
    });
    expect(activeBuild(profile)).toEqual({ ...DEFAULT_BUILD, wings: 'wings-compact' });
  });

  it('drops hangar entries for aircraft that are not owned and repairs the active aircraft', () => {
    const scout = defaultBuildFor(getAirframe('airframe-scout')!);
    const profile = sanitiseProfile({
      version: 2,
      activeAircraft: 'airframe-scout',
      hangar: { 'airframe-scout': { build: scout, paint: DEFAULT_PAINT } },
    });
    expect(profile.hangar['airframe-scout']).toBeUndefined();
    expect(profile.activeAircraft).toBe('airframe-sport');
  });

  it('fills in a hangar entry for owned aircraft that have none', () => {
    const profile = sanitiseProfile({
      version: 2,
      ownedParts: ['airframe-bush'],
      activeAircraft: 'airframe-bush',
      hangar: {},
    });
    expect(profile.activeAircraft).toBe('airframe-bush');
    expect(activeBuild(profile)).toEqual(defaultBuildFor(getAirframe('airframe-bush')!));
  });

  it('repairs tampered paint and setups', () => {
    const profile = sanitiseProfile({
      version: 2,
      hangar: {
        'airframe-sport': { build: DEFAULT_BUILD, paint: { ...DEFAULT_PAINT, accent: 'neon', number: 400 } },
      },
      setups: [
        { id: 'a', name: 'Keep', build: DEFAULT_BUILD, paint: DEFAULT_PAINT },
        { id: 'a', name: 'Duplicate id', build: DEFAULT_BUILD },
        { id: 'b', name: '', build: DEFAULT_BUILD },
        { id: 'c', name: 'Bad build', build: { airframe: 'nope' } },
        'garbage',
      ],
    });
    expect(activeEntry(profile).paint.accent).toBe(DEFAULT_PAINT.accent);
    expect(activeEntry(profile).paint.number).toBe(99);
    expect(profile.setups.map((s) => s.name)).toEqual(['Keep']);
  });

  it('drops garbage history entries and keeps valid ones, bounded', () => {
    const valid = {
      circuitId: 'caldera-ridge',
      position: 2,
      time: 100,
      rawTime: 96,
      missedGates: 1,
      credits: 1000,
      date: '2026-01-02T03:04:05.000Z',
      build: { ...DEFAULT_BUILD },
      style: 0,
    };
    const profile = sanitiseProfile({
      history: [
        null,
        'garbage',
        { time: 'fast', position: 1, build: DEFAULT_BUILD },
        { time: Number.NaN, position: 1, build: DEFAULT_BUILD },
        { time: 90, position: 1 },
        { time: 90, position: 1, build: { airframe: 'nope' } },
        valid,
        { time: 95, position: 0.5, build: DEFAULT_BUILD, missedGates: -3, credits: 'x' },
      ],
    });
    expect(profile.history).toHaveLength(2);
    expect(profile.history[0]).toEqual(valid);
    expect(profile.history[1]).toMatchObject({ position: 1, time: 95, missedGates: 0, credits: 0 });
    const many = sanitiseProfile({ history: Array.from({ length: MAX_HISTORY + 5 }, () => valid) });
    expect(many.history).toHaveLength(MAX_HISTORY);
  });

  it('sanitises counters and best time', () => {
    const profile = sanitiseProfile({ racesCompleted: -3, podiums: 2.7, wins: 'many', bestTime: -5 });
    expect(profile.racesCompleted).toBe(0);
    expect(profile.podiums).toBe(2);
    expect(profile.wins).toBe(0);
    expect(profile.bestTime).toBeNull();
    expect(profile.bestTimeBuild).toBeNull();
  });

  it('always reports version 2', () => {
    expect(sanitiseProfile({ version: 7 }).version).toBe(2);
  });
});
