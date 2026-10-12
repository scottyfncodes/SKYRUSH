import { describe, expect, it } from 'vitest';
import { ALL_PARTS, DEFAULT_PART_IDS, getPart } from '../aircraft/parts';
import { DEFAULT_BUILD } from '../aircraft/build';
import {
  STARTING_CREDITS,
  createDefaultProfile,
  installPart,
  isUnlockRuleMet,
  newlyUnlockedParts,
  partStatus,
  purchasePart,
  sanitiseSettings,
  setLivery,
  updateSettings,
  type PlayerProfile,
} from './profile';

const part = (id: string) => {
  const found = getPart(id);
  if (!found) throw new Error(`missing part ${id}`);
  return found;
};

const expectOk = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
  expect(result.ok).toBe(true);
  return result as Extract<T, { ok: true }>;
};

describe('createDefaultProfile', () => {
  it('starts with the starting credits and owns exactly the three default parts', () => {
    const profile = createDefaultProfile();
    expect(profile.credits).toBe(STARTING_CREDITS);
    expect(profile.credits).toBe(2500);
    expect([...profile.ownedParts].sort()).toEqual(Object.values(DEFAULT_PART_IDS).sort());
    expect(profile.ownedParts).toHaveLength(3);
    expect(profile.build).toEqual(DEFAULT_BUILD);
    expect(profile.racesCompleted).toBe(0);
    expect(profile.podiums).toBe(0);
    expect(profile.wins).toBe(0);
    expect(profile.bestTime).toBeNull();
    expect(profile.history).toEqual([]);
  });

  it('returns independent copies', () => {
    const a = createDefaultProfile();
    const b = createDefaultProfile();
    a.ownedParts.push('x');
    a.build.engine = 'engine-twin';
    expect(b.ownedParts).toHaveLength(3);
    expect(b.build.engine).toBe('engine-efficient');
  });
});

describe('purchasePart', () => {
  it('fails with already-owned for a default part', () => {
    const result = purchasePart(createDefaultProfile(), 'fuselage-allrounder');
    expect(result).toEqual({ ok: false, reason: 'already-owned' });
  });

  it('fails with locked when the unlock rule is unmet', () => {
    const profile = { ...createDefaultProfile(), credits: 100_000 };
    expect(purchasePart(profile, 'engine-pulse')).toEqual({ ok: false, reason: 'locked' });
    expect(purchasePart(profile, 'engine-twin')).toEqual({ ok: false, reason: 'locked' });
    expect(purchasePart(profile, 'fuselage-heavy')).toEqual({ ok: false, reason: 'locked' });
  });

  it('fails with insufficient-credits when too poor', () => {
    const profile = { ...createDefaultProfile(), credits: part('fuselage-needle').price - 1 };
    expect(purchasePart(profile, 'fuselage-needle')).toEqual({ ok: false, reason: 'insufficient-credits' });
  });

  it('fails with unknown-part for garbage ids', () => {
    expect(purchasePart(createDefaultProfile(), 'garbage')).toEqual({ ok: false, reason: 'unknown-part' });
    expect(purchasePart(createDefaultProfile(), '')).toEqual({ ok: false, reason: 'unknown-part' });
  });

  it('deducts the price exactly once and does not mutate the input', () => {
    const before = createDefaultProfile();
    const snapshot = JSON.parse(JSON.stringify(before)) as PlayerProfile;
    const result = expectOk(purchasePart(before, 'fuselage-needle'));
    expect(result.profile.credits).toBe(STARTING_CREDITS - part('fuselage-needle').price);
    expect(result.profile.ownedParts).toContain('fuselage-needle');
    expect(result.profile.ownedParts).toHaveLength(4);
    // The purchase is not installed automatically.
    expect(result.profile.build).toEqual(DEFAULT_BUILD);
    expect(before).toEqual(snapshot);
    expect(result.profile).not.toBe(before);
  });

  it('refuses to buy the same part twice', () => {
    const first = expectOk(purchasePart({ ...createDefaultProfile(), credits: 10_000 }, 'wings-compact'));
    const second = purchasePart(first.profile, 'wings-compact');
    expect(second).toEqual({ ok: false, reason: 'already-owned' });
    expect(first.profile.ownedParts.filter((id) => id === 'wings-compact')).toHaveLength(1);
  });

  it('allows exact-price purchases and leaves zero credits', () => {
    const profile = { ...createDefaultProfile(), credits: part('wings-highlift').price };
    const result = expectOk(purchasePart(profile, 'wings-highlift'));
    expect(result.profile.credits).toBe(0);
  });

  it('allows locked parts once the rule is met', () => {
    const profile = { ...createDefaultProfile(), credits: 10_000, podiums: 1, racesCompleted: 2 };
    expect(purchasePart(profile, 'engine-pulse').ok).toBe(true);
    expect(purchasePart(profile, 'engine-twin').ok).toBe(true);
    expect(purchasePart(profile, 'fuselage-heavy').ok).toBe(true);
  });
});

describe('installPart', () => {
  it('refuses parts that are not owned', () => {
    expect(installPart(createDefaultProfile(), 'fuselage', 'fuselage-needle')).toEqual({
      ok: false,
      reason: 'not-owned',
    });
  });

  it('refuses the wrong category', () => {
    expect(installPart(createDefaultProfile(), 'engine', 'fuselage-allrounder')).toEqual({
      ok: false,
      reason: 'wrong-category',
    });
    expect(installPart(createDefaultProfile(), 'wings', 'engine-efficient')).toEqual({
      ok: false,
      reason: 'wrong-category',
    });
  });

  it('refuses unknown parts', () => {
    expect(installPart(createDefaultProfile(), 'engine', 'engine-nope')).toEqual({
      ok: false,
      reason: 'unknown-part',
    });
  });

  it('installs an owned part without mutating the input', () => {
    const bought = expectOk(purchasePart(createDefaultProfile(), 'fuselage-needle')).profile;
    const installed = expectOk(installPart(bought, 'fuselage', 'fuselage-needle')).profile;
    expect(installed.build.fuselage).toBe('fuselage-needle');
    expect(installed.build.engine).toBe(DEFAULT_BUILD.engine);
    expect(installed.build.wings).toBe(DEFAULT_BUILD.wings);
    expect(bought.build.fuselage).toBe(DEFAULT_BUILD.fuselage);
    expect(installed.credits).toBe(bought.credits);
  });

  it('is a no-op for an already installed part', () => {
    const profile = createDefaultProfile();
    const result = expectOk(installPart(profile, 'engine', 'engine-efficient'));
    expect(result.profile).toBe(profile);
  });
});

describe('partStatus', () => {
  it('reports installed for the default parts', () => {
    const profile = createDefaultProfile();
    for (const id of Object.values(DEFAULT_PART_IDS)) expect(partStatus(profile, part(id))).toBe('installed');
  });

  it('reports owned after a purchase and installed after installing', () => {
    const bought = expectOk(purchasePart(createDefaultProfile(), 'wings-compact')).profile;
    expect(partStatus(bought, part('wings-compact'))).toBe('owned');
    const installed = expectOk(installPart(bought, 'wings', 'wings-compact')).profile;
    expect(partStatus(installed, part('wings-compact'))).toBe('installed');
    expect(partStatus(installed, part('wings-balanced'))).toBe('owned');
  });

  it('reports available vs unaffordable based on credits', () => {
    expect(partStatus(createDefaultProfile(), part('fuselage-needle'))).toBe('available');
    expect(partStatus({ ...createDefaultProfile(), credits: 100 }, part('fuselage-needle'))).toBe(
      'unaffordable',
    );
  });

  it('reports locked regardless of credits when the rule is unmet', () => {
    const rich = { ...createDefaultProfile(), credits: 1_000_000 };
    expect(partStatus(rich, part('engine-pulse'))).toBe('locked');
    expect(partStatus({ ...rich, podiums: 1 }, part('engine-pulse'))).toBe('available');
  });
});

describe('unlock rules', () => {
  it('isUnlockRuleMet follows races and podium counters', () => {
    const base = createDefaultProfile();
    expect(isUnlockRuleMet(base, part('engine-twin'))).toBe(false);
    expect(isUnlockRuleMet({ ...base, racesCompleted: 1 }, part('engine-twin'))).toBe(true);
    expect(isUnlockRuleMet({ ...base, racesCompleted: 1 }, part('fuselage-heavy'))).toBe(false);
    expect(isUnlockRuleMet({ ...base, racesCompleted: 2 }, part('fuselage-heavy'))).toBe(true);
    expect(isUnlockRuleMet({ ...base, podiums: 1 }, part('engine-pulse'))).toBe(true);
    expect(isUnlockRuleMet(base, part('wings-compact'))).toBe(true);
  });

  it('newlyUnlockedParts reports only parts that became unlockable', () => {
    const base = createDefaultProfile();
    expect(newlyUnlockedParts(base, base)).toEqual([]);
    const afterOneRace = { ...base, racesCompleted: 1 };
    expect(newlyUnlockedParts(base, afterOneRace).map((p) => p.id)).toEqual(['engine-twin']);
    const afterPodium = { ...afterOneRace, podiums: 1 };
    expect(newlyUnlockedParts(afterOneRace, afterPodium).map((p) => p.id)).toEqual(['engine-pulse']);
    const afterTwoRaces = { ...afterPodium, racesCompleted: 2 };
    expect(newlyUnlockedParts(afterPodium, afterTwoRaces).map((p) => p.id)).toEqual(['fuselage-heavy']);
    // Going backwards unlocks nothing.
    expect(newlyUnlockedParts(afterTwoRaces, base)).toEqual([]);
    // Everything at once.
    const ids = newlyUnlockedParts(base, afterTwoRaces)
      .map((p) => p.id)
      .sort();
    expect(ids).toEqual(['engine-pulse', 'engine-twin', 'fuselage-heavy']);
    expect(ALL_PARTS.filter((p) => p.unlock.kind === 'races' || p.unlock.kind === 'podium')).toHaveLength(3);
  });
});

describe('settings and livery', () => {
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
    expect(sanitiseSettings({ assist: Number.NaN, sensitivity: Number.NaN })).toMatchObject({
      assist: 0.6,
      sensitivity: 1,
    });
  });

  it('updateSettings merges and sanitises without mutating', () => {
    const profile = createDefaultProfile();
    const next = updateSettings(profile, { invertPitch: true, sensitivity: 2 });
    expect(next.settings).toEqual({
      assist: 0.6,
      invertPitch: true,
      audio: true,
      sensitivity: 1.5,
      haptics: true,
    });
    expect(profile.settings.invertPitch).toBe(false);
  });

  it('setLivery only changes the livery', () => {
    const next = setLivery(createDefaultProfile(), 'livery-signal');
    expect(next.build).toEqual({ ...DEFAULT_BUILD, livery: 'livery-signal' });
  });
});
