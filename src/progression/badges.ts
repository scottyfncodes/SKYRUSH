import { LIVERIES, type Livery } from '../aircraft/parts';

/** What a single finished race contributed, as measured by the style tracker. */
export interface RunStyleStats {
  score: number;
  bestMultiplier: number;
  perfectGates: number;
  nearMisses: number;
  rings: number;
  ringTotal: number;
  overtakes: number;
}

export interface Badge {
  id: string;
  name: string;
  /** Short goal, written as an instruction. */
  goal: string;
  /** Best-run progress toward the goal, 0..1. */
  progress: (run: RunStyleStats) => number;
}

const ratio = (value: number, target: number): number => Math.max(0, Math.min(1, value / target));

export const BULLSEYE_TARGET = 8;
export const SKIMMER_TARGET = 6;
export const COMBO_KING_TARGET = 4;

/** Skill badges. Each one unlocks a livery (cosmetic only, never a performance edge). */
export const BADGES: readonly Badge[] = [
  {
    id: 'ring-runner',
    name: 'Ring Runner',
    goal: 'Fly through every bonus ring in one race',
    progress: (run) => (run.ringTotal > 0 ? ratio(run.rings, run.ringTotal) : 0),
  },
  {
    id: 'bullseye',
    name: 'Bullseye',
    goal: `Thread ${BULLSEYE_TARGET} gates dead centre in one race`,
    progress: (run) => ratio(run.perfectGates, BULLSEYE_TARGET),
  },
  {
    id: 'canyon-skimmer',
    name: 'Canyon Skimmer',
    goal: `Land ${SKIMMER_TARGET} near misses in one race`,
    progress: (run) => ratio(run.nearMisses, SKIMMER_TARGET),
  },
  {
    id: 'combo-king',
    name: 'Combo King',
    goal: `Reach a ×${COMBO_KING_TARGET} multiplier`,
    progress: (run) => ratio(run.bestMultiplier - 1, COMBO_KING_TARGET - 1),
  },
];

const badgeIndex = new Map(BADGES.map((badge) => [badge.id, badge]));

export const getBadge = (id: string): Badge | undefined => badgeIndex.get(id);

export const isBadgeId = (id: unknown): id is string => typeof id === 'string' && badgeIndex.has(id);

/** Badges earned by this run that were not already owned, in catalogue order. */
export const badgesEarned = (owned: readonly string[], run: RunStyleStats): Badge[] =>
  BADGES.filter((badge) => !owned.includes(badge.id) && badge.progress(run) >= 1);

export const liveryForBadge = (badgeId: string): Livery | undefined =>
  LIVERIES.find((livery) => livery.badge === badgeId);

export const isLiveryUnlocked = (livery: Livery, badges: readonly string[]): boolean =>
  !livery.badge || badges.includes(livery.badge);

export interface NextGoal {
  badge: Badge;
  livery: Livery | undefined;
  /** Best progress seen so far (0..1). */
  progress: number;
}

/**
 * The unearned badge the player is closest to, using the best per-badge progress
 * on record. Ties go to catalogue order so the suggestion is stable.
 */
export const nextGoal = (
  owned: readonly string[],
  best: Readonly<Record<string, number>>,
): NextGoal | null => {
  let pick: NextGoal | null = null;
  for (const badge of BADGES) {
    if (owned.includes(badge.id)) continue;
    const progress = Math.max(0, Math.min(1, best[badge.id] ?? 0));
    if (!pick || progress > pick.progress) pick = { badge, livery: liveryForBadge(badge.id), progress };
  }
  return pick;
};
