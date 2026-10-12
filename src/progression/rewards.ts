import type { AircraftBuild } from '../aircraft/build';
import type { AircraftPart } from '../aircraft/parts';
import { newlyUnlockedParts, type PlayerProfile, type RaceRecord, MAX_HISTORY } from './profile';

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
}

export interface RewardBreakdown {
  base: number;
  cleanBonus: number;
  timeBonus: number;
  total: number;
}

const POSITION_REWARDS = [1500, 1000, 700, 500] as const;
export const CLEAN_RACE_BONUS = 300;
const TIME_BONUS_PER_SECOND = 15;
const TIME_BONUS_CAP = 600;

export const computeReward = (
  outcome: Pick<RaceOutcome, 'position' | 'finishTime' | 'missedGates' | 'crashes' | 'parTime'>,
): RewardBreakdown => {
  const index = Math.max(0, Math.min(outcome.position - 1, POSITION_REWARDS.length - 1));
  const base = POSITION_REWARDS[index]!;
  const cleanBonus = outcome.missedGates === 0 && outcome.crashes === 0 ? CLEAN_RACE_BONUS : 0;
  const timeBonus = Math.max(
    0,
    Math.min(TIME_BONUS_CAP, Math.round((outcome.parTime - outcome.finishTime) * TIME_BONUS_PER_SECOND)),
  );
  return { base, cleanBonus, timeBonus, total: base + cleanBonus + timeBonus };
};

export interface AppliedResult {
  profile: PlayerProfile;
  reward: RewardBreakdown;
  newBestTime: boolean;
  unlocked: AircraftPart[];
  record: RaceRecord;
}

/** Applies a race outcome to the profile: credits, counters, best time, history, unlocks. */
export const applyRaceOutcome = (
  profile: PlayerProfile,
  outcome: RaceOutcome,
  now = new Date(),
): AppliedResult => {
  const reward = computeReward(outcome);
  const newBestTime = profile.bestTime === null || outcome.finishTime < profile.bestTime;
  const record: RaceRecord = {
    circuitId: outcome.circuitId,
    position: outcome.position,
    time: outcome.finishTime,
    rawTime: outcome.rawTime,
    missedGates: outcome.missedGates,
    credits: reward.total,
    date: now.toISOString(),
    build: { ...outcome.build },
  };
  const next: PlayerProfile = {
    ...profile,
    credits: profile.credits + reward.total,
    racesCompleted: profile.racesCompleted + 1,
    podiums: profile.podiums + (outcome.position <= 3 ? 1 : 0),
    wins: profile.wins + (outcome.position === 1 ? 1 : 0),
    bestTime: newBestTime ? outcome.finishTime : profile.bestTime,
    bestTimeBuild: newBestTime ? { ...outcome.build } : profile.bestTimeBuild,
    history: [record, ...profile.history].slice(0, MAX_HISTORY),
  };
  return { profile: next, reward, newBestTime, unlocked: newlyUnlockedParts(profile, next), record };
};
