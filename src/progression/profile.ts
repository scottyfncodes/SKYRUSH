import { DEFAULT_BUILD, isValidBuild, type AircraftBuild } from '../aircraft/build';
import {
  ALL_PARTS,
  DEFAULT_PART_IDS,
  getPart,
  type AircraftPart,
  type PartCategory,
} from '../aircraft/parts';
import { clamp, clamp01 } from '../core/math';

export const STARTING_CREDITS = 2500;
export const MAX_HISTORY = 12;

export interface PlayerSettings {
  assist: number; // 0..1 flight assistance strength
  invertPitch: boolean;
  audio: boolean;
  sensitivity: number; // 0.5..1.5
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
}

export interface PlayerProfile {
  version: 1;
  credits: number;
  ownedParts: string[];
  build: AircraftBuild;
  bestTime: number | null;
  bestTimeBuild: AircraftBuild | null;
  racesCompleted: number;
  podiums: number;
  wins: number;
  history: RaceRecord[];
  settings: PlayerSettings;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  assist: 0.6,
  invertPitch: false,
  audio: true,
  sensitivity: 1,
};

export const createDefaultProfile = (): PlayerProfile => ({
  version: 1,
  credits: STARTING_CREDITS,
  ownedParts: [DEFAULT_PART_IDS.fuselage, DEFAULT_PART_IDS.engine, DEFAULT_PART_IDS.wings],
  build: { ...DEFAULT_BUILD },
  bestTime: null,
  bestTimeBuild: null,
  racesCompleted: 0,
  podiums: 0,
  wins: 0,
  history: [],
  settings: { ...DEFAULT_SETTINGS },
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

export const setLivery = (profile: PlayerProfile, liveryId: string): PlayerProfile => ({
  ...profile,
  build: { ...profile.build, livery: liveryId },
});

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

  let build: AircraftBuild = { ...base.build };
  if (isValidBuild(data.build)) {
    build = { ...data.build };
    // Never leave an un-owned part installed.
    for (const category of ['fuselage', 'engine', 'wings'] as const) {
      if (!ownedSet.has(build[category])) build[category] = base.build[category];
    }
  }

  const positiveInt = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

  const bestTime =
    typeof data.bestTime === 'number' && Number.isFinite(data.bestTime) && data.bestTime > 0
      ? data.bestTime
      : null;
  const bestTimeBuild =
    bestTime !== null && isValidBuild(data.bestTimeBuild) ? { ...data.bestTimeBuild } : null;

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
    racesCompleted: positiveInt(data.racesCompleted),
    podiums: positiveInt(data.podiums),
    wins: positiveInt(data.wins),
    history,
    settings: sanitiseSettings(data.settings as Partial<PlayerSettings> | undefined),
  };
};
