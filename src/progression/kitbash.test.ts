import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD, defaultBuildFor } from '../aircraft/build';
import { getAirframe, getItem } from '../aircraft/parts';
import {
  activeBuild,
  createDefaultProfile,
  installPart,
  isUnlockRuleMet,
  purchasePart,
  sanitiseProfile,
  selectAircraft,
  type PlayerProfile,
} from './profile';
import { applyRaceOutcome, type RaceOutcome } from './rewards';
import { RIVALS, getRival } from './rivals';

const expectOk = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
  expect(result.ok).toBe(true);
  return result as Extract<T, { ok: true }>;
};

const outcome = (patch: Partial<RaceOutcome>): RaceOutcome => ({
  circuitId: 'caldera-ridge',
  position: 1,
  racerCount: 2,
  finishTime: 100,
  rawTime: 100,
  missedGates: 0,
  crashes: 0,
  penaltySeconds: 0,
  parTime: 105,
  build: { ...DEFAULT_BUILD },
  ...patch,
});

/** A player who has raced enough to buy the Workshop Special and the Mule, and has done so. */
const workshop = (): PlayerProfile => {
  let profile: PlayerProfile = { ...createDefaultProfile(), credits: 50_000, racesCompleted: 3 };
  profile = expectOk(purchasePart(profile, 'airframe-custom')).profile;
  profile = expectOk(purchasePart(profile, 'airframe-bush')).profile;
  return selectAircraft(profile, 'airframe-custom');
};

describe('sections and the Workshop Special', () => {
  it('owning an aircraft owns its three sections; sections are never sold on their own', () => {
    const profile = createDefaultProfile();
    for (const id of ['nose-sport', 'cabin-sport', 'boom-sport']) expect(profile.ownedParts).toContain(id);
    expect(purchasePart({ ...profile, credits: 99_999 }, 'nose-racer')).toEqual({
      ok: false,
      reason: 'locked',
    });
  });

  it('bolting a section onto the Special repairs parts that no longer fit, using parts you own', () => {
    const profile = workshop();
    const fitted = expectOk(installPart(profile, 'cabin', 'cabin-bush')).profile;
    const build = activeBuild(fitted);
    expect(build.cabin).toBe('cabin-bush');
    // The Mule cabin takes the Mule's wings and gear, which came with the Mule.
    expect(getAirframe('airframe-bush')!.accepts.wings).toContain(build.wings);
    for (const id of Object.values(build)) if (id !== build.airframe) expect(fitted.ownedParts).toContain(id);
    // Other aircraft are untouched.
    expect(fitted.hangar['airframe-sport']).toEqual(profile.hangar['airframe-sport']);
  });

  it('refuses sections you do not own and sections on stock aircraft', () => {
    expect(installPart(workshop(), 'nose', 'nose-racer')).toEqual({ ok: false, reason: 'not-owned' });
    const stock = selectAircraft(workshop(), 'airframe-sport');
    expect(installPart(stock, 'cabin', 'cabin-bush')).toEqual({ ok: false, reason: 'incompatible' });
  });

  it('old version 2 saves without sections load with each aircraft’s own sections', () => {
    const {
      nose: _n,
      cabin: _c,
      boom: _b,
      ...withoutSections
    } = defaultBuildFor(getAirframe('airframe-scout')!);
    const profile = sanitiseProfile({
      version: 2,
      ownedParts: ['airframe-scout'],
      activeAircraft: 'airframe-scout',
      hangar: { 'airframe-scout': { build: withoutSections } },
    });
    expect(activeBuild(profile)).toEqual(defaultBuildFor(getAirframe('airframe-scout')!));
    expect(profile.ownedParts).toContain('cabin-scout');
  });
});

describe('rival challenges', () => {
  const dax = getRival('ai-aggressive')!;

  it('each rival stakes a real section that a stock aircraft brings', () => {
    expect(RIVALS).toHaveLength(3);
    for (const rival of RIVALS) {
      const prize = getItem(rival.prize);
      expect(prize?.kind === 'part' && prize.category).toMatch(/nose|cabin|boom/);
      expect(prize?.unlock).toMatchObject({ kind: 'rival', rival: rival.id });
    }
  });

  it('beating a rival hands over their section once and keeps the record', () => {
    const start = createDefaultProfile();
    const win = applyRaceOutcome(start, outcome({ challenge: dax.id, position: 1 }));
    expect(win.challenge).toMatchObject({ won: true, record: { wins: 1, losses: 0 } });
    expect(win.challenge?.prize?.id).toBe(dax.prize);
    expect(win.profile.ownedParts).toContain(dax.prize);
    expect(isUnlockRuleMet(win.profile, getItem(dax.prize)!)).toBe(true);
    expect(dax.concede).toContain(win.challenge!.line);

    const again = applyRaceOutcome(win.profile, outcome({ challenge: dax.id, position: 1 }));
    expect(again.challenge?.prize).toBeNull();
    expect(again.profile.ownedParts.filter((id) => id === dax.prize)).toHaveLength(1);

    const loss = applyRaceOutcome(again.profile, outcome({ challenge: dax.id, position: 2 }));
    expect(loss.challenge).toMatchObject({ won: false, record: { wins: 2, losses: 1 } });
    expect(dax.gloat).toContain(loss.challenge!.line);
  });

  it('ordinary races leave the rival record alone and never list sections as unlocks', () => {
    const result = applyRaceOutcome(createDefaultProfile(), outcome({ racerCount: 4 }));
    expect(result.challenge).toBeNull();
    expect(result.profile.rivals).toEqual({});
    expect(result.unlocked.some((item) => item.kind === 'part' && item.category === 'nose')).toBe(false);
  });

  it('sanitises tampered rival records', () => {
    const profile = sanitiseProfile({
      rivals: { 'ai-precision': { wins: 2.7, losses: -3 }, nobody: { wins: 9 } },
    });
    expect(profile.rivals).toEqual({ 'ai-precision': { wins: 2, losses: 0 } });
  });
});
