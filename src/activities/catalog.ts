import type { Conditions } from './conditions';

/**
 * Everything there is to fly. Each region (course) holds a Grand Prix, a time
 * trial against a ghost, two signature activities and free flight with hidden
 * discoveries. Activities are data: places are given relative to the region's
 * racing line (`SegmentRef`), so they always sit in the carved valley, and the
 * simulations resolve them against the real terrain.
 */

export type ActivityKind = 'race' | 'trial' | 'precision' | 'show' | 'delivery' | 'explore';

/** 0 = none, 1 = bronze, 2 = silver, 3 = gold. */
export type MedalTier = 0 | 1 | 2 | 3;
export const MEDAL_NAMES = ['None', 'Bronze', 'Silver', 'Gold'] as const;

/** A point on the region's racing line: `t` of the way from race gate `after` to the next, shifted sideways. */
export interface SegmentRef {
  after: number;
  t: number;
  lateral?: number;
}

interface ActivityBase {
  id: string;
  regionId: string;
  name: string;
  /** One line under the name on the flight board. */
  brief: string;
  /** What the pilot is asked to do, shown when the row is opened. */
  instructions: string;
  conditions: Conditions;
}

export interface RaceActivity extends ActivityBase {
  kind: 'race';
}

/** Medal thresholds in seconds: lower is better. */
export interface TimeMedals {
  bronze: number;
  silver: number;
  gold: number;
}

export interface TrialActivity extends ActivityBase {
  kind: 'trial';
  medals: TimeMedals;
}

export interface PrecisionGateSpec extends SegmentRef {
  /** Height of the gate centre above the ground under it (m). */
  agl: number;
  width: number;
  height: number;
}

export interface PrecisionActivity extends ActivityBase {
  kind: 'precision';
  gates: readonly PrecisionGateSpec[];
  /** Run is over if the last gate is not reached within this many seconds. */
  timeLimit: number;
  /** Average accuracy (0..100) for silver and gold; any clean finish earns bronze. */
  medals: { silver: number; gold: number };
}

export interface ShowActivity extends ActivityBase {
  kind: 'show';
  /** Square show box: centre, half size and ceiling above the box floor (m). */
  box: { x: number; z: number; half: number; ceiling: number };
  /** Length of the display (s). */
  duration: number;
  medals: { bronze: number; silver: number; gold: number };
}

export interface DeliveryStop extends SegmentRef {
  name: string;
  kind: 'pickup' | 'drop';
  /** On the water (a mail buoy): float gear may touch down inside the zone. */
  water?: boolean;
}

export interface CargoSpec {
  name: string;
  /** Added mass (kg). */
  mass: number;
  /** Bank angle (degrees) beyond which the cargo starts to suffer. */
  bankLimit: number;
}

export interface DeliveryActivity extends ActivityBase {
  kind: 'delivery';
  cargo: CargoSpec;
  stops: readonly DeliveryStop[];
  /** Hook passes must be below this airspeed (km/h) and height above the ground (m). */
  hookSpeedKmh: number;
  hookHeight: number;
  /** Medal times (s); silver and gold also need the cargo in good condition. */
  medals: TimeMedals;
  /** Minimum cargo condition (0..100) for bronze, silver and gold. */
  condition: { bronze: number; silver: number; gold: number };
}

export interface ExploreActivity extends ActivityBase {
  kind: 'explore';
}

export type Activity =
  | RaceActivity
  | TrialActivity
  | PrecisionActivity
  | ShowActivity
  | DeliveryActivity
  | ExploreActivity;

export type DiscoveryKind =
  | 'wreck'
  | 'cairn'
  | 'cabin'
  | 'beacon'
  | 'shipwreck'
  | 'buoy'
  | 'observatory'
  | 'trail';

export interface DiscoverySpec {
  id: string;
  regionId: string;
  name: string;
  /** A hint shown before it is found. */
  hint: string;
  /** What the pilot learns once it is found. */
  lore: string;
  kind: DiscoveryKind;
  x: number;
  z: number;
  /** Trails: the far end of the line; rings run from (x, z) to here over the terrain. */
  to?: { x: number; z: number };
}

// --- Labels -------------------------------------------------------------------------------------

export const KIND_LABELS: Record<ActivityKind, string> = {
  race: 'Grand Prix',
  trial: 'Time trial',
  precision: 'Precision',
  show: 'Air show',
  delivery: 'Delivery',
  explore: 'Free flight',
};

const CLEAR: Conditions = { time: 'authored', weather: 'clear', windHeading: 0 };

const raceAndTrial = (regionId: string, medals: TimeMedals, region: string): Activity[] => [
  {
    id: `${regionId}:race`,
    kind: 'race',
    regionId,
    name: `${region} Grand Prix`,
    brief: 'Four aircraft, one lap, every gate counts',
    instructions:
      'Race three AI pilots through every gate. Finishing position, a clean run and style all pay credits.',
    conditions: CLEAR,
  },
  {
    id: `${regionId}:trial`,
    kind: 'trial',
    regionId,
    name: `${region} Time Trial`,
    brief: 'The course to yourself and a ghost to beat',
    instructions:
      'Fly the Grand Prix course alone against a ghost: the club pace until you set a time, then your own best lap.',
    conditions: CLEAR,
    medals,
  },
];

const freeFlight = (regionId: string, region: string, conditions: Conditions = CLEAR): ExploreActivity => ({
  id: `${regionId}:explore`,
  kind: 'explore',
  regionId,
  name: `Free flight: ${region}`,
  brief: 'No clock. Five things out there worth finding',
  instructions:
    'Fly anywhere. A signal readout counts down as you near something undiscovered. End the flight from the pause menu to log what you found.',
  conditions,
});

export const ACTIVITIES: readonly Activity[] = [
  // --- Caldera Ridge ---------------------------------------------------------------------------
  ...raceAndTrial('caldera-ridge', { gold: 90, silver: 100, bronze: 110 }, 'Caldera'),
  {
    id: 'caldera-ridge:show',
    kind: 'show',
    regionId: 'caldera-ridge',
    name: 'Proving Grounds Air Show',
    brief: 'Ninety seconds in front of the grandstand',
    instructions:
      'Fly loops, rolls, inverted passes and knife edges inside the pylons. Chain figures for a multiplier, vary them, and fly them low for a bonus.',
    conditions: { time: 'authored', weather: 'clear', windHeading: 0 },
    box: { x: -40, z: 60, half: 420, ceiling: 520 },
    duration: 90,
    medals: { bronze: 3000, silver: 7500, gold: 13000 },
  },
  {
    id: 'caldera-ridge:precision',
    kind: 'precision',
    regionId: 'caldera-ridge',
    name: 'Needle Eye',
    brief: 'Narrow gates down the canyon and under the arch',
    instructions:
      'Thread twelve narrow gates low through the canyon, including the chicane under the arch. Miss one or crash and the run is over. Accuracy decides the medal.',
    conditions: { time: 'authored', weather: 'clear', windHeading: 0 },
    gates: [
      { after: 5, t: 0.45, lateral: 0, agl: 26, width: 22, height: 16 },
      { after: 5, t: 0.8, lateral: -14, agl: 22, width: 20, height: 16 },
      { after: 6, t: 0.4, lateral: 12, agl: 22, width: 20, height: 15 },
      { after: 6, t: 0.8, lateral: -10, agl: 20, width: 20, height: 15 },
      { after: 7, t: 0.35, lateral: 0, agl: 22, width: 20, height: 15 },
      { after: 7, t: 0.75, lateral: 0, agl: 30, width: 20, height: 16 },
      { after: 8, t: 0.45, lateral: 10, agl: 22, width: 18, height: 15 },
      { after: 8, t: 0.85, lateral: -10, agl: 22, width: 18, height: 15 },
      { after: 9, t: 0.5, lateral: 0, agl: 20, width: 20, height: 15 },
      { after: 10, t: 0.3, lateral: 14, agl: 20, width: 20, height: 15 },
      { after: 10, t: 0.75, lateral: -14, agl: 22, width: 20, height: 15 },
      { after: 11, t: 0.5, lateral: 0, agl: 26, width: 22, height: 16 },
    ],
    timeLimit: 90,
    medals: { silver: 55, gold: 72 },
  },
  freeFlight('caldera-ridge', 'Caldera Ridge'),

  // --- Frostline Pass --------------------------------------------------------------------------
  ...raceAndTrial('frostline-pass', { gold: 91, silver: 99, bronze: 110 }, 'Frostline'),
  {
    id: 'frostline-pass:delivery',
    kind: 'delivery',
    regionId: 'frostline-pass',
    name: 'Summit Relay',
    brief: 'Serum up to the High Pass hut in a dawn gale',
    instructions:
      'Hook the serum crate at the pine valley depot with a slow, low pass, then follow the climb up to the High Pass hut. Steep banks and scrapes damage it, and the gusts will try.',
    conditions: { time: 'dawn', weather: 'gusty', windHeading: Math.PI * 0.35 },
    cargo: { name: 'Serum crate', mass: 160, bankLimit: 40 },
    stops: [
      { name: 'Pine valley depot', kind: 'pickup', after: 0, t: 0.75 },
      { name: 'High Pass hut', kind: 'drop', after: 5, t: 0.55 },
    ],
    hookSpeedKmh: 190,
    hookHeight: 40,
    medals: { bronze: 150, silver: 68, gold: 55 },
    condition: { bronze: 30, silver: 65, gold: 85 },
  },
  {
    id: 'frostline-pass:precision',
    kind: 'precision',
    regionId: 'frostline-pass',
    name: 'Whiteout Slalom',
    brief: 'Ten gates through the pines in thick fog',
    instructions:
      'Ten narrow gates in fog you can barely see through. Trust the marker, keep it smooth. Miss one or crash and the run is over.',
    conditions: { time: 'authored', weather: 'fog', windHeading: 0 },
    gates: [
      { after: 0, t: 0.4, lateral: 0, agl: 24, width: 22, height: 16 },
      { after: 0, t: 0.8, lateral: 12, agl: 22, width: 20, height: 15 },
      { after: 1, t: 0.35, lateral: -12, agl: 22, width: 20, height: 15 },
      { after: 1, t: 0.75, lateral: 10, agl: 22, width: 20, height: 15 },
      { after: 2, t: 0.35, lateral: -10, agl: 24, width: 20, height: 15 },
      { after: 2, t: 0.75, lateral: 0, agl: 24, width: 20, height: 15 },
      { after: 3, t: 0.4, lateral: 12, agl: 26, width: 20, height: 16 },
      { after: 3, t: 0.8, lateral: -12, agl: 26, width: 20, height: 16 },
      { after: 4, t: 0.4, lateral: 0, agl: 28, width: 20, height: 16 },
      { after: 4, t: 0.8, lateral: 0, agl: 30, width: 22, height: 16 },
    ],
    timeLimit: 85,
    medals: { silver: 55, gold: 70 },
  },
  freeFlight('frostline-pass', 'Frostline Pass', { time: 'authored', weather: 'breezy', windHeading: 2.2 }),

  // --- Coral Coast -----------------------------------------------------------------------------
  ...raceAndTrial('coral-coast', { gold: 94, silver: 101, bronze: 112 }, 'Coral'),
  {
    id: 'coral-coast:delivery',
    kind: 'delivery',
    regionId: 'coral-coast',
    name: 'Island Mail',
    brief: 'One bag from the buoy, two drops, a squall moving in',
    instructions:
      'Snatch the mailbag from the buoy (float planes can touch down on the water inside the ring), then drop at the Saddle village and South Cay. Rain cuts the view.',
    conditions: { time: 'authored', weather: 'rain', windHeading: -0.8 },
    cargo: { name: 'Mailbag', mass: 90, bankLimit: 55 },
    stops: [
      { name: 'Mail buoy', kind: 'pickup', after: 0, t: 0.55, water: true },
      { name: 'Saddle village', kind: 'drop', after: 4, t: 0.35 },
      { name: 'South Cay', kind: 'drop', after: 7, t: 0.5 },
    ],
    hookSpeedKmh: 200,
    hookHeight: 30,
    medals: { bronze: 170, silver: 85, gold: 68 },
    condition: { bronze: 30, silver: 60, gold: 80 },
  },
  {
    id: 'coral-coast:show',
    kind: 'show',
    regionId: 'coral-coast',
    name: 'Lighthouse Sunset Show',
    brief: 'Ninety seconds over the water at dusk',
    instructions:
      'An air show over the harbour as the sun goes down. Loops, rolls and inverted passes inside the pylons; figures low over the water pay a bonus.',
    conditions: { time: 'dusk', weather: 'clear', windHeading: 0 },
    box: { x: 300, z: 0, half: 340, ceiling: 480 },
    duration: 90,
    medals: { bronze: 3000, silver: 7500, gold: 13000 },
  },
  freeFlight('coral-coast', 'Coral Coast'),

  // --- Ember Mesa ------------------------------------------------------------------------------
  ...raceAndTrial('ember-mesa', { gold: 87, silver: 96, bronze: 106 }, 'Ember'),
  {
    id: 'ember-mesa:precision',
    kind: 'precision',
    regionId: 'ember-mesa',
    name: 'Arch Threader',
    brief: 'Under the Ember Arch and along the mesa walls',
    instructions:
      'Eleven narrow gates from the north bend, under the Ember Arch and down the shadowed run. Miss one or crash and the run is over.',
    conditions: { time: 'authored', weather: 'clear', windHeading: 0 },
    gates: [
      { after: 2, t: 0.5, lateral: 0, agl: 24, width: 22, height: 16 },
      { after: 3, t: 0.3, lateral: 12, agl: 22, width: 20, height: 15 },
      { after: 3, t: 0.7, lateral: -12, agl: 22, width: 20, height: 15 },
      { after: 4, t: 0.4, lateral: 0, agl: 22, width: 20, height: 15 },
      { after: 4, t: 0.85, lateral: 0, agl: 24, width: 18, height: 15 },
      { after: 5, t: 0.5, lateral: 0, agl: 26, width: 18, height: 15 },
      { after: 6, t: 0.5, lateral: 10, agl: 22, width: 20, height: 15 },
      { after: 7, t: 0.4, lateral: -12, agl: 22, width: 20, height: 15 },
      { after: 7, t: 0.8, lateral: 12, agl: 22, width: 20, height: 15 },
      { after: 8, t: 0.3, lateral: 0, agl: 26, width: 20, height: 16 },
      { after: 8, t: 0.6, lateral: 0, agl: 30, width: 22, height: 16 },
    ],
    timeLimit: 85,
    medals: { silver: 55, gold: 72 },
  },
  {
    id: 'ember-mesa:delivery',
    kind: 'delivery',
    regionId: 'ember-mesa',
    name: 'Mesa Freight',
    brief: 'A crate of engine parts, heavy enough to feel',
    instructions:
      'Hook a 420 kg crate of engine parts at the north bend and haul it over the mesa to the summit camp. It makes every aircraft sluggish and raises the stall speed.',
    conditions: { time: 'authored', weather: 'breezy', windHeading: 1.9 },
    cargo: { name: 'Engine parts', mass: 420, bankLimit: 60 },
    stops: [
      { name: 'North bend yard', kind: 'pickup', after: 1, t: 0.5 },
      { name: 'Summit camp', kind: 'drop', after: 8, t: 0.45 },
    ],
    hookSpeedKmh: 220,
    hookHeight: 40,
    medals: { bronze: 160, silver: 78, gold: 62 },
    condition: { bronze: 30, silver: 60, gold: 80 },
  },
  freeFlight('ember-mesa', 'Ember Mesa', { time: 'dusk', weather: 'clear', windHeading: 0 }),
];

export const DISCOVERIES: readonly DiscoverySpec[] = [
  // Caldera Ridge
  {
    id: 'caldera:comet',
    regionId: 'caldera-ridge',
    name: 'Wreck of the Silver Comet',
    hint: 'A mail plane went down on a mesa top east of the facility.',
    lore: 'The Comet flew the desert mail in ’31 until a dust storm put her down here. The pilot walked out.',
    kind: 'wreck',
    x: 1100,
    z: -200,
  },
  {
    id: 'caldera:sentinel',
    regionId: 'caldera-ridge',
    name: 'Sentinel Peak cairn',
    hint: 'Surveyors left a cairn on the highest summit to the south east.',
    lore: 'Every surveyor who reached the top added a stone. Somebody added a racing number.',
    kind: 'cairn',
    x: 1800,
    z: -600,
  },
  {
    id: 'caldera:cabin',
    regionId: 'caldera-ridge',
    name: 'Prospector’s cabin',
    hint: 'Someone lived out past the south ridge, a long way from water.',
    lore: 'Forty years of claims and not a single nugget. The tin roof still keeps the rain off.',
    kind: 'cabin',
    x: -900,
    z: -1300,
  },
  {
    id: 'caldera:smugglers',
    regionId: 'caldera-ridge',
    name: 'The Smugglers’ Line',
    hint: 'Old runners flew a ring line along the western ridge. Find the first ring.',
    lore: 'Low along the ridge, out of sight of the facility radar. You flew it clean.',
    kind: 'trail',
    x: -1500,
    z: 1300,
    to: { x: -1900, z: 400 },
  },
  {
    id: 'caldera:relay',
    regionId: 'caldera-ridge',
    name: 'Canyon radio relay',
    hint: 'A relay mast stands on the northern rim, far beyond the summit gate.',
    lore: 'It still hums. Nobody remembers who it was relaying to.',
    kind: 'beacon',
    x: 1200,
    z: 2200,
  },
  // Frostline Pass
  {
    id: 'frostline:cross',
    regionId: 'frostline-pass',
    name: 'Halden summit cross',
    hint: 'The highest peak in the range is far to the south. It has a cross on top.',
    lore: 'Climbers take three days to reach it. You took four minutes.',
    kind: 'cairn',
    x: -400,
    z: -2400,
  },
  {
    id: 'frostline:glider',
    regionId: 'frostline-pass',
    name: 'The lost glider',
    hint: 'A glider came down on a shelf north east of the station one winter.',
    lore: 'Its pilot rode the ridge lift for six hours before the light went. The wings are still white.',
    kind: 'wreck',
    x: 1200,
    z: 1400,
  },
  {
    id: 'frostline:hut',
    regionId: 'frostline-pass',
    name: 'Avalanche hut',
    hint: 'A refuge hut sits on a shoulder west of the climb.',
    lore: 'The logbook inside is full of weather and gratitude.',
    kind: 'cabin',
    x: -1300,
    z: 700,
  },
  {
    id: 'frostline:icegate',
    regionId: 'frostline-pass',
    name: 'The Ice Gate',
    hint: 'A ring line crosses the southern ridges. It starts near a lonely shoulder.',
    lore: 'The old mail route over the range, ridge to ridge. Few pilots fly it twice.',
    kind: 'trail',
    x: 300,
    z: -1900,
    to: { x: -600, z: -1500 },
  },
  {
    id: 'frostline:weather',
    regionId: 'frostline-pass',
    name: 'Weather station',
    hint: 'Somebody measures the wind on a hill north east of the station.',
    lore: 'Today’s reading: gusting forty. Underlined twice.',
    kind: 'beacon',
    x: 600,
    z: 900,
  },
  // Coral Coast
  {
    id: 'coral:margarethe',
    regionId: 'coral-coast',
    name: 'Wreck of the Margarethe',
    hint: 'A schooner ran aground on the reef far to the south east.',
    lore: 'She carried copra and a piano. Divers say the piano is still playable.',
    kind: 'shipwreck',
    x: 1700,
    z: -1400,
  },
  {
    id: 'coral:crater',
    regionId: 'coral-coast',
    name: 'Crater island beacon',
    hint: 'The tallest island to the west has a beacon on its rim.',
    lore: 'Lit every night for a hundred years by the same family.',
    kind: 'cairn',
    x: -1300,
    z: 500,
  },
  {
    id: 'coral:pearl',
    regionId: 'coral-coast',
    name: 'Pearl divers’ hut',
    hint: 'A hut stands on a hill on the far south eastern island.',
    lore: 'They dive at dawn and sleep through the heat. Fly quietly.',
    kind: 'cabin',
    x: 2600,
    z: -1300,
  },
  {
    id: 'coral:reef',
    regionId: 'coral-coast',
    name: 'The Reef Run',
    hint: 'A ring line runs low over the water north of the western islands.',
    lore: 'Flown at wave height, the way the island pilots learn.',
    kind: 'trail',
    x: -1400,
    z: 1300,
    to: { x: -500, z: 2000 },
  },
  {
    id: 'coral:buoy',
    regionId: 'coral-coast',
    name: 'Radio buoy',
    hint: 'A radio buoy bobs in open water to the north east.',
    lore: 'It reports the swell every hour to anyone listening. Mostly gulls.',
    kind: 'buoy',
    x: 2300,
    z: 1200,
  },
  // Ember Mesa
  {
    id: 'ember:cairn',
    regionId: 'ember-mesa',
    name: 'Red Shelf summit',
    hint: 'The highest mesa lies south west of the airfield.',
    lore: 'Flat as a table and twice as red. The view goes all the way to the sun.',
    kind: 'cairn',
    x: -400,
    z: -800,
  },
  {
    id: 'ember:barnstormer',
    regionId: 'ember-mesa',
    name: 'Burned-out barnstormer',
    hint: 'A barnstormer came down on a terrace east of the finish.',
    lore: 'He flew under the arch every Sunday for a year. On the last Sunday he didn’t.',
    kind: 'wreck',
    x: 1500,
    z: -400,
  },
  {
    id: 'ember:windmill',
    regionId: 'ember-mesa',
    name: 'Rancher’s windmill',
    hint: 'A windmill turns on the plain far to the north.',
    lore: 'The ranch is long gone. The windmill keeps pumping for the cattle that aren’t there.',
    kind: 'cabin',
    x: 200,
    z: 2300,
  },
  {
    id: 'ember:shelf',
    regionId: 'ember-mesa',
    name: 'The Red Shelf Line',
    hint: 'A ring line crosses the western mesas. It begins on a terrace due west.',
    lore: 'Mesa top to mesa top, never more than a wingspan over the rock.',
    kind: 'trail',
    x: -1400,
    z: 500,
    to: { x: -600, z: 0 },
  },
  {
    id: 'ember:observatory',
    regionId: 'ember-mesa',
    name: 'Observatory dome',
    hint: 'Astronomers chose the darkest mesa, far to the east.',
    lore: 'The dome opens at sunset. Tonight they are watching you.',
    kind: 'observatory',
    x: 2800,
    z: 200,
  },
];

const activityIndex = new Map(ACTIVITIES.map((activity) => [activity.id, activity]));
const discoveryIndex = new Map(DISCOVERIES.map((discovery) => [discovery.id, discovery]));

export const getActivity = (id: string): Activity | undefined => activityIndex.get(id);
export const isActivityId = (id: unknown): id is string => typeof id === 'string' && activityIndex.has(id);
export const getDiscovery = (id: string): DiscoverySpec | undefined => discoveryIndex.get(id);
export const isDiscoveryId = (id: unknown): id is string => typeof id === 'string' && discoveryIndex.has(id);

export const activitiesIn = (regionId: string): Activity[] =>
  ACTIVITIES.filter((activity) => activity.regionId === regionId);
export const discoveriesIn = (regionId: string): DiscoverySpec[] =>
  DISCOVERIES.filter((discovery) => discovery.regionId === regionId);

/** Activities that award medals (everything but the Grand Prix and free flight). */
export const MEDAL_ACTIVITIES = ACTIVITIES.filter(
  (activity) => activity.kind !== 'race' && activity.kind !== 'explore',
);
