import { describe, expect, it } from 'vitest';
import {
  createDefaultProfile,
  isAvailable,
  licenceStars,
  sanitiseProfile,
  type PlayerProfile,
} from './profile';
import {
  LICENCE_RANKS,
  TOTAL_STARS,
  applyActivityOutcome,
  discoveriesLeft,
  licenceStatus,
  logFlight,
  rankIndex,
  suggestNext,
} from './activities';
import {
  ACTIVITIES,
  DISCOVERIES,
  MEDAL_ACTIVITIES,
  getActivity,
  type ShowActivity,
} from '../activities/catalog';
import { MEDAL_REWARDS, COMPLETION_REWARD, DISCOVERY_REWARD, medalFor } from '../activities/medals';
import { getAirframe } from '../aircraft/parts';
import { createMemoryStorage, loadProfile, saveProfile } from './save';

const show = getActivity('caldera-ridge:show') as ShowActivity;
const trial = getActivity('caldera-ridge:trial')!;

const fly = (
  profile: PlayerProfile,
  activityId: string,
  value: number,
  extra: Partial<{ condition: number; completed: boolean; discoveries: string[] }> = {},
) =>
  applyActivityOutcome(profile, {
    activityId,
    airframeId: profile.activeAircraft,
    run: { value, completed: extra.completed ?? true, condition: extra.condition ?? 100 },
    discoveries: extra.discoveries ?? [],
    distance: 5000,
  });

describe('medals', () => {
  it('judges times, scores and accuracy the right way round', () => {
    const run = (value: number, condition = 100) => ({ value, completed: true, condition });
    expect(medalFor(trial, run(80))).toBe(3);
    expect(medalFor(trial, run(9999))).toBe(0);
    expect(medalFor(show, run(show.medals.gold))).toBe(3);
    expect(medalFor(show, run(show.medals.bronze - 1))).toBe(0);
    const precision = getActivity('caldera-ridge:precision')!;
    expect(medalFor(precision, run(10))).toBe(1);
    expect(medalFor(precision, { value: 99, completed: false, condition: 100 })).toBe(0);
  });

  it('caps a fast delivery by the condition of its cargo', () => {
    const delivery = getActivity('frostline-pass:delivery')!;
    if (delivery.kind !== 'delivery') throw new Error('expected a delivery');
    expect(medalFor(delivery, { value: delivery.medals.gold - 1, completed: true, condition: 100 })).toBe(3);
    expect(
      medalFor(delivery, {
        value: delivery.medals.gold - 1,
        completed: true,
        condition: delivery.condition.silver,
      }),
    ).toBe(2);
    expect(medalFor(delivery, { value: delivery.medals.gold - 1, completed: true, condition: 5 })).toBe(0);
  });
});

describe('applyActivityOutcome', () => {
  it('pays each medal tier once, plus a completion fee every run', () => {
    const start = createDefaultProfile();
    const first = fly(start, show.id, show.medals.silver);
    expect(first.medal).toBe(2);
    expect(first.reward.medals).toBe(MEDAL_REWARDS[1]! + MEDAL_REWARDS[2]!);
    expect(first.reward.completion).toBe(COMPLETION_REWARD);
    expect(first.profile.credits).toBe(start.credits + first.reward.total);
    // Same medal again: no medal money, no personal-best bonus without a better score.
    const again = fly(first.profile, show.id, show.medals.silver);
    expect(again.reward.medals).toBe(0);
    expect(again.reward.personalBest).toBe(0);
    expect(again.profile.activities[show.id]).toMatchObject({ medal: 2, runs: 2 });
    // Gold later pays only the gold tier.
    const gold = fly(again.profile, show.id, show.medals.gold + 10);
    expect(gold.reward.medals).toBe(MEDAL_REWARDS[3]);
    expect(gold.newBest).toBe(true);
    expect(gold.reward.personalBest).toBeGreaterThan(0);
  });

  it('never lowers a medal or a best and never mutates the input', () => {
    const start = createDefaultProfile();
    const gold = fly(start, trial.id, 80).profile;
    const snapshot = JSON.stringify(gold);
    const worse = fly(gold, trial.id, 140);
    expect(worse.profile.activities[trial.id]).toMatchObject({ best: 80, medal: 3 });
    expect(JSON.stringify(gold)).toBe(snapshot);
  });

  it('logs discoveries once, pays for them and counts them as stars', () => {
    const ids = DISCOVERIES.filter((d) => d.regionId === 'caldera-ridge').map((d) => d.id);
    const applied = applyActivityOutcome(createDefaultProfile(), {
      activityId: 'caldera-ridge:explore',
      airframeId: 'airframe-sport',
      run: null,
      discoveries: [ids[0]!, ids[1]!, ids[1]!, 'not-a-discovery'],
      distance: 12000,
    });
    expect(applied.discoveries.map((d) => d.id)).toEqual([ids[0], ids[1]]);
    expect(applied.reward.discoveries).toBe(2 * DISCOVERY_REWARD);
    expect(applied.reward.completion).toBe(0);
    expect(licenceStars(applied.profile)).toBe(2);
    expect(discoveriesLeft(applied.profile, 'caldera-ridge')).toBe(3);
    const repeat = applyActivityOutcome(applied.profile, {
      activityId: 'caldera-ridge:explore',
      airframeId: 'airframe-sport',
      run: null,
      discoveries: [ids[0]!],
      distance: 100,
    });
    expect(repeat.reward.discoveries).toBe(0);
  });

  it('earns the activity badge with a gold and unlocks its livery', () => {
    const applied = fly(createDefaultProfile(), show.id, show.medals.gold);
    expect(applied.badges.map((b) => b.id)).toEqual(['display-team']);
    expect(applied.profile.badges).toContain('display-team');
  });

  it('ranks the licence up with stars and pays for each new rank', () => {
    let profile = createDefaultProfile();
    let rankReward = 0;
    for (const activity of MEDAL_ACTIVITIES.slice(0, 3)) {
      const value = activity.kind === 'trial' || activity.kind === 'delivery' ? 1 : 1e6;
      const applied = fly(profile, activity.id, value);
      rankReward += applied.reward.rank;
      profile = applied.profile;
    }
    expect(licenceStars(profile)).toBe(9);
    expect(rankIndex(9)).toBe(1);
    expect(rankReward).toBeGreaterThan(0);
    expect(licenceStatus(profile).rank).toBe(LICENCE_RANKS[1]);
  });

  it('unlocks the Starling with enough licence stars', () => {
    const starling = getAirframe('airframe-stunt')!;
    let profile = createDefaultProfile();
    expect(isAvailable(profile, starling)).toBe(false);
    const gold = (id: string) => {
      const activity = getActivity(id)!;
      return fly(profile, id, activity.kind === 'trial' || activity.kind === 'delivery' ? 1 : 1e6);
    };
    profile = gold('caldera-ridge:show').profile;
    profile = gold('caldera-ridge:precision').profile;
    const third = gold('coral-coast:show');
    expect(third.unlocked.map((item) => item.id)).toContain('airframe-stunt');
    expect(isAvailable(third.profile, starling)).toBe(true);
  });

  it('keeps a logbook per aircraft', () => {
    const profile = logFlight(
      logFlight(createDefaultProfile(), 'airframe-sport', 4200),
      'airframe-sport',
      800,
      2,
    );
    expect(profile.logbook['airframe-sport']).toEqual({ flights: 2, distance: 5, medals: 2 });
  });
});

describe('suggestNext', () => {
  it('points at an unflown medal activity first, then at discoveries', () => {
    let profile = createDefaultProfile();
    const first = suggestNext(profile, 'caldera-ridge')!;
    expect(first.text).toMatch(/^Bronze on /);
    for (const activity of MEDAL_ACTIVITIES.filter((a) => a.regionId === 'caldera-ridge')) {
      profile = fly(
        profile,
        activity.id,
        activity.kind === 'trial' || activity.kind === 'delivery' ? 1 : 1e6,
      ).profile;
    }
    expect(suggestNext(profile, 'caldera-ridge')?.activity.kind).toBe('explore');
  });
});

describe('saves', () => {
  it('round-trip activities, discoveries and the logbook', () => {
    const storage = createMemoryStorage();
    const profile = fly(createDefaultProfile(), show.id, show.medals.silver, {
      discoveries: [DISCOVERIES[0]!.id],
    }).profile;
    saveProfile(storage, profile);
    const loaded = loadProfile(storage).profile;
    expect(loaded.activities).toEqual(profile.activities);
    expect(loaded.discoveries).toEqual(profile.discoveries);
    expect(loaded.logbook).toEqual(profile.logbook);
    expect(loaded.selectedActivity).toBe(show.id);
  });

  it('load older saves without the new fields as empty', () => {
    const old = { ...createDefaultProfile() } as Record<string, unknown>;
    delete old.activities;
    delete old.discoveries;
    delete old.logbook;
    delete old.selectedActivity;
    const profile = sanitiseProfile(old);
    expect(profile.activities).toEqual({});
    expect(profile.discoveries).toEqual([]);
    expect(profile.logbook).toEqual({});
    expect(profile.selectedActivity).toBe('');
  });

  it('repair malformed activity data field by field', () => {
    const profile = sanitiseProfile({
      ...createDefaultProfile(),
      activities: {
        [show.id]: { best: 'fast', medal: 9, runs: -2 },
        'nope:race': { best: 1, medal: 1, runs: 1 },
      },
      discoveries: ['caldera:comet', 'caldera:comet', 42, 'nowhere'],
      logbook: { 'airframe-sport': { flights: 3.7, distance: -5 }, 'airframe-imaginary': { flights: 1 } },
      selectedActivity: 'missing',
    });
    expect(profile.activities).toEqual({ [show.id]: { best: null, medal: 3, runs: 0 } });
    expect(profile.discoveries).toEqual(['caldera:comet']);
    expect(profile.logbook).toEqual({ 'airframe-sport': { flights: 3, distance: 0, medals: 0 } });
    expect(profile.selectedActivity).toBe('');
  });
});

describe('the catalogue', () => {
  it('gives every region a race, a trial, two signature activities and free flight', () => {
    const regions = new Set(ACTIVITIES.map((a) => a.regionId));
    expect(regions.size).toBe(4);
    for (const region of regions) {
      const kinds = ACTIVITIES.filter((a) => a.regionId === region).map((a) => a.kind);
      expect(kinds.filter((k) => k === 'race')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'trial')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'explore')).toHaveLength(1);
      expect(kinds).toHaveLength(5);
      expect(DISCOVERIES.filter((d) => d.regionId === region)).toHaveLength(5);
    }
    expect(TOTAL_STARS).toBe(MEDAL_ACTIVITIES.length * 3 + DISCOVERIES.length);
    expect(new Set(ACTIVITIES.map((a) => a.id)).size).toBe(ACTIVITIES.length);
  });
});
