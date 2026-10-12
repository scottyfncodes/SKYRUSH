import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD } from '../aircraft/build';
import {
  MAX_HISTORY,
  STARTING_CREDITS,
  createDefaultProfile,
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
  it('restores a saved profile exactly', () => {
    const storage = createMemoryStorage();
    const profile: PlayerProfile = {
      ...createDefaultProfile(),
      credits: 4321,
      ownedParts: [...defaults.ownedParts, 'wings-compact'],
      build: { ...DEFAULT_BUILD, wings: 'wings-compact', livery: 'livery-signal' },
      bestTime: 98.5,
      bestTimeBuild: { ...DEFAULT_BUILD },
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
    expect(storage.getItem(SAVE_KEY)).not.toBeNull();
    const loaded = loadProfile(storage);
    expect(loaded.recovered).toBe(false);
    expect(loaded.profile).toEqual(profile);
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

describe('loadProfile recovery', () => {
  it('returns defaults + recovered on a missing key', () => {
    const result = loadProfile(createMemoryStorage());
    expect(result.recovered).toBe(true);
    expect(result.profile).toEqual(defaults);
  });

  it('returns defaults + recovered on invalid JSON', () => {
    const storage = createMemoryStorage();
    storage.setItem(SAVE_KEY, '{not json');
    const result = loadProfile(storage);
    expect(result.recovered).toBe(true);
    expect(result.profile).toEqual(defaults);
  });

  it('returns defaults + recovered on a non-object JSON value', () => {
    for (const raw of ['42', '"string"', 'true', 'null']) {
      const storage = createMemoryStorage();
      storage.setItem(SAVE_KEY, raw);
      const result = loadProfile(storage);
      expect(result.recovered, raw).toBe(true);
      expect(result.profile, raw).toEqual(defaults);
    }
  });

  it('returns defaults + recovered when getItem throws', () => {
    const result = loadProfile(throwingStorage());
    expect(result.recovered).toBe(true);
    expect(result.profile).toEqual(defaults);
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
    expect(sanitiseProfile(null)).toEqual(defaults);
    expect(sanitiseProfile(undefined)).toEqual(defaults);
    expect(sanitiseProfile(7)).toEqual(defaults);
    expect(sanitiseProfile('x')).toEqual(defaults);
  });

  it('repairs credits: negative to 0, NaN/non-number to the default, fractional floored', () => {
    expect(sanitiseProfile({ credits: -100 }).credits).toBe(0);
    expect(sanitiseProfile({ credits: Number.NaN }).credits).toBe(STARTING_CREDITS);
    expect(sanitiseProfile({ credits: 'lots' }).credits).toBe(STARTING_CREDITS);
    expect(sanitiseProfile({ credits: 1234.9 }).credits).toBe(1234);
    expect(sanitiseProfile({ credits: 1e12 }).credits).toBe(9_999_999);
  });

  it('drops unknown owned part ids and always keeps the defaults', () => {
    const profile = sanitiseProfile({ ownedParts: ['wings-compact', 'bogus', 42, 'wings-compact', null] });
    expect([...profile.ownedParts].sort()).toEqual([...defaults.ownedParts, 'wings-compact'].sort());
    expect(sanitiseProfile({ ownedParts: [] }).ownedParts.sort()).toEqual([...defaults.ownedParts].sort());
  });

  it('reverts an installed-but-not-owned part to the default part', () => {
    const profile = sanitiseProfile({
      ownedParts: ['wings-compact'],
      build: { ...DEFAULT_BUILD, engine: 'engine-twin', wings: 'wings-compact', livery: 'livery-signal' },
    });
    expect(profile.build).toEqual({ ...DEFAULT_BUILD, wings: 'wings-compact', livery: 'livery-signal' });
  });

  it('replaces an invalid build with the default build', () => {
    expect(sanitiseProfile({ build: { ...DEFAULT_BUILD, engine: 'engine-nope' } }).build).toEqual(
      DEFAULT_BUILD,
    );
    expect(sanitiseProfile({ build: 'nope' }).build).toEqual(DEFAULT_BUILD);
    expect(sanitiseProfile({ build: null }).build).toEqual(DEFAULT_BUILD);
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
        { time: 90, position: 1, build: { ...DEFAULT_BUILD, wings: 'nope' } },
        valid,
        { time: 95, position: 0.5, build: DEFAULT_BUILD, missedGates: -3, credits: 'x' },
      ],
    });
    expect(profile.history).toHaveLength(2);
    expect(profile.history[0]).toEqual(valid);
    expect(profile.history[1]).toEqual({
      circuitId: 'caldera-ridge',
      position: 1,
      time: 95,
      rawTime: 95,
      missedGates: 0,
      credits: 0,
      date: new Date(0).toISOString(),
      build: DEFAULT_BUILD,
      style: 0,
    });

    const many = sanitiseProfile({ history: Array.from({ length: MAX_HISTORY + 5 }, () => valid) });
    expect(many.history).toHaveLength(MAX_HISTORY);
    expect(sanitiseProfile({ history: 'nope' }).history).toEqual([]);
  });

  it('clamps settings into range and fills defaults', () => {
    const high = sanitiseProfile({ settings: { assist: 3, sensitivity: 4, invertPitch: 'yes', audio: 0 } });
    expect(high.settings).toEqual({
      assist: 1,
      sensitivity: 1.5,
      invertPitch: false,
      audio: true,
      haptics: true,
    });
    const low = sanitiseProfile({
      settings: { assist: -2, sensitivity: 0.1, invertPitch: true, audio: false },
    });
    expect(low.settings).toEqual({
      assist: 0,
      sensitivity: 0.5,
      invertPitch: true,
      audio: false,
      haptics: true,
    });
    expect(sanitiseProfile({ settings: 'nope' }).settings).toEqual(defaults.settings);
  });

  it('sanitises counters and best time', () => {
    const profile = sanitiseProfile({
      racesCompleted: -3,
      podiums: 2.7,
      wins: 'many',
      bestTime: -5,
      bestTimeBuild: DEFAULT_BUILD,
    });
    expect(profile.racesCompleted).toBe(0);
    expect(profile.podiums).toBe(2);
    expect(profile.wins).toBe(0);
    expect(profile.bestTime).toBeNull();
    expect(profile.bestTimeBuild).toBeNull();

    const withBest = sanitiseProfile({ bestTime: 99.5, bestTimeBuild: { ...DEFAULT_BUILD, engine: 'nope' } });
    expect(withBest.bestTime).toBe(99.5);
    expect(withBest.bestTimeBuild).toBeNull();
    expect(sanitiseProfile({ bestTime: 99.5, bestTimeBuild: DEFAULT_BUILD }).bestTimeBuild).toEqual(
      DEFAULT_BUILD,
    );
  });

  it('always reports version 1', () => {
    expect(sanitiseProfile({ version: 7 }).version).toBe(1);
  });
});
