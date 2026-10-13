import type { AircraftBuild } from '../aircraft/build';
import type { AircraftPart } from '../aircraft/parts';
import { bestTimeFor, newlyUnlockedParts, type PlayerProfile, type RaceRecord, MAX_HISTORY } from './profile';
import { DEFAULT_COURSE_ID } from '../course/courses';
import { BADGES, badgesEarned, nextGoal, type Badge, type NextGoal, type RunStyleStats } from './badges';
import { styleCredits } from '../style/StyleTracker';

export interface RaceOutcome {
  circuitId: string;
  position: number;
  racerCount: number;
  finishTime: number; // including penalties
  rawTime: number;
  missedGates: number;
  crashes: number;
  penaltySeconds: number;
  parTime: number;
  build: AircraftBuild;
  /** Style stats for the race; omitted by callers that predate style scoring. */
  style?: RunStyleStats;
}

export interface RewardBreakdown {
  base: number;
  cleanBonus: number;
  timeBonus: number;
  styleBonus: number;
  total: number;
}

const POSITION_REWARDS = [1500, 1000, 700, 500] as const;
export const CLEAN_RACE_BONUS = 300;
const TIME_BONUS_PER_SECOND = 15;
const TIME_BONUS_CAP = 600;

export const computeReward = (
  outcome: Pick<RaceOutcome, 'position' | 'finishTime' | 'missedGates' | 'crashes' | 'parTime'> & {
    style?: Pick<RunStyleStats, 'score'>;
  },
): RewardBreakdown => {
  const index = Math.max(0, Math.min(outcome.position - 1, POSITION_REWARDS.length - 1));
  const base = POSITION_REWARDS[index]!;
  const cleanBonus = outcome.missedGates === 0 && outcome.crashes === 0 ? CLEAN_RACE_BONUS : 0;
  const timeBonus = Math.max(
    0,
    Math.min(TIME_BONUS_CAP, Math.round((outcome.parTime - outcome.finishTime) * TIME_BONUS_PER_SECOND)),
  );
  const styleBonus = styleCredits(outcome.style?.score ?? 0);
  return { base, cleanBonus, timeBonus, styleBonus, total: base + cleanBonus + timeBonus + styleBonus };
};

export interface AppliedResult {
  profile: PlayerProfile;
  reward: RewardBreakdown;
  newBestTime: boolean;
  unlocked: AircraftPart[];
  record: RaceRecord;
  newBestStyle: boolean;
  /** Badges earned by this race (each unlocks a livery). */
  badges: Badge[];
  /** Closest unearned badge after this race, or null when every badge is owned. */
  next: NextGoal | null;
}

/** Applies a race outcome to the profile: credits, counters, best time, history, unlocks. */
export const applyRaceOutcome = (
  profile: PlayerProfile,
  outcome: RaceOutcome,
  now = new Date(),
): AppliedResult => {
  const reward = computeReward(outcome);
  const previousBest = bestTimeFor(profile, outcome.circuitId);
  const newBestTime = previousBest === null || outcome.finishTime < previousBest;
  // The legacy single best time tracks Caldera Ridge, the only course older saves knew.
  const legacyBest = outcome.circuitId === DEFAULT_COURSE_ID && newBestTime;
  const record: RaceRecord = {
    circuitId: outcome.circuitId,
    position: outcome.position,
    time: outcome.finishTime,
    rawTime: outcome.rawTime,
    missedGates: outcome.missedGates,
    credits: reward.total,
    date: now.toISOString(),
    build: { ...outcome.build },
    style: outcome.style?.score ?? 0,
  };
  const style = outcome.style;
  const earned = style ? badgesEarned(profile.badges, style) : [];
  const badgeProgress = { ...profile.badgeProgress };
  if (style) {
    for (const badge of BADGES) {
      badgeProgress[badge.id] = Math.max(badgeProgress[badge.id] ?? 0, badge.progress(style));
    }
  }
  const styleScore = style?.score ?? 0;
  const newBestStyle = styleScore > profile.bestStyle;
  const next: PlayerProfile = {
    ...profile,
    credits: profile.credits + reward.total,
    racesCompleted: profile.racesCompleted + 1,
    podiums: profile.podiums + (outcome.position <= 3 ? 1 : 0),
    wins: profile.wins + (outcome.position === 1 ? 1 : 0),
    bestTime: legacyBest ? outcome.finishTime : profile.bestTime,
    bestTimeBuild: legacyBest ? { ...outcome.build } : profile.bestTimeBuild,
    bestTimes: newBestTime
      ? { ...profile.bestTimes, [outcome.circuitId]: outcome.finishTime }
      : profile.bestTimes,
    history: [record, ...profile.history].slice(0, MAX_HISTORY),
    bestStyle: Math.max(profile.bestStyle, styleScore),
    bestMultiplier: Math.max(profile.bestMultiplier, style?.bestMultiplier ?? 1),
    badges: [...profile.badges, ...earned.map((badge) => badge.id)],
    badgeProgress,
  };
  return {
    profile: next,
    reward,
    newBestTime,
    unlocked: newlyUnlockedParts(profile, next),
    record,
    newBestStyle,
    badges: earned,
    next: nextGoal(next.badges, next.badgeProgress),
  };
};
