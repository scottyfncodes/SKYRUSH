import { DEFAULT_BUILD, isValidBuild, type AircraftBuild } from '../aircraft/build';
import {
  ALL_PARTS,
  DEFAULT_LIVERY_ID,
  DEFAULT_PART_IDS,
  getLivery,
  getPart,
  type AircraftPart,
  type PartCategory,
} from '../aircraft/parts';
import { clamp, clamp01 } from '../core/math';
import { isBadgeId, isLiveryUnlocked } from './badges';
import { DEFAULT_COURSE_ID, isCourseId } from '../course/courses';

export const STARTING_CREDITS = 2500;
export const MAX_HISTORY = 12;

export interface PlayerSettings {
  assist: number; // 0..1 flight assistance strength
  invertPitch: boolean;
  audio: boolean;
  sensitivity: number; // 0.5..1.5
  /** Short vibration pulses for big moments, where the browser supports it. */
  haptics: boolean;
}

export interface RaceRecord {
  circuitId: string;
  position: number;
  time: number;
  rawTime: number;
  missedGates: number;
  credits: number;
  date: string; // ISO
  build: AircraftBuild;
  /** Style score for the race (0 for races saved before style scoring existed). */
  style: number;
}

export interface PlayerProfile {
  version: 1;
  credits: number;
  ownedParts: string[];
  build: AircraftBuild;
  /** Best Caldera Ridge time (kept for saves from before multiple courses; see bestTimes). */
  bestTime: number | null;
  bestTimeBuild: AircraftBuild | null;
  /** Best finish time per course id. */
  bestTimes: Record<string, number>;
  /** Course the Race button starts. */
  selectedCircuit: string;
  racesCompleted: number;
  podiums: number;
  wins: number;
  history: RaceRecord[];
  settings: PlayerSettings;
  /** Best style score in a single race. */
  bestStyle: number;
  /** Highest combo multiplier ever reached. */
  bestMultiplier: number;
  /** Earned skill badge ids (each unlocks a livery). */
  badges: string[];
  /** Best single-race progress (0..1) toward each badge, for "next unlock" hints. */
  badgeProgress: Record<string, number>;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  assist: 0.6,
  invertPitch: false,
  audio: true,
  sensitivity: 1,
  haptics: true,
};

export const createDefaultProfile = (): PlayerProfile => ({
  version: 1,
  credits: STARTING_CREDITS,
  ownedParts: [DEFAULT_PART_IDS.fuselage, DEFAULT_PART_IDS.engine, DEFAULT_PART_IDS.wings],
  build: { ...DEFAULT_BUILD },
  bestTime: null,
  bestTimeBuild: null,
  bestTimes: {},
  selectedCircuit: DEFAULT_COURSE_ID,
  racesCompleted: 0,
  podiums: 0,
  wins: 0,
  history: [],
  settings: { ...DEFAULT_SETTINGS },
  bestStyle: 0,
  bestMultiplier: 1,
  badges: [],
  badgeProgress: {},
});

export type PartStatus = 'installed' | 'owned' | 'available' | 'unaffordable' | 'locked';

export const isUnlockRuleMet = (profile: PlayerProfile, part: AircraftPart): boolean => {
  switch (part.unlock.kind) {
    case 'default':
    case 'purchase':
      return true;
    case 'races':
      return profile.racesCompleted >= part.unlock.count;
    case 'podium':
      return profile.podiums >= part.unlock.count;
  }
};

export const isOwned = (profile: PlayerProfile, partId: string): boolean =>
  profile.ownedParts.includes(partId);

export const isInstalled = (profile: PlayerProfile, part: AircraftPart): boolean =>
  profile.build[part.category] === part.id;

export const partStatus = (profile: PlayerProfile, part: AircraftPart): PartStatus => {
  if (isInstalled(profile, part)) return 'installed';
  if (isOwned(profile, part.id)) return 'owned';
  if (!isUnlockRuleMet(profile, part)) return 'locked';
  return profile.credits >= part.price ? 'available' : 'unaffordable';
};

export type PurchaseResult =
  | { ok: true; profile: PlayerProfile }
  | { ok: false; reason: 'unknown-part' | 'already-owned' | 'locked' | 'insufficient-credits' };

/** Pure purchase: returns a new profile on success, never mutates the input. */
export const purchasePart = (profile: PlayerProfile, partId: string): PurchaseResult => {
  const part = getPart(partId);
  if (!part) return { ok: false, reason: 'unknown-part' };
  if (isOwned(profile, partId)) return { ok: false, reason: 'already-owned' };
  if (!isUnlockRuleMet(profile, part)) return { ok: false, reason: 'locked' };
  if (profile.credits < part.price) return { ok: false, reason: 'insufficient-credits' };
  return {
    ok: true,
    profile: {
      ...profile,
      credits: profile.credits - part.price,
      ownedParts: [...profile.ownedParts, partId],
    },
  };
};

export type InstallResult =
  | { ok: true; profile: PlayerProfile }
  | { ok: false; reason: 'unknown-part' | 'not-owned' | 'wrong-category' };

export const installPart = (
  profile: PlayerProfile,
  category: PartCategory,
  partId: string,
): InstallResult => {
  const part = getPart(partId);
  if (!part) return { ok: false, reason: 'unknown-part' };
  if (part.category !== category) return { ok: false, reason: 'wrong-category' };
  if (!isOwned(profile, partId)) return { ok: false, reason: 'not-owned' };
  if (profile.build[category] === partId) return { ok: true, profile };
  return { ok: true, profile: { ...profile, build: { ...profile.build, [category]: partId } } };
};

export const isLiveryAvailable = (profile: PlayerProfile, liveryId: string): boolean => {
  const livery = getLivery(liveryId);
  return livery !== undefined && isLiveryUnlocked(livery, profile.badges);
};

/** Applies a livery; unknown or still-locked liveries leave the profile unchanged. */
export const setLivery = (profile: PlayerProfile, liveryId: string): PlayerProfile =>
  isLiveryAvailable(profile, liveryId)
    ? { ...profile, build: { ...profile.build, livery: liveryId } }
    : profile;

/** Best finish time on a course, or null if it has never been finished. */
export const bestTimeFor = (profile: PlayerProfile, circuitId: string): number | null =>
  profile.bestTimes[circuitId] ?? null;

/** Selects the course the Race button starts; unknown ids leave the profile unchanged. */
export const selectCircuit = (profile: PlayerProfile, circuitId: string): PlayerProfile =>
  isCourseId(circuitId) && circuitId !== profile.selectedCircuit
    ? { ...profile, selectedCircuit: circuitId }
    : profile;

export const updateSettings = (profile: PlayerProfile, patch: Partial<PlayerSettings>): PlayerProfile => ({
  ...profile,
  settings: sanitiseSettings({ ...profile.settings, ...patch }),
});

export const sanitiseSettings = (settings: Partial<PlayerSettings> | undefined): PlayerSettings => ({
  assist: clamp01(
    typeof settings?.assist === 'number' && Number.isFinite(settings.assist)
      ? settings.assist
      : DEFAULT_SETTINGS.assist,
  ),
  invertPitch:
    typeof settings?.invertPitch === 'boolean' ? settings.invertPitch : DEFAULT_SETTINGS.invertPitch,
  audio: typeof settings?.audio === 'boolean' ? settings.audio : DEFAULT_SETTINGS.audio,
  sensitivity: clamp(
    typeof settings?.sensitivity === 'number' && Number.isFinite(settings.sensitivity)
      ? settings.sensitivity
      : DEFAULT_SETTINGS.sensitivity,
    0.5,
    1.5,
  ),
  haptics: typeof settings?.haptics === 'boolean' ? settings.haptics : DEFAULT_SETTINGS.haptics,
});

/** Parts whose unlock rule is satisfied by `after` but was not by `before`. */
export const newlyUnlockedParts = (before: PlayerProfile, after: PlayerProfile): AircraftPart[] =>
  ALL_PARTS.filter((part) => !isUnlockRuleMet(before, part) && isUnlockRuleMet(after, part));

/** Validates untrusted data (from storage) into a safe profile, repairing what it can. */
export const sanitiseProfile = (raw: unknown): PlayerProfile => {
  const base = createDefaultProfile();
  if (typeof raw !== 'object' || raw === null) return base;
  const data = raw as Record<string, unknown>;

  const credits =
    typeof data.credits === 'number' && Number.isFinite(data.credits)
      ? clamp(Math.floor(data.credits), 0, 9_999_999)
      : base.credits;

  const ownedSet = new Set(base.ownedParts);
  if (Array.isArray(data.ownedParts)) {
    for (const id of data.ownedParts) {
      if (typeof id === 'string' && getPart(id)) ownedSet.add(id);
    }
  }
  const ownedParts = [...ownedSet];

  // Badges first: they decide which liveries the saved build may use.
  const badges: string[] = [];
  if (Array.isArray(data.badges)) {
    for (const id of data.badges) if (isBadgeId(id) && !badges.includes(id)) badges.push(id);
  }
  const badgeProgress: Record<string, number> = {};
  if (typeof data.badgeProgress === 'object' && data.badgeProgress !== null) {
    for (const [id, value] of Object.entries(data.badgeProgress as Record<string, unknown>)) {
      if (isBadgeId(id) && typeof value === 'number' && Number.isFinite(value))
        badgeProgress[id] = clamp01(value);
    }
  }

  let build: AircraftBuild = { ...base.build };
  if (isValidBuild(data.build)) {
    build = { ...data.build };
    // Never leave an un-owned part installed.
    for (const category of ['fuselage', 'engine', 'wings'] as const) {
      if (!ownedSet.has(build[category])) build[category] = base.build[category];
    }
    const livery = getLivery(build.livery);
    if (!livery || !isLiveryUnlocked(livery, badges)) build.livery = DEFAULT_LIVERY_ID;
  }

  const positiveInt = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

  const bestTime =
    typeof data.bestTime === 'number' && Number.isFinite(data.bestTime) && data.bestTime > 0
      ? data.bestTime
      : null;
  const bestTimeBuild =
    bestTime !== null && isValidBuild(data.bestTimeBuild) ? { ...data.bestTimeBuild } : null;
  const bestTimes: Record<string, number> = {};
  if (typeof data.bestTimes === 'object' && data.bestTimes !== null) {
    for (const [id, value] of Object.entries(data.bestTimes as Record<string, unknown>)) {
      if (isCourseId(id) && typeof value === 'number' && Number.isFinite(value) && value > 0)
        bestTimes[id] = value;
    }
  }
  // Saves from before multiple courses only know the Caldera Ridge best.
  if (bestTime !== null && bestTimes[DEFAULT_COURSE_ID] === undefined)
    bestTimes[DEFAULT_COURSE_ID] = bestTime;

  const history: RaceRecord[] = [];
  if (Array.isArray(data.history)) {
    for (const entry of data.history) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (
        typeof record.time === 'number' &&
        Number.isFinite(record.time) &&
        typeof record.position === 'number' &&
        isValidBuild(record.build)
      ) {
        history.push({
          circuitId: typeof record.circuitId === 'string' ? record.circuitId : 'caldera-ridge',
          position: clamp(Math.floor(record.position), 1, 99),
          time: record.time,
          rawTime:
            typeof record.rawTime === 'number' && Number.isFinite(record.rawTime)
              ? record.rawTime
              : record.time,
          missedGates: positiveInt(record.missedGates),
          credits: positiveInt(record.credits),
          date: typeof record.date === 'string' ? record.date : new Date(0).toISOString(),
          build: { ...record.build },
          style: positiveInt(record.style),
        });
      }
      if (history.length >= MAX_HISTORY) break;
    }
  }

  return {
    version: 1,
    credits,
    ownedParts,
    build,
    bestTime,
    bestTimeBuild,
    bestTimes,
    selectedCircuit: isCourseId(data.selectedCircuit) ? data.selectedCircuit : DEFAULT_COURSE_ID,
    racesCompleted: positiveInt(data.racesCompleted),
    podiums: positiveInt(data.podiums),
    wins: positiveInt(data.wins),
    history,
    settings: sanitiseSettings(data.settings as Partial<PlayerSettings> | undefined),
    bestStyle: positiveInt(data.bestStyle),
    bestMultiplier:
      typeof data.bestMultiplier === 'number' && Number.isFinite(data.bestMultiplier)
        ? clamp(data.bestMultiplier, 1, 4)
        : 1,
    badges,
    badgeProgress,
  };
};
