import { describe, expect, it } from 'vitest';
import { ALL_ITEMS, getAirframe, getItem } from '../aircraft/parts';
import { DEFAULT_BUILD, defaultBuildFor } from '../aircraft/build';
import { DEFAULT_PAINT, getTheme } from '../aircraft/paint';
import { performanceForBuild } from '../aircraft/performance';
import { FACTORY_SETUPS } from '../aircraft/setups';
import {
  MAX_SETUPS,
  STARTING_CREDITS,
  activeBuild,
  activeEntry,
  applyBuild,
  bestTimeFor,
  createDefaultProfile,
  deleteSetup,
  installPart,
  isUnlockRuleMet,
  missingParts,
  newlyUnlockedParts,
  partStatus,
  purchasePart,
  sanitiseProfile,
  sanitiseSettings,
  saveSetup,
  selectAircraft,
  selectCircuit,
  setLivery,
  setPaint,
  updateSettings,
  type PlayerProfile,
} from './profile';

const item = (id: string) => {
  const found = getItem(id);
  if (!found) throw new Error(`missing item ${id}`);
  return found;
};

const expectOk = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
  expect(result.ok).toBe(true);
  return result as Extract<T, { ok: true }>;
};

const rich = (patch: Partial<PlayerProfile> = {}): PlayerProfile => ({
  ...createDefaultProfile(),
  credits: 100_000,
  ...patch,
});

describe('createDefaultProfile', () => {
  it('starts with the Meridian, its factory parts and the starting credits', () => {
    const profile = createDefaultProfile();
    expect(profile.version).toBe(2);
    expect(profile.credits).toBe(STARTING_CREDITS);
    expect(profile.activeAircraft).toBe('airframe-sport');
    expect(activeBuild(profile)).toEqual(DEFAULT_BUILD);
    expect([...profile.ownedParts].sort()).toEqual(
      ['airframe-sport', ...Object.values(getAirframe('airframe-sport')!.defaults)].sort(),
    );
    expect(Object.keys(profile.hangar)).toEqual(['airframe-sport']);
    expect(profile.setups).toEqual([]);
  });

  it('returns independent copies', () => {
    const a = createDefaultProfile();
    const b = createDefaultProfile();
    a.ownedParts.push('x');
    a.hangar['airframe-sport']!.build.engine = 'engine-twin';
    expect(b.ownedParts).not.toContain('x');
    expect(activeBuild(b).engine).toBe('engine-efficient');
  });
});

describe('purchasePart', () => {
  it('fails with already-owned for a factory part', () => {
    expect(purchasePart(createDefaultProfile(), 'engine-efficient')).toEqual({
      ok: false,
      reason: 'already-owned',
    });
    expect(purchasePart(createDefaultProfile(), 'airframe-sport')).toEqual({
      ok: false,
      reason: 'already-owned',
    });
  });

  it('fails with locked when the unlock rule or the prerequisite is missing', () => {
    const profile = rich();
    expect(purchasePart(profile, 'engine-pulse')).toEqual({ ok: false, reason: 'locked' });
    expect(purchasePart(profile, 'engine-twin')).toEqual({ ok: false, reason: 'locked' });
    expect(purchasePart(profile, 'airframe-cruiser')).toEqual({ ok: false, reason: 'locked' });
    // Hornet needs three races and the Kestrel Sport.
    expect(purchasePart({ ...profile, racesCompleted: 3 }, 'engine-hornet')).toEqual({
      ok: false,
      reason: 'locked',
    });
    const withSport = expectOk(purchasePart({ ...profile, racesCompleted: 3 }, 'engine-tuned')).profile;
    expect(purchasePart(withSport, 'engine-hornet').ok).toBe(true);
  });

  it('fails with insufficient-credits when too poor and with unknown-part for garbage', () => {
    const profile = { ...createDefaultProfile(), credits: item('wings-compact').price - 1 };
    expect(purchasePart(profile, 'wings-compact')).toEqual({ ok: false, reason: 'insufficient-credits' });
    expect(purchasePart(createDefaultProfile(), 'garbage')).toEqual({ ok: false, reason: 'unknown-part' });
  });

  it('deducts the price exactly once and does not mutate the input', () => {
    const before = createDefaultProfile();
    const snapshot = structuredClone(before);
    const result = expectOk(purchasePart(before, 'wings-compact'));
    expect(result.profile.credits).toBe(STARTING_CREDITS - item('wings-compact').price);
    expect(result.profile.ownedParts.filter((id) => id === 'wings-compact')).toHaveLength(1);
    expect(activeBuild(result.profile)).toEqual(DEFAULT_BUILD); // buying never fits on its own
    expect(before).toEqual(snapshot);
    // A repeated click on stale state cannot buy it twice.
    expect(purchasePart(result.profile, 'wings-compact')).toEqual({ ok: false, reason: 'already-owned' });
  });

  it('buying an aircraft delivers its factory parts and a hangar entry, leaving other aircraft untouched', () => {
    const start = expectOk(
      installPart(expectOk(purchasePart(rich(), 'wings-compact')).profile, 'wings', 'wings-compact'),
    ).profile;
    const bought = expectOk(purchasePart(start, 'airframe-scout')).profile;
    const scout = getAirframe('airframe-scout')!;
    for (const id of Object.values(scout.defaults)) expect(bought.ownedParts).toContain(id);
    expect(bought.hangar['airframe-scout']!.build).toEqual(defaultBuildFor(scout));
    expect(bought.hangar['airframe-sport']).toEqual(start.hangar['airframe-sport']);
    expect(bought.activeAircraft).toBe('airframe-sport');
  });

  it('allows exact-price purchases and leaves zero credits', () => {
    const profile = { ...createDefaultProfile(), credits: item('wings-highlift').price };
    expect(expectOk(purchasePart(profile, 'wings-highlift')).profile.credits).toBe(0);
  });
});

describe('installPart', () => {
  it('refuses parts that are not owned, in the wrong slot, unknown or incompatible', () => {
    const profile = createDefaultProfile();
    expect(installPart(profile, 'wings', 'wings-compact')).toEqual({ ok: false, reason: 'not-owned' });
    expect(installPart(profile, 'engine', 'wings-compact')).toEqual({ ok: false, reason: 'wrong-category' });
    expect(installPart(profile, 'engine', 'engine-nope')).toEqual({ ok: false, reason: 'unknown-part' });
    const withFloats = { ...profile, ownedParts: [...profile.ownedParts, 'gear-floats'] };
    expect(installPart(withFloats, 'gear', 'gear-floats')).toEqual({ ok: false, reason: 'incompatible' });
  });

  it('fits an owned part to the active aircraft only, without mutating the input', () => {
    const bought = expectOk(purchasePart(rich(), 'airframe-scout')).profile;
    const withWings = expectOk(purchasePart(bought, 'wings-highlift')).profile;
    const fitted = expectOk(installPart(withWings, 'wings', 'wings-highlift')).profile;
    expect(activeBuild(fitted).wings).toBe('wings-highlift');
    expect(activeBuild(withWings).wings).toBe('wings-balanced');
    expect(fitted.hangar['airframe-scout']).toEqual(withWings.hangar['airframe-scout']);
    expect(fitted.credits).toBe(withWings.credits);
  });

  it('is a no-op for an already fitted part', () => {
    const profile = createDefaultProfile();
    expect(expectOk(installPart(profile, 'engine', 'engine-efficient')).profile).toBe(profile);
  });
});

describe('switching aircraft', () => {
  it('keeps every aircraft’s parts and paint when switching back and forth', () => {
    let profile = expectOk(purchasePart(rich(), 'airframe-scout')).profile;
    profile = expectOk(purchasePart(profile, 'prop-four')).profile;
    profile = expectOk(installPart(profile, 'prop', 'prop-four')).profile;
    profile = setLivery(profile, 'livery-rescue');
    const sport = structuredClone(activeEntry(profile));
    profile = selectAircraft(profile, 'airframe-scout');
    expect(profile.activeAircraft).toBe('airframe-scout');
    profile = expectOk(installPart(profile, 'prop', 'prop-four')).profile;
    profile = setLivery(profile, 'livery-courier');
    profile = selectAircraft(profile, 'airframe-sport');
    expect(activeEntry(profile)).toEqual(sport);
    expect(profile.hangar['airframe-scout']!.build.prop).toBe('prop-four');
    expect(profile.hangar['airframe-scout']!.paint).toEqual(getTheme('livery-courier')!.paint);
  });

  it('ignores unowned or unknown aircraft', () => {
    const profile = createDefaultProfile();
    expect(selectAircraft(profile, 'airframe-cruiser')).toBe(profile);
    expect(selectAircraft(profile, 'nope')).toBe(profile);
  });
});

describe('partStatus', () => {
  it('reports fitted factory parts, owned spares, prices and incompatibility', () => {
    const profile = createDefaultProfile();
    expect(partStatus(profile, item('engine-efficient'))).toBe('installed');
    expect(partStatus(profile, item('airframe-sport'))).toBe('installed');
    expect(partStatus(profile, item('wings-compact'))).toBe('available');
    expect(partStatus({ ...profile, credits: 100 }, item('wings-compact'))).toBe('unaffordable');
    expect(partStatus(profile, item('gear-floats'))).toBe('incompatible');
    expect(partStatus(profile, item('airframe-cruiser'))).toBe('locked');
    const bought = expectOk(purchasePart(rich(), 'wings-compact')).profile;
    expect(partStatus(bought, item('wings-compact'))).toBe('owned');
  });

  it('reports locked regardless of credits when the rule is unmet', () => {
    expect(partStatus(rich(), item('engine-pulse'))).toBe('locked');
    expect(partStatus(rich({ podiums: 1 }), item('engine-pulse'))).toBe('available');
  });
});

describe('unlock rules', () => {
  it('follow races, podiums, wins and best style', () => {
    const base = createDefaultProfile();
    expect(isUnlockRuleMet(base, item('engine-twin'))).toBe(false);
    expect(isUnlockRuleMet({ ...base, racesCompleted: 1 }, item('engine-twin'))).toBe(true);
    expect(isUnlockRuleMet({ ...base, racesCompleted: 1 }, item('airframe-cruiser'))).toBe(false);
    expect(isUnlockRuleMet({ ...base, racesCompleted: 2 }, item('airframe-cruiser'))).toBe(true);
    expect(isUnlockRuleMet({ ...base, podiums: 1 }, item('airframe-racer'))).toBe(true);
    expect(isUnlockRuleMet({ ...base, bestStyle: 3000 }, item('prop-scimitar'))).toBe(true);
    expect(isUnlockRuleMet(base, item('wings-compact'))).toBe(true);
  });

  it('newlyUnlockedParts reports only items that became unlockable', () => {
    const base = createDefaultProfile();
    expect(newlyUnlockedParts(base, base)).toEqual([]);
    const ids = (before: PlayerProfile, after: PlayerProfile) =>
      newlyUnlockedParts(before, after).map((i) => i.id);
    const afterOne = { ...base, racesCompleted: 1 };
    expect(ids(base, afterOne).sort()).toEqual(
      ALL_ITEMS.filter((i) => i.unlock.kind === 'races' && i.unlock.count === 1)
        .map((i) => i.id)
        .sort(),
    );
    expect(ids(base, afterOne)).toContain('engine-twin');
    expect(ids(base, afterOne)).toContain('airframe-bush');
    expect(ids(afterOne, base)).toEqual([]);
  });

  it('spreads unlocks over the first races so every race opens something new', () => {
    const base = createDefaultProfile();
    for (let races = 1; races <= 4; races += 1) {
      const before = { ...base, racesCompleted: races - 1 };
      expect(
        newlyUnlockedParts(before, { ...before, racesCompleted: races }).length,
        `race ${races}`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('applyBuild and setups', () => {
  it('applies a factory setup only when every part is owned, and never charges', () => {
    const setup = FACTORY_SETUPS.find((s) => s.id === 'sport-ridge-climber')!;
    const profile = rich({ racesCompleted: 4 });
    expect(missingParts(profile, setup.build).length).toBeGreaterThan(0);
    expect(applyBuild(profile, setup.build)).toEqual({ ok: false, reason: 'parts-not-owned' });
    let owned = profile;
    for (const id of missingParts(profile, setup.build)) owned = expectOk(purchasePart(owned, id)).profile;
    const applied = expectOk(applyBuild(owned, setup.build)).profile;
    expect(activeBuild(applied)).toEqual(setup.build);
    expect(applied.credits).toBe(owned.credits);
    expect(activeEntry(applied).paint).toEqual(activeEntry(owned).paint);
  });

  it('refuses invalid builds and unowned aircraft', () => {
    const profile = rich();
    expect(applyBuild(profile, { ...DEFAULT_BUILD, gear: 'gear-floats' })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(applyBuild(profile, defaultBuildFor(getAirframe('airframe-scout')!))).toEqual({
      ok: false,
      reason: 'aircraft-not-owned',
    });
  });

  it('saves and deletes named setups with their paint, up to the limit', () => {
    let profile = setLivery(createDefaultProfile(), 'livery-modern');
    const saved = expectOk(saveSetup(profile, '  Canyon   carver  ', 1000));
    expect(saved.setup.name).toBe('Canyon carver');
    expect(saved.setup.paint).toEqual(getTheme('livery-modern')!.paint);
    profile = saved.profile;
    expect(saveSetup(profile, '   ').ok).toBe(false);
    for (let i = 1; i < MAX_SETUPS; i += 1)
      profile = expectOk(saveSetup(profile, `Setup ${i}`, 1000 + i)).profile;
    expect(saveSetup(profile, 'One too many')).toEqual({ ok: false, reason: 'full' });
    const first = profile.setups[0]!;
    expect(deleteSetup(profile, first.id).setups).toHaveLength(MAX_SETUPS - 1);
    expect(deleteSetup(profile, 'nope')).toBe(profile);
  });
});

describe('paint', () => {
  it('applies unlocked paint to the active aircraft and never changes flight stats', () => {
    const profile = createDefaultProfile();
    const before = performanceForBuild(activeBuild(profile));
    for (const theme of ['livery-rescue', 'livery-survey', 'livery-courier']) {
      const next = setLivery(profile, theme);
      expect(activeEntry(next).paint).toEqual(getTheme(theme)!.paint);
      expect(activeBuild(next)).toEqual(activeBuild(profile));
      expect(performanceForBuild(activeBuild(next))).toEqual(before);
    }
  });

  it('refuses locked swatches and malformed paint', () => {
    const profile = createDefaultProfile();
    expect(setPaint(profile, { ...DEFAULT_PAINT, accent: 'neon' })).toBe(profile);
    expect(setPaint(profile, { ...DEFAULT_PAINT, number: 140 })).toBe(profile);
    expect(setPaint(profile, { ...DEFAULT_PAINT, pattern: 'zigzag' as never })).toBe(profile);
    const earned = { ...profile, badges: ['combo-king'] };
    expect(activeEntry(setPaint(earned, { ...DEFAULT_PAINT, accent: 'neon' })).paint.accent).toBe('neon');
  });
});

describe('settings', () => {
  it('sanitiseSettings clamps and fills defaults', () => {
    expect(sanitiseSettings(undefined)).toEqual({
      assist: 0.6,
      invertPitch: false,
      audio: true,
      sensitivity: 1,
      haptics: true,
    });
    expect(sanitiseSettings({ assist: 5, sensitivity: 9 })).toMatchObject({ assist: 1, sensitivity: 1.5 });
    expect(sanitiseSettings({ assist: -1, sensitivity: 0 })).toMatchObject({ assist: 0, sensitivity: 0.5 });
  });

  it('updateSettings merges and sanitises without mutating', () => {
    const profile = createDefaultProfile();
    const next = updateSettings(profile, { invertPitch: true, sensitivity: 2 });
    expect(next.settings).toMatchObject({ invertPitch: true, sensitivity: 1.5 });
    expect(profile.settings.invertPitch).toBe(false);
  });
});

describe('courses', () => {
  it('starts on Caldera Ridge with no course best times', () => {
    const profile = createDefaultProfile();
    expect(profile.selectedCircuit).toBe('caldera-ridge');
    expect(bestTimeFor(profile, 'frostline-pass')).toBeNull();
  });

  it('selectCircuit accepts known courses only and never mutates', () => {
    const profile = createDefaultProfile();
    expect(selectCircuit(profile, 'coral-coast').selectedCircuit).toBe('coral-coast');
    expect(profile.selectedCircuit).toBe('caldera-ridge');
    expect(selectCircuit(profile, 'nowhere')).toBe(profile);
  });

  it('sanitises course data and migrates the legacy best time to Caldera Ridge', () => {
    const migrated = sanitiseProfile({ ...createDefaultProfile(), bestTime: 97.5, bestTimes: undefined });
    expect(migrated.bestTimes).toEqual({ 'caldera-ridge': 97.5 });
    const repaired = sanitiseProfile({
      ...createDefaultProfile(),
      selectedCircuit: 'atlantis',
      bestTimes: { 'frostline-pass': 101, 'coral-coast': -4, 'ember-mesa': 'fast', moon: 50 },
    });
    expect(repaired.selectedCircuit).toBe('caldera-ridge');
    expect(repaired.bestTimes).toEqual({ 'frostline-pass': 101 });
  });
});
