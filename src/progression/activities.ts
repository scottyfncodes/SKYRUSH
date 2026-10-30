import { isSectionCategory, type ShopItem } from '../aircraft/parts';
import {
  ACTIVITIES,
  MEDAL_ACTIVITIES,
  MEDAL_NAMES,
  discoveriesIn,
  getActivity,
  getDiscovery,
  isDiscoveryId,
  type Activity,
  type DiscoverySpec,
  type MedalTier,
} from '../activities/catalog';
import {
  COMPLETION_REWARD,
  DISCOVERY_REWARD,
  PERSONAL_BEST_REWARD,
  RANK_REWARD,
  isBetter,
  medalFor,
  medalUpgradeReward,
  type ActivityRun,
} from '../activities/medals';
import { ACTIVITY_BADGES, PATHFINDER_TARGET, type ActivityBadge } from './badges';
import { licenceStars, newlyUnlockedParts, type ActivityRecord, type PlayerProfile } from './profile';

/**
 * Progression for activities: medals, personal bests, discoveries, licence
 * stars and ranks, activity badges and the per-aircraft logbook. Pure: every
 * function returns a new profile and never mutates its input.
 */

export interface LicenceRank {
  name: string;
  stars: number;
}

export const LICENCE_RANKS: readonly LicenceRank[] = [
  { name: 'Student pilot', stars: 0 },
  { name: 'Private pilot', stars: 6 },
  { name: 'Commercial pilot', stars: 16 },
  { name: 'Display pilot', stars: 28 },
  { name: 'Ace', stars: 42 },
];

/** The highest rank reached with this many stars (an index into LICENCE_RANKS). */
export const rankIndex = (stars: number): number => {
  let index = 0;
  LICENCE_RANKS.forEach((rank, i) => {
    if (stars >= rank.stars) index = i;
  });
  return index;
};

export interface LicenceStatus {
  stars: number;
  rank: LicenceRank;
  next: LicenceRank | null;
  /** 0..1 of the way from this rank to the next. */
  progress: number;
  /** Stars available in the whole game. */
  total: number;
}

export const TOTAL_STARS =
  MEDAL_ACTIVITIES.length * 3 + ACTIVITIES.filter((a) => a.kind === 'explore').length * 5;

export const licenceStatus = (profile: Pick<PlayerProfile, 'activities' | 'discoveries'>): LicenceStatus => {
  const stars = licenceStars(profile);
  const index = rankIndex(stars);
  const rank = LICENCE_RANKS[index]!;
  const next = LICENCE_RANKS[index + 1] ?? null;
  const progress = next ? (stars - rank.stars) / (next.stars - rank.stars) : 1;
  return { stars, rank, next, progress, total: TOTAL_STARS };
};

export const activityRecord = (profile: PlayerProfile, activityId: string): ActivityRecord =>
  profile.activities[activityId] ?? { best: null, medal: 0, runs: 0 };

export interface ActivityOutcome {
  activityId: string;
  /** Aircraft flown (for the logbook). */
  airframeId: string;
  /** The run as judged for medals; null for free flight. */
  run: ActivityRun | null;
  /** Discoveries found on this flight. */
  discoveries: readonly string[];
  /** Distance flown (m). */
  distance: number;
}

export interface ActivityReward {
  completion: number;
  personalBest: number;
  medals: number;
  discoveries: number;
  rank: number;
  total: number;
}

export interface AppliedActivity {
  profile: PlayerProfile;
  activity: Activity;
  /** Medal this run earned on its own. */
  medal: MedalTier;
  /** Medal held before this run. */
  previousMedal: MedalTier;
  previousBest: number | null;
  newBest: boolean;
  reward: ActivityReward;
  /** Discoveries new to the log. */
  discoveries: DiscoverySpec[];
  badges: ActivityBadge[];
  unlocked: ShopItem[];
  rankBefore: number;
  rankAfter: number;
  stars: number;
}

const BADGE_FOR_KIND: Partial<Record<Activity['kind'], string>> = {
  show: 'display-team',
  delivery: 'air-mail',
  precision: 'threader',
};

/** Adds a flight to an aircraft's log. */
export const logFlight = (
  profile: PlayerProfile,
  airframeId: string,
  distance: number,
  medals = 0,
): PlayerProfile => {
  const before = profile.logbook[airframeId] ?? { flights: 0, distance: 0, medals: 0 };
  return {
    ...profile,
    logbook: {
      ...profile.logbook,
      [airframeId]: {
        flights: before.flights + 1,
        distance: before.distance + Math.max(0, distance) / 1000,
        medals: before.medals + medals,
      },
    },
  };
};

export const applyActivityOutcome = (profile: PlayerProfile, outcome: ActivityOutcome): AppliedActivity => {
  const activity = getActivity(outcome.activityId);
  if (!activity) throw new Error(`Unknown activity ${outcome.activityId}`);
  const record = activityRecord(profile, activity.id);
  const run = outcome.run;
  const medal = run ? medalFor(activity, run) : 0;
  const bestMedal = Math.max(record.medal, medal) as MedalTier;
  const completed = run?.completed === true;
  const newBest = completed && isBetter(activity, run.value, record.best);
  const newDiscoveries = [...new Set(outcome.discoveries)].filter(
    (id) => isDiscoveryId(id) && !profile.discoveries.includes(id),
  );

  const starsBefore = licenceStars(profile);
  const rankBefore = rankIndex(starsBefore);
  const activities = {
    ...profile.activities,
    [activity.id]: {
      best: newBest ? run.value : record.best,
      medal: bestMedal,
      runs: record.runs + 1,
    },
  };
  const discoveries = [...profile.discoveries, ...newDiscoveries];
  const stars = licenceStars({ activities, discoveries });
  const rankAfter = rankIndex(stars);

  const reward: ActivityReward = {
    completion: completed ? COMPLETION_REWARD : 0,
    personalBest: newBest && record.best !== null ? PERSONAL_BEST_REWARD : 0,
    medals: medalUpgradeReward(record.medal, bestMedal),
    discoveries: newDiscoveries.length * DISCOVERY_REWARD,
    rank: Math.max(0, rankAfter - rankBefore) * RANK_REWARD,
    total: 0,
  };
  reward.total = reward.completion + reward.personalBest + reward.medals + reward.discoveries + reward.rank;

  const earned: ActivityBadge[] = [];
  const kindBadge = BADGE_FOR_KIND[activity.kind];
  for (const badge of ACTIVITY_BADGES) {
    if (profile.badges.includes(badge.id)) continue;
    const kindGold = badge.id === kindBadge && bestMedal === 3;
    const pathfinder = badge.id === 'pathfinder' && discoveries.length >= PATHFINDER_TARGET;
    if (kindGold || pathfinder) earned.push(badge);
  }

  let next: PlayerProfile = {
    ...profile,
    credits: profile.credits + reward.total,
    activities,
    discoveries,
    badges: [...profile.badges, ...earned.map((badge) => badge.id)],
    selectedActivity: activity.id,
  };
  next = logFlight(next, outcome.airframeId, outcome.distance, bestMedal - record.medal);

  return {
    profile: next,
    activity,
    medal,
    previousMedal: record.medal,
    previousBest: record.best,
    newBest,
    reward,
    discoveries: newDiscoveries.map((id) => getDiscovery(id)!),
    badges: earned,
    unlocked: newlyUnlockedParts(profile, next).filter(
      (item) => item.kind === 'airframe' || !isSectionCategory(item.category),
    ),
    rankBefore,
    rankAfter,
    stars,
  };
};

/** Remembers the activity open on the flight board. */
export const selectActivity = (profile: PlayerProfile, activityId: string): PlayerProfile =>
  getActivity(activityId) && profile.selectedActivity !== activityId
    ? { ...profile, selectedActivity: activityId }
    : profile;

export interface Suggestion {
  activity: Activity;
  /** e.g. "Silver on Needle Eye" */
  text: string;
}

/**
 * Something worth flying next in a region: the medal activity furthest from gold
 * (unflown ones first), or free flight while discoveries remain. Never forces
 * anything: the board shows it as a hint.
 */
export const suggestNext = (profile: PlayerProfile, regionId: string): Suggestion | null => {
  const candidates = MEDAL_ACTIVITIES.filter((activity) => activity.regionId === regionId)
    .map((activity) => ({ activity, medal: activityRecord(profile, activity.id).medal }))
    .filter((entry) => entry.medal < 3)
    .sort((a, b) => a.medal - b.medal);
  const pick = candidates[0];
  if (pick) {
    return { activity: pick.activity, text: `${MEDAL_NAMES[pick.medal + 1]} on ${pick.activity.name}` };
  }
  const explore = ACTIVITIES.find(
    (activity) => activity.kind === 'explore' && activity.regionId === regionId,
  );
  const remaining = discoveriesLeft(profile, regionId);
  if (explore && remaining > 0) return { activity: explore, text: `${remaining} discoveries left to find` };
  return null;
};

/** Discoveries in a region not yet in the log. */
export const discoveriesLeft = (profile: PlayerProfile, regionId: string): number =>
  discoveriesIn(regionId).filter((discovery) => !profile.discoveries.includes(discovery.id)).length;
