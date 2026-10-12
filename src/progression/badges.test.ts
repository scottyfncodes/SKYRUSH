import { describe, expect, it } from 'vitest';
import {
  BADGES,
  BULLSEYE_TARGET,
  badgesEarned,
  isLiveryUnlocked,
  liveryForBadge,
  nextGoal,
  type RunStyleStats,
} from './badges';
import { applyRaceOutcome, computeReward, type RaceOutcome } from './rewards';
import { createDefaultProfile, isLiveryAvailable, sanitiseProfile, setLivery } from './profile';
import { createMemoryStorage, loadProfile, saveProfile, SAVE_KEY } from './save';
import { DEFAULT_BUILD } from '../aircraft/build';
import { DEFAULT_LIVERY_ID, LIVERIES, getLivery } from '../aircraft/parts';
import { STYLE_CREDIT_CAP } from '../style/StyleTracker';

const quietRun: RunStyleStats = {
  score: 0,
  bestMultiplier: 1,
  perfectGates: 0,
  nearMisses: 0,
  rings: 0,
  ringTotal: 6,
  overtakes: 0,
};

const outcome = (style?: RunStyleStats): RaceOutcome => ({
  circuitId: 'caldera-ridge',
  position: 2,
  racerCount: 4,
  finishTime: 110,
  rawTime: 110,
  missedGates: 0,
  crashes: 0,
  penaltySeconds: 0,
  parTime: 105,
  build: { ...DEFAULT_BUILD },
  style,
});

describe('badge catalogue', () => {
  it('every badge unlocks exactly one cosmetic livery', () => {
    for (const badge of BADGES) {
      const livery = liveryForBadge(badge.id);
      expect(livery, badge.id).toBeDefined();
      expect(LIVERIES.filter((l) => l.badge === badge.id)).toHaveLength(1);
    }
    // Every badge-gated livery points at a real badge.
    for (const livery of LIVERIES.filter((l) => l.badge)) {
      expect(BADGES.some((b) => b.id === livery.badge)).toBe(true);
    }
  });

  it('factory liveries stay unlocked; earned ones need their badge', () => {
    const factory = getLivery(DEFAULT_LIVERY_ID)!;
    const earned = liveryForBadge('bullseye')!;
    expect(isLiveryUnlocked(factory, [])).toBe(true);
    expect(isLiveryUnlocked(earned, [])).toBe(false);
    expect(isLiveryUnlocked(earned, ['bullseye'])).toBe(true);
  });

  it('awards badges that reach their goal and never awards an owned badge twice', () => {
    const run = { ...quietRun, perfectGates: BULLSEYE_TARGET, rings: 6, bestMultiplier: 2 };
    expect(badgesEarned([], run).map((b) => b.id)).toEqual(['ring-runner', 'bullseye']);
    expect(badgesEarned(['ring-runner'], run).map((b) => b.id)).toEqual(['bullseye']);
    expect(badgesEarned([], quietRun)).toEqual([]);
  });

  it('suggests the closest unearned badge as the next goal', () => {
    expect(nextGoal([], {})!.badge.id).toBe(BADGES[0]!.id);
    const goal = nextGoal(['ring-runner'], { bullseye: 0.25, 'canyon-skimmer': 0.5 })!;
    expect(goal.badge.id).toBe('canyon-skimmer');
    expect(goal.progress).toBe(0.5);
    expect(goal.livery?.badge).toBe('canyon-skimmer');
    expect(
      nextGoal(
        BADGES.map((b) => b.id),
        {},
      ),
    ).toBeNull();
  });
});

describe('style rewards and progression', () => {
  it('adds a capped style bonus to the credits', () => {
    expect(computeReward(outcome()).styleBonus).toBe(0);
    expect(computeReward(outcome({ ...quietRun, score: 5000 })).styleBonus).toBe(200);
    const big = computeReward(outcome({ ...quietRun, score: 10_000_000 }));
    expect(big.styleBonus).toBe(STYLE_CREDIT_CAP);
    expect(big.total).toBe(big.base + big.cleanBonus + big.timeBonus + big.styleBonus);
  });

  it('records personal bests, badges and progress without mutating the input', () => {
    const profile = createDefaultProfile();
    const run = { ...quietRun, score: 7200, bestMultiplier: 2.5, nearMisses: 6, perfectGates: 2 };
    const first = applyRaceOutcome(profile, outcome(run));
    expect(first.newBestStyle).toBe(true);
    expect(first.profile.bestStyle).toBe(7200);
    expect(first.profile.bestMultiplier).toBe(2.5);
    expect(first.badges.map((b) => b.id)).toEqual(['canyon-skimmer']);
    expect(first.profile.badges).toEqual(['canyon-skimmer']);
    expect(first.profile.badgeProgress.bullseye).toBe(2 / BULLSEYE_TARGET);
    expect(first.record.style).toBe(7200);
    expect(first.next?.badge.id).not.toBe('canyon-skimmer');
    expect(profile.bestStyle).toBe(0);
    expect(profile.badges).toEqual([]);

    // A weaker run keeps the records and progress, and does not re-award the badge.
    const second = applyRaceOutcome(
      first.profile,
      outcome({ ...run, score: 100, nearMisses: 6, perfectGates: 0 }),
    );
    expect(second.newBestStyle).toBe(false);
    expect(second.profile.bestStyle).toBe(7200);
    expect(second.badges).toEqual([]);
    expect(second.profile.badges).toEqual(['canyon-skimmer']);
    expect(second.profile.badgeProgress.bullseye).toBe(2 / BULLSEYE_TARGET);
  });

  it('only lets the player apply liveries they have earned', () => {
    const profile = createDefaultProfile();
    const neon = liveryForBadge('combo-king')!;
    expect(isLiveryAvailable(profile, neon.id)).toBe(false);
    expect(setLivery(profile, neon.id)).toBe(profile);
    expect(setLivery(profile, 'livery-does-not-exist')).toBe(profile);
    const earned = { ...profile, badges: ['combo-king'] };
    expect(setLivery(earned, neon.id).build.livery).toBe(neon.id);
  });
});

describe('save compatibility', () => {
  it('loads a save written before style scoring without losing any progress', () => {
    const storage = createMemoryStorage();
    const legacy = {
      version: 1,
      credits: 8123,
      ownedParts: ['fuselage-allrounder', 'engine-efficient', 'wings-balanced', 'wings-compact'],
      build: { ...DEFAULT_BUILD, wings: 'wings-compact', livery: 'livery-glacier' },
      bestTime: 101.25,
      bestTimeBuild: { ...DEFAULT_BUILD },
      racesCompleted: 7,
      podiums: 4,
      wins: 2,
      history: [
        {
          circuitId: 'caldera-ridge',
          position: 1,
          time: 101.25,
          rawTime: 101.25,
          missedGates: 0,
          credits: 2400,
          date: '2026-05-01T10:00:00.000Z',
          build: { ...DEFAULT_BUILD },
        },
      ],
      settings: { assist: 0.4, invertPitch: true, audio: false, sensitivity: 1.3 },
    };
    storage.setItem(SAVE_KEY, JSON.stringify(legacy));
    const { profile, recovered } = loadProfile(storage);
    expect(recovered).toBe(false);
    expect(profile).toMatchObject({
      credits: 8123,
      racesCompleted: 7,
      podiums: 4,
      wins: 2,
      bestTime: 101.25,
      build: { wings: 'wings-compact', livery: 'livery-glacier' },
      settings: { assist: 0.4, invertPitch: true, audio: false, sensitivity: 1.3, haptics: true },
      bestStyle: 0,
      bestMultiplier: 1,
      badges: [],
      badgeProgress: {},
    });
    expect(profile.history[0]).toMatchObject({ time: 101.25, style: 0 });
    // And it round-trips with the new fields.
    saveProfile(storage, profile);
    expect(loadProfile(storage).profile).toEqual(profile);
  });

  it('repairs tampered style fields and locked liveries', () => {
    const profile = sanitiseProfile({
      bestStyle: -40,
      bestMultiplier: 99,
      badges: ['bullseye', 'bullseye', 'made-up', 7],
      badgeProgress: { bullseye: 3, 'made-up': 0.5, 'canyon-skimmer': Number.NaN },
      build: { ...DEFAULT_BUILD, livery: liveryForBadge('combo-king')!.id },
    });
    expect(profile.bestStyle).toBe(0);
    expect(profile.bestMultiplier).toBe(4);
    expect(profile.badges).toEqual(['bullseye']);
    expect(profile.badgeProgress).toEqual({ bullseye: 1 });
    expect(profile.build.livery).toBe(DEFAULT_LIVERY_ID);

    const earned = sanitiseProfile({
      badges: ['combo-king'],
      build: { ...DEFAULT_BUILD, livery: liveryForBadge('combo-king')!.id },
    });
    expect(earned.build.livery).toBe(liveryForBadge('combo-king')!.id);
  });
});
