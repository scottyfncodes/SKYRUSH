import {
  LEGACY_FUSELAGES,
  buildsEqual,
  defaultBuildFor,
  isValidBuild,
  legacyPaint,
  migrateBuild,
  effectiveAirframe,
  withSection,
  type AircraftBuild,
  type AircraftSetup,
} from '../aircraft/build';
import {
  AIRFRAMES,
  ALL_ITEMS,
  DEFAULT_AIRFRAME_ID,
  PART_CATEGORIES,
  getAirframe,
  getItem,
  getPartIn,
  isCompatible,
  isSectionCategory,
  type Airframe,
  type PartCategory,
  type ShopItem,
} from '../aircraft/parts';
import {
  FACTORY_THEMES,
  factoryPaint,
  getTheme,
  isPaintUnlocked,
  isThemeUnlocked,
  isValidPaint,
  sanitisePaint,
  type Paint,
} from '../aircraft/paint';
import { clamp, clamp01 } from '../core/math';
import { isBadgeId } from './badges';
import { RIVAL_IDS } from './rivals';
import { DEFAULT_COURSE_ID, isCourseId } from '../course/courses';
import { isActivityId, isDiscoveryId, type MedalTier } from '../activities/catalog';

export const STARTING_CREDITS = 2500;
export const MAX_HISTORY = 12;
export const MAX_SETUPS = 8;
export const SETUP_NAME_LENGTH = 24;

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

/** One aircraft in the hangar: its current parts and paint. */
export interface HangarEntry {
  build: AircraftBuild;
  paint: Paint;
}

/** A named configuration the player saved, for any aircraft they own. */
export interface SavedSetup {
  id: string;
  name: string;
  build: AircraftBuild;
  paint: Paint;
}

export interface PlayerProfile {
  version: 2;
  credits: number;
  /** Owned airframes and parts (parts are shared across every aircraft that accepts them). */
  ownedParts: string[];
  /** Airframe id of the aircraft that races. */
  activeAircraft: string;
  /** Every owned aircraft's configuration, keyed by airframe id. */
  hangar: Record<string, HangarEntry>;
  setups: SavedSetup[];
  /** Airframes whose first reveal has been shown. */
  revealed: string[];
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
  /** Earned skill badge ids (each unlocks a paint swatch and theme). */
  badges: string[];
  /** Best single-race progress (0..1) toward each badge, for "next unlock" hints. */
  badgeProgress: Record<string, number>;
  /** Head-to-head challenge record against each rival pilot. */
  rivals: Record<string, RivalRecord>;
  /** Best result and medal per activity id (see activities/catalog.ts). */
  activities: Record<string, ActivityRecord>;
  /** Discovery ids found in free flight (and on any other non-race flight). */
  discoveries: string[];
  /** Per-aircraft flight log, keyed by airframe id. */
  logbook: Record<string, AircraftLog>;
  /** Activity last opened on the flight board. */
  selectedActivity: string;
}

export interface ActivityRecord {
  /** Best value: a time (trials, deliveries), an accuracy (precision) or a score (shows). */
  best: number | null;
  medal: MedalTier;
  runs: number;
}

export interface AircraftLog {
  flights: number;
  /** Kilometres flown. */
  distance: number;
  /** Medals won flying this aircraft (every tier counts once per activity). */
  medals: number;
}

export interface RivalRecord {
  wins: number;
  losses: number;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  assist: 0.6,
  invertPitch: false,
  audio: true,
  sensitivity: 1,
  haptics: true,
};

export { FACTORY_THEMES, factoryPaint };

const factoryEntry = (airframe: Airframe): HangarEntry => ({
  build: defaultBuildFor(airframe),
  paint: factoryPaint(airframe.id),
});

const factoryParts = (airframe: Airframe): string[] => [
  airframe.id,
  ...PART_CATEGORIES.map((category) => airframe.defaults[category]),
];

export const createDefaultProfile = (): PlayerProfile => {
  const starter = getAirframe(DEFAULT_AIRFRAME_ID)!;
  return {
    version: 2,
    credits: STARTING_CREDITS,
    ownedParts: factoryParts(starter),
    activeAircraft: starter.id,
    hangar: { [starter.id]: factoryEntry(starter) },
    setups: [],
    revealed: [starter.id],
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
    rivals: {},
    activities: {},
    discoveries: [],
    logbook: {},
    selectedActivity: '',
  };
};

/**
 * Licence stars: one per medal tier won in each activity (bronze 1, silver 2,
 * gold 3) and one per discovery. Stars rank the pilot's licence and unlock items.
 */
export const licenceStars = (profile: Pick<PlayerProfile, 'activities' | 'discoveries'>): number =>
  Object.values(profile.activities).reduce((sum, record) => sum + record.medal, 0) +
  profile.discoveries.length;

// --- Queries --------------------------------------------------------------------------------

export const activeEntry = (profile: PlayerProfile): HangarEntry =>
  profile.hangar[profile.activeAircraft] ?? factoryEntry(getAirframe(DEFAULT_AIRFRAME_ID)!);

export const activeBuild = (profile: PlayerProfile): AircraftBuild => activeEntry(profile).build;

/** What the race and the hangar draw for the active aircraft. */
export const activeSetup = (profile: PlayerProfile): AircraftSetup => ({
  build: { ...activeEntry(profile).build },
  paint: { ...activeEntry(profile).paint },
  marks: profile.wins,
});

export const isOwned = (profile: PlayerProfile, id: string): boolean => profile.ownedParts.includes(id);

export const isUnlockRuleMet = (profile: PlayerProfile, item: ShopItem): boolean => {
  const rule = item.unlock;
  switch (rule.kind) {
    case 'default':
    case 'purchase':
      return true;
    case 'races':
      return profile.racesCompleted >= rule.count;
    case 'podium':
      return profile.podiums >= rule.count;
    case 'wins':
      return profile.wins >= rule.count;
    case 'style':
      return profile.bestStyle >= rule.score;
    case 'airframe':
      return isOwned(profile, rule.airframe);
    case 'rival':
      return isOwned(profile, rule.airframe) || (profile.rivals[rule.rival]?.wins ?? 0) > 0;
    case 'stars':
      return licenceStars(profile) >= rule.count;
  }
};

/** True when the item's unlock rule is met and any prerequisite is owned. */
export const isAvailable = (profile: PlayerProfile, item: ShopItem): boolean =>
  isUnlockRuleMet(profile, item) && (!item.requires || isOwned(profile, item.requires));

export type PartStatus = 'installed' | 'owned' | 'available' | 'unaffordable' | 'locked' | 'incompatible';

/** Status of a part for one aircraft (defaults to the active one). */
export const partStatus = (
  profile: PlayerProfile,
  item: ShopItem,
  airframeId: string = profile.activeAircraft,
): PartStatus => {
  if (item.kind === 'airframe') {
    if (profile.activeAircraft === item.id) return 'installed';
    if (isOwned(profile, item.id)) return 'owned';
  } else {
    const entry = profile.hangar[airframeId];
    // Sections are judged against the jig itself; everything else against what the sections allow.
    const airframe =
      entry && !isSectionCategory(item.category) ? effectiveAirframe(entry.build) : getAirframe(airframeId);
    if (!airframe || !isCompatible(airframe, item)) return 'incompatible';
    if (entry && entry.build[item.category] === item.id) return 'installed';
    if (isOwned(profile, item.id)) return 'owned';
  }
  if (!isAvailable(profile, item)) return 'locked';
  return profile.credits >= item.price ? 'available' : 'unaffordable';
};

// --- Purchases and fitting ----------------------------------------------------------------

export type PurchaseFailure = 'unknown-part' | 'already-owned' | 'locked' | 'insufficient-credits';
export type PurchaseResult = { ok: true; profile: PlayerProfile } | { ok: false; reason: PurchaseFailure };

/**
 * Pure purchase: returns a new profile on success and never mutates the input.
 * Buying an aircraft also delivers its factory parts and puts it in the hangar.
 */
export const purchasePart = (profile: PlayerProfile, id: string): PurchaseResult => {
  const item = getItem(id);
  if (!item) return { ok: false, reason: 'unknown-part' };
  if (isOwned(profile, id)) return { ok: false, reason: 'already-owned' };
  // Sections come with their aircraft or from rivals; they are never sold on their own.
  if (item.kind === 'part' && isSectionCategory(item.category)) return { ok: false, reason: 'locked' };
  if (!isAvailable(profile, item)) return { ok: false, reason: 'locked' };
  if (profile.credits < item.price) return { ok: false, reason: 'insufficient-credits' };
  const owned = new Set(profile.ownedParts);
  owned.add(id);
  let hangar = profile.hangar;
  if (item.kind === 'airframe') {
    for (const partId of factoryParts(item)) owned.add(partId);
    hangar = { ...hangar, [item.id]: hangar[item.id] ?? factoryEntry(item) };
  }
  return {
    ok: true,
    profile: { ...profile, credits: profile.credits - item.price, ownedParts: [...owned], hangar },
  };
};

export type InstallFailure = 'unknown-part' | 'not-owned' | 'wrong-category' | 'incompatible';
export type InstallResult = { ok: true; profile: PlayerProfile } | { ok: false; reason: InstallFailure };

/** Fits an owned part to the active aircraft. Other aircraft are untouched. */
export const installPart = (
  profile: PlayerProfile,
  category: PartCategory,
  partId: string,
): InstallResult => {
  const part = getItem(partId);
  if (!part || part.kind !== 'part') return { ok: false, reason: 'unknown-part' };
  if (part.category !== category) return { ok: false, reason: 'wrong-category' };
  const entry = activeEntry(profile);
  const section = isSectionCategory(part.category);
  const airframe = section ? getAirframe(entry.build.airframe) : effectiveAirframe(entry.build);
  if (!airframe || !isCompatible(airframe, part)) return { ok: false, reason: 'incompatible' };
  if (!isOwned(profile, partId)) return { ok: false, reason: 'not-owned' };
  if (entry.build[category] === partId) return { ok: true, profile };
  // Swapping a section can leave components that no longer fit: they fall back to owned
  // parts that do (the factory parts of the section's aircraft are owned with it).
  const build = section
    ? withSection(entry.build, part.category as 'nose' | 'cabin' | 'boom', partId, (id) =>
        isOwned(profile, id),
      )
    : { ...entry.build, [category]: partId };
  if (missingParts(profile, build).length > 0) return { ok: false, reason: 'not-owned' };
  return {
    ok: true,
    profile: {
      ...profile,
      hangar: { ...profile.hangar, [entry.build.airframe]: { ...entry, build } },
    },
  };
};

/** Makes an owned aircraft the one that races. Unknown or unowned ids leave the profile unchanged. */
export const selectAircraft = (profile: PlayerProfile, airframeId: string): PlayerProfile => {
  const airframe = getAirframe(airframeId);
  if (!airframe || !isOwned(profile, airframeId) || profile.activeAircraft === airframeId) return profile;
  return {
    ...profile,
    activeAircraft: airframeId,
    hangar: { ...profile.hangar, [airframeId]: profile.hangar[airframeId] ?? factoryEntry(airframe) },
  };
};

export type ApplyBuildFailure = 'invalid' | 'aircraft-not-owned' | 'parts-not-owned';

/** Parts in a build that the player does not own yet. */
export const missingParts = (profile: PlayerProfile, build: AircraftBuild): string[] =>
  [build.airframe, ...PART_CATEGORIES.map((category) => build[category])].filter(
    (id) => !isOwned(profile, id),
  );

/**
 * Applies a whole build (a saved setup, a factory setup or a revert) to its aircraft
 * and makes that aircraft active. Every part must already be owned: this never buys.
 */
export const applyBuild = (
  profile: PlayerProfile,
  build: AircraftBuild,
  paint?: Paint,
): { ok: true; profile: PlayerProfile } | { ok: false; reason: ApplyBuildFailure } => {
  if (!isValidBuild(build)) return { ok: false, reason: 'invalid' };
  if (!isOwned(profile, build.airframe)) return { ok: false, reason: 'aircraft-not-owned' };
  if (missingParts(profile, build).length > 0) return { ok: false, reason: 'parts-not-owned' };
  const current = profile.hangar[build.airframe] ?? factoryEntry(getAirframe(build.airframe)!);
  const nextPaint =
    paint && isValidPaint(paint) && isPaintUnlocked(paint, profile.badges) ? paint : current.paint;
  return {
    ok: true,
    profile: {
      ...profile,
      activeAircraft: build.airframe,
      hangar: { ...profile.hangar, [build.airframe]: { build: { ...build }, paint: { ...nextPaint } } },
    },
  };
};

// --- Paint ---------------------------------------------------------------------------------

/** Repaints the active aircraft. Invalid or locked paint leaves the profile unchanged. */
export const setPaint = (profile: PlayerProfile, paint: Paint): PlayerProfile => {
  if (!isValidPaint(paint) || !isPaintUnlocked(paint, profile.badges)) return profile;
  const entry = activeEntry(profile);
  return {
    ...profile,
    hangar: { ...profile.hangar, [entry.build.airframe]: { ...entry, paint: { ...paint } } },
  };
};

export const isThemeAvailable = (profile: PlayerProfile, themeId: string): boolean => {
  const theme = getTheme(themeId);
  return theme !== undefined && isThemeUnlocked(theme, profile.badges);
};

/** Applies a livery theme to the active aircraft; unknown or locked themes leave the profile unchanged. */
export const setLivery = (profile: PlayerProfile, themeId: string): PlayerProfile => {
  const theme = getTheme(themeId);
  if (!theme || !isThemeUnlocked(theme, profile.badges)) return profile;
  return setPaint(profile, { ...theme.paint });
};

// --- Saved setups ----------------------------------------------------------------------------

export const cleanSetupName = (name: string): string =>
  name.replace(/\s+/g, ' ').trim().slice(0, SETUP_NAME_LENGTH);

/** Saves the active aircraft's parts and paint under a name. Fails when the slots are full. */
export const saveSetup = (
  profile: PlayerProfile,
  name: string,
  now = Date.now(),
): { ok: true; profile: PlayerProfile; setup: SavedSetup } | { ok: false; reason: 'full' | 'empty-name' } => {
  const clean = cleanSetupName(name);
  if (!clean) return { ok: false, reason: 'empty-name' };
  if (profile.setups.length >= MAX_SETUPS) return { ok: false, reason: 'full' };
  const entry = activeEntry(profile);
  let id = `setup-${now.toString(36)}`;
  while (profile.setups.some((setup) => setup.id === id)) id += 'x';
  const setup: SavedSetup = { id, name: clean, build: { ...entry.build }, paint: { ...entry.paint } };
  return { ok: true, profile: { ...profile, setups: [...profile.setups, setup] }, setup };
};

export const deleteSetup = (profile: PlayerProfile, setupId: string): PlayerProfile =>
  profile.setups.some((setup) => setup.id === setupId)
    ? { ...profile, setups: profile.setups.filter((setup) => setup.id !== setupId) }
    : profile;

export const markRevealed = (profile: PlayerProfile, airframeId: string): PlayerProfile =>
  profile.revealed.includes(airframeId)
    ? profile
    : { ...profile, revealed: [...profile.revealed, airframeId] };

// --- Courses and settings ------------------------------------------------------------------

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

/** Items whose unlock rule is satisfied by `after` but was not by `before`. */
export const newlyUnlockedParts = (before: PlayerProfile, after: PlayerProfile): ShopItem[] =>
  ALL_ITEMS.filter((item) => !isUnlockRuleMet(before, item) && isUnlockRuleMet(after, item));

// --- Loading untrusted data ----------------------------------------------------------------

/**
 * Keeps only owned parts in a build: anything unowned or unknown falls back to the
 * airframe's factory part, slot by slot.
 */
const ownedBuild = (raw: unknown, owned: ReadonlySet<string>): AircraftBuild | null => {
  const build = migrateBuild(raw);
  if (!build) return null;
  const airframe = getAirframe(build.airframe)!;
  for (const category of PART_CATEGORIES) {
    if (!owned.has(build[category])) build[category] = airframe.defaults[category];
  }
  return build;
};

/** Validates untrusted data (from storage) into a safe profile, repairing what it can. */
export const sanitiseProfile = (raw: unknown): PlayerProfile => {
  const base = createDefaultProfile();
  if (typeof raw !== 'object' || raw === null) return base;
  const data = raw as Record<string, unknown>;

  const credits =
    typeof data.credits === 'number' && Number.isFinite(data.credits)
      ? clamp(Math.floor(data.credits), 0, 9_999_999)
      : base.credits;

  // Ownership: known ids only; original fuselages become their airframes.
  const owned = new Set(base.ownedParts);
  if (Array.isArray(data.ownedParts)) {
    for (const id of data.ownedParts) {
      if (typeof id !== 'string') continue;
      const mapped = LEGACY_FUSELAGES[id] ?? id;
      if (getItem(mapped)) owned.add(mapped);
    }
  }
  // Owning an aircraft means owning its factory parts.
  for (const airframe of AIRFRAMES) {
    if (owned.has(airframe.id)) for (const id of factoryParts(airframe)) owned.add(id);
  }

  // Badges first: they decide which swatches saved paint may use.
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

  const hangar: Record<string, HangarEntry> = {};
  let activeAircraft = DEFAULT_AIRFRAME_ID as string;
  if (typeof data.hangar === 'object' && data.hangar !== null && !Array.isArray(data.hangar)) {
    for (const [airframeId, value] of Object.entries(data.hangar as Record<string, unknown>)) {
      if (!getAirframe(airframeId) || !owned.has(airframeId)) continue;
      if (typeof value !== 'object' || value === null) continue;
      const entry = value as Record<string, unknown>;
      const build = ownedBuild(entry.build, owned);
      if (!build || build.airframe !== airframeId) continue;
      hangar[airframeId] = { build, paint: sanitisePaint(entry.paint, badges) };
    }
  } else {
    // Version 1 save: a single {fuselage, engine, wings, livery} build.
    const build = ownedBuild(data.build, owned);
    if (build) {
      const paint = legacyPaint(data.build);
      hangar[build.airframe] = {
        build,
        paint: paint && isPaintUnlocked(paint, badges) ? paint : factoryPaint(build.airframe),
      };
      activeAircraft = build.airframe;
    }
  }
  for (const airframe of AIRFRAMES) {
    if (owned.has(airframe.id) && !hangar[airframe.id]) hangar[airframe.id] = factoryEntry(airframe);
  }
  if (typeof data.activeAircraft === 'string' && hangar[data.activeAircraft])
    activeAircraft = data.activeAircraft;

  const setups: SavedSetup[] = [];
  if (Array.isArray(data.setups)) {
    for (const value of data.setups) {
      if (typeof value !== 'object' || value === null) continue;
      const setup = value as Record<string, unknown>;
      const build = migrateBuild(setup.build);
      const name = typeof setup.name === 'string' ? cleanSetupName(setup.name) : '';
      const id = typeof setup.id === 'string' ? setup.id.slice(0, 40) : '';
      if (!build || !name || !id || setups.some((s) => s.id === id)) continue;
      setups.push({ id, name, build, paint: sanitisePaint(setup.paint, badges) });
      if (setups.length >= MAX_SETUPS) break;
    }
  }

  const revealed = new Set<string>([DEFAULT_AIRFRAME_ID]);
  if (Array.isArray(data.revealed)) {
    for (const id of data.revealed) if (typeof id === 'string' && getAirframe(id)) revealed.add(id);
  } else {
    // Older saves: anything already owned has been seen.
    for (const airframe of AIRFRAMES) if (owned.has(airframe.id)) revealed.add(airframe.id);
  }

  const positiveInt = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

  const bestTime =
    typeof data.bestTime === 'number' && Number.isFinite(data.bestTime) && data.bestTime > 0
      ? data.bestTime
      : null;
  const bestTimeBuild = bestTime !== null ? migrateBuild(data.bestTimeBuild) : null;
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
      const build = migrateBuild(record.build);
      if (
        typeof record.time === 'number' &&
        Number.isFinite(record.time) &&
        typeof record.position === 'number' &&
        build
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
          build,
          style: positiveInt(record.style),
        });
      }
      if (history.length >= MAX_HISTORY) break;
    }
  }

  const rivals: Record<string, RivalRecord> = {};
  if (typeof data.rivals === 'object' && data.rivals !== null && !Array.isArray(data.rivals)) {
    for (const [id, value] of Object.entries(data.rivals as Record<string, unknown>)) {
      if (!RIVAL_IDS.has(id) || typeof value !== 'object' || value === null) continue;
      const record = value as Record<string, unknown>;
      rivals[id] = { wins: positiveInt(record.wins), losses: positiveInt(record.losses) };
    }
  }

  const activities: Record<string, ActivityRecord> = {};
  if (typeof data.activities === 'object' && data.activities !== null && !Array.isArray(data.activities)) {
    for (const [id, value] of Object.entries(data.activities as Record<string, unknown>)) {
      if (!isActivityId(id) || typeof value !== 'object' || value === null) continue;
      const record = value as Record<string, unknown>;
      const best =
        typeof record.best === 'number' && Number.isFinite(record.best) && record.best >= 0
          ? record.best
          : null;
      activities[id] = {
        best,
        medal: clamp(positiveInt(record.medal), 0, 3) as MedalTier,
        runs: positiveInt(record.runs),
      };
    }
  }
  const discoveries: string[] = [];
  if (Array.isArray(data.discoveries)) {
    for (const id of data.discoveries)
      if (isDiscoveryId(id) && !discoveries.includes(id)) discoveries.push(id);
  }
  const logbook: Record<string, AircraftLog> = {};
  if (typeof data.logbook === 'object' && data.logbook !== null && !Array.isArray(data.logbook)) {
    for (const [id, value] of Object.entries(data.logbook as Record<string, unknown>)) {
      if (!getAirframe(id) || typeof value !== 'object' || value === null) continue;
      const log = value as Record<string, unknown>;
      logbook[id] = {
        flights: positiveInt(log.flights),
        distance:
          typeof log.distance === 'number' && Number.isFinite(log.distance) ? clamp(log.distance, 0, 1e7) : 0,
        medals: positiveInt(log.medals),
      };
    }
  }

  return {
    version: 2,
    credits,
    ownedParts: [...owned],
    activeAircraft,
    hangar,
    setups,
    revealed: [...revealed],
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
    rivals,
    activities,
    discoveries,
    logbook,
    selectedActivity: isActivityId(data.selectedActivity) ? data.selectedActivity : '',
  };
};

/** True when two hangar entries hold the same parts and paint. */
export const entriesEqual = (a: HangarEntry, b: HangarEntry): boolean =>
  buildsEqual(a.build, b.build) && JSON.stringify(a.paint) === JSON.stringify(b.paint);

/** The part currently in a slot of an aircraft (for comparisons). */
export const fittedPart = (profile: PlayerProfile, airframeId: string, category: PartCategory) => {
  const entry = profile.hangar[airframeId];
  return entry ? getPartIn(category, entry.build[category]) : undefined;
};
