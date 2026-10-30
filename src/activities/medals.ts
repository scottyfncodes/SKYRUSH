import type { Activity, MedalTier, TimeMedals } from './catalog';

/**
 * Medal rules. Every medal activity is judged on one number (its `value`):
 * a time for trials and deliveries (lower is better), an accuracy for precision
 * runs and a score for air shows (higher is better).
 */

export interface ActivityRun {
  /** Time (s), accuracy (0..100) or score, depending on the activity. */
  value: number;
  /** Reached the end: every gate, every drop, or the whole display. */
  completed: boolean;
  /** Delivery cargo condition 0..100 (100 for everything else). */
  condition: number;
}

export const lowerIsBetter = (activity: Activity): boolean =>
  activity.kind === 'trial' || activity.kind === 'delivery';

const timeMedal = (time: number, medals: TimeMedals): MedalTier =>
  time <= medals.gold ? 3 : time <= medals.silver ? 2 : time <= medals.bronze ? 1 : 0;

export const medalFor = (activity: Activity, run: ActivityRun): MedalTier => {
  if (!run.completed) return 0;
  switch (activity.kind) {
    case 'trial':
      return timeMedal(run.value, activity.medals);
    case 'precision':
      return run.value >= activity.medals.gold ? 3 : run.value >= activity.medals.silver ? 2 : 1;
    case 'show':
      return run.value >= activity.medals.gold
        ? 3
        : run.value >= activity.medals.silver
          ? 2
          : run.value >= activity.medals.bronze
            ? 1
            : 0;
    case 'delivery': {
      const { condition } = activity;
      const byCondition: MedalTier =
        run.condition >= condition.gold
          ? 3
          : run.condition >= condition.silver
            ? 2
            : run.condition >= condition.bronze
              ? 1
              : 0;
      return Math.min(timeMedal(run.value, activity.medals), byCondition) as MedalTier;
    }
    case 'race':
    case 'explore':
      return 0;
  }
};

/** The target for each medal, in the activity's own unit, for the board and briefing. */
export const medalTargets = (activity: Activity): [number, number, number] | null => {
  switch (activity.kind) {
    case 'trial':
    case 'delivery':
      return [activity.medals.bronze, activity.medals.silver, activity.medals.gold];
    case 'show':
      return [activity.medals.bronze, activity.medals.silver, activity.medals.gold];
    case 'precision':
      return [0, activity.medals.silver, activity.medals.gold];
    default:
      return null;
  }
};

/** Whether `value` beats `best` for this activity (any value beats no best). */
export const isBetter = (activity: Activity, value: number, best: number | null): boolean =>
  best === null || (lowerIsBetter(activity) ? value < best : value > best);

/** Credits for reaching each medal tier for the first time, and for any completed run. */
export const MEDAL_REWARDS: readonly number[] = [0, 400, 600, 900];
export const COMPLETION_REWARD = 150;
export const PERSONAL_BEST_REWARD = 100;
export const DISCOVERY_REWARD = 300;
export const RANK_REWARD = 1000;

/** Credits for moving from one medal to a better one (each new tier pays once). */
export const medalUpgradeReward = (before: MedalTier, after: MedalTier): number => {
  let total = 0;
  for (let tier = before + 1; tier <= after; tier += 1) total += MEDAL_REWARDS[tier]!;
  return total;
};
