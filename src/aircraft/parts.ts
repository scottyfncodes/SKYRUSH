/**
 * Aircraft catalogue: airframes (the aircraft you own) and the interchangeable
 * parts that bolt onto them.
 *
 * This file is the single source of truth. Every number here feeds the
 * performance model in `performance.ts`, every `visual` field feeds the
 * procedural model builder in `render/aircraft/`, and every `unlock`, `price`
 * and `requires` field feeds progression. Numbers are SI units unless noted.
 * See docs/FLIGHT_MODEL.md and docs/AIRCRAFT.md.
 */

/** Fuselage sections: every aircraft is a nose, a cabin and a tail boom. */
export type SectionCategory = 'nose' | 'cabin' | 'boom';
export type ComponentCategory = 'frame' | 'engine' | 'prop' | 'wings' | 'tail' | 'gear';
export type PartCategory = SectionCategory | ComponentCategory;

export const SECTION_CATEGORIES: readonly SectionCategory[] = ['nose', 'cabin', 'boom'];
export const COMPONENT_CATEGORIES: readonly ComponentCategory[] = [
  'frame',
  'engine',
  'prop',
  'wings',
  'tail',
  'gear',
];
export const PART_CATEGORIES: readonly PartCategory[] = [...SECTION_CATEGORIES, ...COMPONENT_CATEGORIES];

export const isSectionCategory = (category: PartCategory): category is SectionCategory =>
  category === 'nose' || category === 'cabin' || category === 'boom';

export type UnlockRule =
  | { kind: 'default' }
  | { kind: 'purchase' }
  | { kind: 'races'; count: number }
  | { kind: 'podium'; count: number }
  | { kind: 'wins'; count: number }
  | { kind: 'style'; score: number }
  /** Comes with an aircraft (sections): not sold on its own. */
  | { kind: 'airframe'; airframe: string }
  /** Comes with an aircraft, or can be won from a rival in a challenge race. */
  | { kind: 'rival'; airframe: string; rival: string }
  /** Licence stars from activity medals and discoveries (see progression/activities.ts). */
  | { kind: 'stars'; count: number };

/** Fields shared by everything the hangar sells. */
interface CatalogueItem {
  id: string;
  name: string;
  /** One line in the game's voice. */
  tagline: string;
  description: string;
  /** What the item is for, in two or three words. */
  role: string;
  /** Its strongest attribute. */
  strength: string;
  /** What it costs you in the air. */
  tradeoff: string;
  price: number;
  unlock: UnlockRule;
  /** Another item that must be owned first (an upgrade path). */
  requires?: string;
}

export type AirframeId =
  | 'airframe-scout'
  | 'airframe-sport'
  | 'airframe-racer'
  | 'airframe-bush'
  | 'airframe-seaplane'
  | 'airframe-cruiser'
  | 'airframe-stunt'
  | 'airframe-custom';

export type Archetype =
  | 'Scout'
  | 'Sport'
  | 'Racer'
  | 'Bush plane'
  | 'Seaplane'
  | 'Heavy cruiser'
  | 'Aerobatic'
  | 'Kitbash';

export interface Airframe extends CatalogueItem {
  id: AirframeId;
  kind: 'airframe';
  archetype: Archetype;
  /** Registration-style designation painted on the tail. */
  designation: string;
  visual: 'scout' | 'sport' | 'racer' | 'bush' | 'seaplane' | 'cruiser' | 'stunt' | 'custom';
  /** Empty structure mass before parts (kg). */
  mass: number;
  dragArea: number;
  pitchRate: number; // rad/s at full authority
  responsiveness: number; // how quickly rotation rates reach their target (1/s)
  stability: number; // auto-level and damping strength
  rollFactor: number; // multiplies wing roll rate
  coolingBonus: number; // added to engine cooling rate (per second)
  durability: number; // 1 = baseline scrape tolerance
  /** Linear wing scale: span and chord. Area, mass and drag of wings scale with its square. */
  wingScale: number;
  /** Stacked wings (2 for a biplane): each set adds its area, mass and drag. Default 1. */
  wingSets?: number;
  /** Parts each slot accepts. Anything else is explicitly incompatible. */
  accepts: Record<PartCategory, readonly string[]>;
  /** Factory parts, granted with the aircraft. */
  defaults: Record<PartCategory, string>;
}

export interface FramePart extends CatalogueItem {
  kind: 'part';
  category: 'frame';
  visual: 'standard' | 'light' | 'composite' | 'reinforced';
  /** Multiplies airframe structure mass. */
  massFactor: number;
  durability: number; // added
  stability: number; // added
  responsiveness: number; // multiplier
  /** What changes on the model. */
  look: string;
}

export interface EnginePart extends CatalogueItem {
  kind: 'part';
  category: 'engine';
  visual: {
    cowl: 'inline' | 'radial' | 'long' | 'pulse';
    /** Exhaust stacks per side. */
    stacks: number;
    /** Supercharger intake on top of the cowl. */
    scoop: boolean;
    /** Engines on wing nacelles instead of the nose. */
    twin: boolean;
    /** Oversized racing pods on outriggers (implies twin). */
    pod?: boolean;
  };
  mass: number; // total, both engines for a twin
  thrust: number; // N at full throttle at the reference airspeed
  boostMultiplier: number; // thrust multiplier while boosting
  dragArea: number;
  baseLoad: number; // heat equilibrium at full throttle without boost (0..1)
  boostLoad: number; // extra heat load while boosting (pushes equilibrium above 1)
  heatRate: number; // how quickly heat approaches the load when heating (1/s)
  coolRate: number; // how quickly heat approaches the load when cooling (1/s)
  boostCapacity: number; // seconds of continuous boost
  boostRechargeTime: number; // seconds from empty to full while not boosting
  /** Audio character for the procedural engine sound. */
  sound: EngineSound;
  look: string;
}

export interface EngineSound {
  base: number; // Hz at idle
  range: number; // Hz added at full throttle
  wave: OscillatorType;
  /** Second oscillator frequency ratio and wave. */
  ratio: number;
  wave2: OscillatorType;
  /** Amplitude modulation for lumpy radials and pulse engines (Hz, 0..1 depth). */
  lumpRate: number;
  lumpDepth: number;
}

export interface PropPart extends CatalogueItem {
  kind: 'part';
  category: 'prop';
  visual: {
    blades: number;
    diameter: number;
    chord: number;
    spinner: 'cone' | 'bullet' | 'dome';
    scimitar: boolean;
  };
  mass: number;
  dragArea: number;
  /** Overall thrust multiplier. */
  efficiency: number;
  /**
   * Thrust bias against airspeed: positive pulls harder at low speed (climb and
   * acceleration) and fades at high speed; negative trades low-speed pull for
   * top speed. Thrust = engine thrust × efficiency × (1 + bias × (1 − v / 100 m/s)).
   */
  bias: number;
  look: string;
}

export interface WingPart extends CatalogueItem {
  kind: 'part';
  category: 'wings';
  visual: {
    planform: 'clipped' | 'tapered' | 'elliptic' | 'plank' | 'glider';
    span: number; // half span at wing scale 1 (m)
    rootChord: number;
    tipChord: number;
    sweep: number; // leading edge set-back at the tip (m)
    dihedral: number; // radians
    tip: 'square' | 'raked' | 'round' | 'winglet' | 'endplate';
  };
  mass: number;
  dragArea: number;
  liftArea: number; // controls stall speed
  rollRate: number; // rad/s
  grip: number; // velocity alignment rate at reference speed (rad/s)
  gripExponent: number; // how strongly grip falls off with speed
  stability: number; // added
  look: string;
}

export interface TailPart extends CatalogueItem {
  kind: 'part';
  category: 'tail';
  visual: 'standard' | 'twin' | 'big' | 'vee';
  mass: number;
  dragArea: number;
  stability: number; // added
  pitchFactor: number;
  yawFactor: number;
  responsiveness: number; // multiplier
  look: string;
}

export interface GearPart extends CatalogueItem {
  kind: 'part';
  category: 'gear';
  visual: 'spats' | 'tundra' | 'retract' | 'floats';
  mass: number;
  dragArea: number;
  durability: number; // added: scrape tolerance on terrain and water
  look: string;
}

export interface SectionPart extends CatalogueItem {
  kind: 'part';
  category: SectionCategory;
  /** The aircraft this section comes from; its shape and handling share come with it. */
  source: AirframeId;
  look: string;
}

export type AircraftPart = SectionPart | FramePart | EnginePart | PropPart | WingPart | TailPart | GearPart;
export type ShopItem = Airframe | AircraftPart;

// --- Parts ------------------------------------------------------------------------------

export const FRAMES: readonly FramePart[] = [
  {
    id: 'frame-standard',
    kind: 'part',
    category: 'frame',
    name: 'Factory Frame',
    tagline: 'Riveted aluminium, as the drawings intended.',
    description:
      'Stressed-skin aluminium over spruce formers. The reference every other frame is measured against.',
    role: 'Baseline',
    strength: 'No compromises',
    tradeoff: 'No advantages either',
    price: 0,
    unlock: { kind: 'default' },
    visual: 'standard',
    massFactor: 1,
    durability: 0,
    stability: 0,
    responsiveness: 1,
    look: 'Painted panels with flush rivet lines',
  },
  {
    id: 'frame-light',
    kind: 'part',
    category: 'frame',
    name: 'Fabric Lightweight',
    tagline: 'Doped linen over a welded tube.',
    description:
      'The rear fuselage is reskinned in doped fabric. The aircraft feels eager in every axis, and it has less to give when you touch the ground.',
    role: 'Agility',
    strength: 'Quicker response, lower mass',
    tradeoff: 'Less stable, scrapes hurt more',
    price: 1400,
    unlock: { kind: 'purchase' },
    visual: 'light',
    massFactor: 0.86,
    durability: -0.18,
    stability: -0.08,
    responsiveness: 1.06,
    look: 'Fabric rear fuselage with visible rib tapes',
  },
  {
    id: 'frame-composite',
    kind: 'part',
    category: 'frame',
    name: 'Composite Shell',
    tagline: 'Lighter than fabric, tougher than tin.',
    description:
      'A laid-up carbon and glass monocoque. It keeps the lightweight frame’s response and wins back most of the strength.',
    role: 'Agility',
    strength: 'Lightest frame, still tough',
    tradeoff: 'The most expensive frame',
    price: 3000,
    unlock: { kind: 'races', count: 4 },
    requires: 'frame-light',
    visual: 'composite',
    massFactor: 0.8,
    durability: -0.04,
    stability: -0.03,
    responsiveness: 1.08,
    look: 'Clear-coated weave panels and a bare carbon spine',
  },
  {
    id: 'frame-reinforced',
    kind: 'part',
    category: 'frame',
    name: 'Reinforced Frame',
    tagline: 'Doubled stringers. Lands on anything.',
    description:
      'Extra longerons, belly doublers and a riveted keel plate. The aircraft settles into a line and shrugs off a scrape, but it is heavier to throw around.',
    role: 'Stability',
    strength: 'Steadier and tougher',
    tradeoff: 'Heavier, slower to respond',
    price: 1500,
    unlock: { kind: 'races', count: 1 },
    visual: 'reinforced',
    massFactor: 1.12,
    durability: 0.32,
    stability: 0.12,
    responsiveness: 0.95,
    look: 'Exposed rivet rows and a steel keel plate',
  },
];

const RADIAL_SOUND: EngineSound = {
  base: 46,
  range: 70,
  wave: 'square',
  ratio: 1.5,
  wave2: 'sawtooth',
  lumpRate: 11,
  lumpDepth: 0.35,
};

export const ENGINES: readonly EnginePart[] = [
  {
    id: 'engine-efficient',
    kind: 'part',
    category: 'engine',
    name: 'Kestrel Inline',
    tagline: 'Smooth, cool and patient.',
    description:
      'A liquid-cooled inline six under a long pointed cowl. It never wins a drag race but it rarely overheats and always has boost in reserve.',
    role: 'All-rounder',
    strength: 'Cool running, long boost',
    tradeoff: 'Modest thrust',
    price: 0,
    unlock: { kind: 'default' },
    visual: { cowl: 'inline', stacks: 3, scoop: false, twin: false },
    mass: 300,
    thrust: 9000,
    boostMultiplier: 1.45,
    dragArea: 0.12,
    baseLoad: 0.35,
    boostLoad: 0.95,
    heatRate: 0.14,
    coolRate: 0.16,
    boostCapacity: 5.5,
    boostRechargeTime: 14,
    sound: { base: 58, range: 95, wave: 'sawtooth', ratio: 2.01, wave2: 'square', lumpRate: 0, lumpDepth: 0 },
    look: 'Pointed cowl, three exhaust stacks a side',
  },
  {
    id: 'engine-tuned',
    kind: 'part',
    category: 'engine',
    name: 'Kestrel Sport',
    tagline: 'Same block, sharper cams.',
    description:
      'The Kestrel with raised compression, ported heads and a freer exhaust. More pull everywhere, a little more heat.',
    role: 'Speed',
    strength: 'More thrust than the Kestrel',
    tradeoff: 'Runs warmer, shorter boost',
    price: 1800,
    unlock: { kind: 'purchase' },
    requires: 'engine-efficient',
    visual: { cowl: 'inline', stacks: 6, scoop: false, twin: false },
    mass: 320,
    thrust: 10100,
    boostMultiplier: 1.45,
    dragArea: 0.12,
    baseLoad: 0.42,
    boostLoad: 0.98,
    heatRate: 0.16,
    coolRate: 0.15,
    boostCapacity: 5,
    boostRechargeTime: 14,
    sound: {
      base: 64,
      range: 110,
      wave: 'sawtooth',
      ratio: 2.02,
      wave2: 'square',
      lumpRate: 0,
      lumpDepth: 0,
    },
    look: 'Six short ejector stacks a side',
  },
  {
    id: 'engine-hornet',
    kind: 'part',
    category: 'engine',
    name: 'Hornet Supercharged',
    tagline: 'A blower on top and nothing held back.',
    description:
      'A gear-driven supercharger force-feeds the Kestrel block. Huge thrust and a harder boost, paid for in heat and a short boost window.',
    role: 'Speed',
    strength: 'Highest single-engine thrust',
    tradeoff: 'Hot, heavy, short boost',
    price: 3200,
    unlock: { kind: 'races', count: 3 },
    requires: 'engine-tuned',
    visual: { cowl: 'inline', stacks: 6, scoop: true, twin: false },
    mass: 380,
    thrust: 11700,
    boostMultiplier: 1.55,
    dragArea: 0.14,
    baseLoad: 0.55,
    boostLoad: 1.08,
    heatRate: 0.22,
    coolRate: 0.13,
    boostCapacity: 4.4,
    boostRechargeTime: 15,
    sound: {
      base: 70,
      range: 128,
      wave: 'sawtooth',
      ratio: 3.02,
      wave2: 'triangle',
      lumpRate: 0,
      lumpDepth: 0,
    },
    look: 'Supercharger scoop on the cowl, six stacks a side',
  },
  {
    id: 'engine-albatross',
    kind: 'part',
    category: 'engine',
    name: 'Albatross Long-Range',
    tagline: 'Leaned out for the long haul.',
    description:
      'Detuned for economy with flame dampers on the exhausts. Less peak pull, but it barely warms up and the boost reserve refills fast.',
    role: 'Endurance',
    strength: 'Longest, fastest-refilling boost',
    tradeoff: 'Lowest peak thrust of the Kestrel line',
    price: 1900,
    unlock: { kind: 'purchase' },
    requires: 'engine-efficient',
    visual: { cowl: 'long', stacks: 1, scoop: false, twin: false },
    mass: 290,
    thrust: 8500,
    boostMultiplier: 1.42,
    dragArea: 0.12,
    baseLoad: 0.25,
    boostLoad: 0.85,
    heatRate: 0.1,
    coolRate: 0.22,
    boostCapacity: 7,
    boostRechargeTime: 10,
    sound: { base: 52, range: 80, wave: 'sawtooth', ratio: 2, wave2: 'sine', lumpRate: 0, lumpDepth: 0 },
    look: 'Long cowl with flame-damper pipes along the flanks',
  },
  {
    id: 'engine-wasp',
    kind: 'part',
    category: 'engine',
    name: 'Wasp Radial',
    tagline: 'Five cylinders, all of them showing.',
    description:
      'A small air-cooled radial with its cylinder heads out in the breeze. Light enough to make a small aircraft dance, short of breath on the straights.',
    role: 'Agility',
    strength: 'Very light, spools fast',
    tradeoff: 'Least thrust',
    price: 1300,
    unlock: { kind: 'purchase' },
    visual: { cowl: 'radial', stacks: 0, scoop: false, twin: false },
    mass: 180,
    thrust: 7400,
    boostMultiplier: 1.5,
    dragArea: 0.1,
    baseLoad: 0.3,
    boostLoad: 0.92,
    heatRate: 0.15,
    coolRate: 0.2,
    boostCapacity: 5,
    boostRechargeTime: 12,
    sound: RADIAL_SOUND,
    look: 'Ring cowl with exposed cylinder heads',
  },
  {
    id: 'engine-twin',
    kind: 'part',
    category: 'engine',
    name: 'Tandem Twin',
    tagline: 'Two engines. Twice the argument.',
    description:
      'A pair of inline engines on wing nacelles. Enormous thrust and top speed, but the extra mass blunts turn-in and the heat builds fast under boost.',
    role: 'Speed',
    strength: 'Most thrust in the hangar',
    tradeoff: 'Heavy, heats quickly',
    price: 2600,
    unlock: { kind: 'races', count: 1 },
    visual: { cowl: 'inline', stacks: 3, scoop: false, twin: true },
    mass: 560,
    thrust: 12800,
    boostMultiplier: 1.5,
    dragArea: 0.27,
    baseLoad: 0.6,
    boostLoad: 1.0,
    heatRate: 0.2,
    coolRate: 0.12,
    boostCapacity: 4.5,
    boostRechargeTime: 16,
    sound: {
      base: 55,
      range: 92,
      wave: 'sawtooth',
      ratio: 1.012,
      wave2: 'sawtooth',
      lumpRate: 1.6,
      lumpDepth: 0.18,
    },
    look: 'Two nacelles on the wings and a faired nose',
  },
  {
    id: 'engine-pulse',
    kind: 'part',
    category: 'engine',
    name: 'Vantage Pulse Drive',
    tagline: 'Experimental. Explosive. Short-lived.',
    description:
      'A pulsed-combustion prototype behind a ducted prop. Boost hits like a hammer and heat soars with it. Short boost windows reward timing over brute force.',
    role: 'Boost',
    strength: 'Strongest boost by far',
    tradeoff: 'Very hot, very short boost',
    price: 3400,
    unlock: { kind: 'podium', count: 1 },
    visual: { cowl: 'pulse', stacks: 2, scoop: false, twin: false },
    mass: 420,
    thrust: 11000,
    boostMultiplier: 1.95,
    dragArea: 0.17,
    baseLoad: 0.5,
    boostLoad: 1.4,
    heatRate: 0.25,
    coolRate: 0.13,
    boostCapacity: 3.2,
    boostRechargeTime: 11,
    sound: {
      base: 62,
      range: 100,
      wave: 'square',
      ratio: 2.5,
      wave2: 'sawtooth',
      lumpRate: 18,
      lumpDepth: 0.5,
    },
    look: 'Banded cowl and two glowing combustor cans',
  },
  {
    id: 'engine-pod',
    kind: 'part',
    category: 'engine',
    name: 'Thunderpod Twin',
    tagline: 'Two engines with an aircraft hanging between them.',
    description:
      'Oversized racing pods on outriggers, each nearly as long as the cabin. Brutal pull and a terrifying top end. They run hot, they weigh a ton, and they blow up if you lean on them.',
    role: 'Speed',
    strength: 'The biggest thrust you can fit',
    tradeoff: 'Very heavy, runs hot, slow to turn',
    price: 4600,
    unlock: { kind: 'wins', count: 2 },
    visual: { cowl: 'inline', stacks: 4, scoop: true, twin: true, pod: true },
    mass: 860,
    thrust: 16500,
    boostMultiplier: 1.62,
    dragArea: 0.44,
    baseLoad: 0.64,
    boostLoad: 1.22,
    heatRate: 0.24,
    coolRate: 0.12,
    boostCapacity: 4,
    boostRechargeTime: 15,
    sound: {
      base: 38,
      range: 78,
      wave: 'sawtooth',
      ratio: 1.49,
      wave2: 'square',
      lumpRate: 6,
      lumpDepth: 0.32,
    },
    look: 'Two huge pods on outriggers with intake scoops',
  },
];

export const PROPS: readonly PropPart[] = [
  {
    id: 'prop-three',
    kind: 'part',
    category: 'prop',
    name: 'Standard Three-Blade',
    tagline: 'Fixed pitch, fair everywhere.',
    description: 'A three-blade metal propeller pitched for the middle of the speed range.',
    role: 'Baseline',
    strength: 'Even pull at every speed',
    tradeoff: 'No specialism',
    price: 0,
    unlock: { kind: 'default' },
    visual: { blades: 3, diameter: 2.3, chord: 0.2, spinner: 'cone', scimitar: false },
    mass: 40,
    dragArea: 0.03,
    efficiency: 1,
    bias: 0,
    look: 'Three blades and a cone spinner',
  },
  {
    id: 'prop-two',
    kind: 'part',
    category: 'prop',
    name: 'Coarse Two-Blade',
    tagline: 'Pitched for the straightaway.',
    description:
      'Two long, coarse-pitch blades. It bites late off the line and keeps pulling where the others run out of pitch.',
    role: 'Speed',
    strength: 'Higher top speed',
    tradeoff: 'Slower acceleration and climb',
    price: 900,
    unlock: { kind: 'purchase' },
    visual: { blades: 2, diameter: 2.4, chord: 0.18, spinner: 'cone', scimitar: false },
    mass: 30,
    dragArea: 0.02,
    efficiency: 1,
    bias: -0.14,
    look: 'Two long blades',
  },
  {
    id: 'prop-scimitar',
    kind: 'part',
    category: 'prop',
    name: 'Scimitar Racing',
    tagline: 'Swept tips for the last few km/h.',
    description:
      'Swept, thin-section racing blades behind a bullet spinner. The fastest propeller in the hangar once it is wound up.',
    role: 'Speed',
    strength: 'Best top speed',
    tradeoff: 'Weakest low-speed pull',
    price: 2200,
    unlock: { kind: 'style', score: 3000 },
    requires: 'prop-two',
    visual: { blades: 3, diameter: 2.3, chord: 0.17, spinner: 'bullet', scimitar: true },
    mass: 34,
    dragArea: 0.02,
    efficiency: 1.04,
    bias: -0.2,
    look: 'Swept scimitar blades and a bullet spinner',
  },
  {
    id: 'prop-four',
    kind: 'part',
    category: 'prop',
    name: 'Four-Blade Climber',
    tagline: 'More blade, more bite.',
    description:
      'Four wide blades on a broad hub. It hauls the aircraft off a slow corner and up a ridge, then runs out of pitch near the top.',
    role: 'Climb',
    strength: 'Strong acceleration and climb',
    tradeoff: 'Lower top speed',
    price: 1000,
    unlock: { kind: 'purchase' },
    visual: { blades: 4, diameter: 2.2, chord: 0.22, spinner: 'dome', scimitar: false },
    mass: 52,
    dragArea: 0.04,
    efficiency: 1,
    bias: 0.24,
    look: 'Four wide blades and a dome spinner',
  },
  {
    id: 'prop-paddle',
    kind: 'part',
    category: 'prop',
    name: 'Wide Paddle',
    tagline: 'Built for short strips and heavy loads.',
    description:
      'Big-diameter paddle blades made for pulling a loaded aircraft out of a tight valley. Unmatched at low speed and unhappy at high speed.',
    role: 'Climb',
    strength: 'Most low-speed pull',
    tradeoff: 'Lowest top speed',
    price: 1300,
    unlock: { kind: 'races', count: 2 },
    requires: 'prop-four',
    visual: { blades: 3, diameter: 2.7, chord: 0.3, spinner: 'dome', scimitar: false },
    mass: 58,
    dragArea: 0.05,
    efficiency: 0.98,
    bias: 0.4,
    look: 'Large paddle blades',
  },
];

export const WINGS: readonly WingPart[] = [
  {
    id: 'wings-balanced',
    kind: 'part',
    category: 'wings',
    name: 'Crescent Tapered',
    tagline: 'Honest handling.',
    description:
      'A moderately tapered wing with conventional ailerons. Nothing exceptional, nothing to apologise for.',
    role: 'Baseline',
    strength: 'Predictable at every speed',
    tradeoff: 'No specialism',
    price: 0,
    unlock: { kind: 'default' },
    visual: {
      planform: 'tapered',
      span: 5.1,
      rootChord: 1.9,
      tipChord: 1.05,
      sweep: 0.35,
      dihedral: 0.07,
      tip: 'raked',
    },
    mass: 170,
    dragArea: 0.45,
    liftArea: 13,
    rollRate: 2.4,
    grip: 1.4,
    gripExponent: 1.0,
    stability: 0,
    look: 'Tapered wing with raked tips',
  },
  {
    id: 'wings-compact',
    kind: 'part',
    category: 'wings',
    name: 'Razor Clipped',
    tagline: 'Snap rolls, thin margins.',
    description:
      'Short clipped wings with oversized ailerons. Roll response is instant and drag is low, but the stall speed climbs and slow corners get loose.',
    role: 'Racing',
    strength: 'Fast roll, low drag',
    tradeoff: 'High stall speed',
    price: 1500,
    unlock: { kind: 'purchase' },
    visual: {
      planform: 'clipped',
      span: 3.9,
      rootChord: 1.8,
      tipChord: 1.15,
      sweep: 0.15,
      dihedral: 0.04,
      tip: 'square',
    },
    mass: 120,
    dragArea: 0.33,
    liftArea: 9,
    rollRate: 3.2,
    grip: 1.55,
    gripExponent: 0.85,
    stability: -0.15,
    look: 'Short span with square clipped tips',
  },
  {
    id: 'wings-elliptic',
    kind: 'part',
    category: 'wings',
    name: 'Swallow Elliptical',
    tagline: 'The wing everybody draws.',
    description:
      'A hand-faired elliptical planform. Lower drag than the Crescent and better grip through fast corners, without giving up the low-speed manners.',
    role: 'Refined',
    strength: 'Low drag with good grip',
    tradeoff: 'Expensive, slightly less stable',
    price: 2400,
    unlock: { kind: 'races', count: 2 },
    requires: 'wings-balanced',
    visual: {
      planform: 'elliptic',
      span: 5.2,
      rootChord: 2.1,
      tipChord: 0.2,
      sweep: 0.25,
      dihedral: 0.08,
      tip: 'round',
    },
    mass: 165,
    dragArea: 0.39,
    liftArea: 13.5,
    rollRate: 2.7,
    grip: 1.5,
    gripExponent: 0.95,
    stability: -0.04,
    look: 'Elliptical outline with rounded tips',
  },
  {
    id: 'wings-highlift',
    kind: 'part',
    category: 'wings',
    name: 'Condor High-Lift',
    tagline: 'Slow corners, strong grip.',
    description:
      'A long, cambered plank with full-span flaps. It stays controllable at very low speeds and settles into tight lines, at the cost of drag on the straights.',
    role: 'Low speed',
    strength: 'Lowest stall speed, very stable',
    tradeoff: 'Draggy on the straights',
    price: 1700,
    unlock: { kind: 'purchase' },
    visual: {
      planform: 'plank',
      span: 6.2,
      rootChord: 1.85,
      tipChord: 1.6,
      sweep: 0.05,
      dihedral: 0.05,
      tip: 'endplate',
    },
    mass: 230,
    dragArea: 0.58,
    liftArea: 18,
    rollRate: 1.9,
    grip: 1.3,
    gripExponent: 1.25,
    stability: 0.3,
    look: 'Long constant-chord wing with flap tracks and end plates',
  },
  {
    id: 'wings-glider',
    kind: 'part',
    category: 'wings',
    name: 'Kite Long-Span',
    tagline: 'All the wing you can carry.',
    description:
      'A slender high-aspect wing borrowed from a sailplane. Huge lift and calm manners, and it holds energy on a long descent, but it rolls like a barn door.',
    role: 'Endurance',
    strength: 'Most lift, holds energy',
    tradeoff: 'Slow roll, heavy',
    price: 2600,
    unlock: { kind: 'races', count: 3 },
    requires: 'wings-highlift',
    visual: {
      planform: 'glider',
      span: 7.6,
      rootChord: 1.65,
      tipChord: 0.7,
      sweep: 0.2,
      dihedral: 0.09,
      tip: 'winglet',
    },
    mass: 250,
    dragArea: 0.5,
    liftArea: 21,
    rollRate: 1.6,
    grip: 1.32,
    gripExponent: 1.3,
    stability: 0.42,
    look: 'Very long tapered wing with upturned winglets',
  },
];

export const TAILS: readonly TailPart[] = [
  {
    id: 'tail-standard',
    kind: 'part',
    category: 'tail',
    name: 'Conventional Tail',
    tagline: 'One fin, two stabilisers.',
    description: 'A conventional fin and tailplane with fabric-covered rudder and elevators.',
    role: 'Baseline',
    strength: 'Balanced pitch and yaw',
    tradeoff: 'No specialism',
    price: 0,
    unlock: { kind: 'default' },
    visual: 'standard',
    mass: 60,
    dragArea: 0.1,
    stability: 0.15,
    pitchFactor: 1,
    yawFactor: 1,
    responsiveness: 1,
    look: 'Single fin with a rounded rudder',
  },
  {
    id: 'tail-big',
    kind: 'part',
    category: 'tail',
    name: 'Steady Stabiliser',
    tagline: 'More tail, more calm.',
    description:
      'An oversized tailplane and fin. The aircraft points where you left it and recovers on its own.',
    role: 'Stability',
    strength: 'Much more stable',
    tradeoff: 'Less nimble in pitch',
    price: 900,
    unlock: { kind: 'purchase' },
    visual: 'big',
    mass: 76,
    dragArea: 0.13,
    stability: 0.42,
    pitchFactor: 0.94,
    yawFactor: 1.05,
    responsiveness: 0.92,
    look: 'Tall fin and broad tailplane',
  },
  {
    id: 'tail-twin',
    kind: 'part',
    category: 'tail',
    name: 'Twin Fin',
    tagline: 'Two rudders in clean air.',
    description:
      'End-plate fins at the tips of the tailplane. Better yaw authority and stability for big aircraft, a little more drag.',
    role: 'Stability',
    strength: 'Stable with strong yaw',
    tradeoff: 'More drag and mass',
    price: 1200,
    unlock: { kind: 'purchase' },
    visual: 'twin',
    mass: 82,
    dragArea: 0.14,
    stability: 0.28,
    pitchFactor: 1,
    yawFactor: 1.15,
    responsiveness: 0.98,
    look: 'Two oval end-plate fins',
  },
  {
    id: 'tail-vee',
    kind: 'part',
    category: 'tail',
    name: 'Butterfly V-Tail',
    tagline: 'Two surfaces doing the work of three.',
    description:
      'Ruddervators in a V. Less drag and a sharper pitch response, with almost none of the conventional tail’s self-levelling.',
    role: 'Performance',
    strength: 'Low drag, sharp pitch',
    tradeoff: 'Barely self-levels',
    price: 1600,
    unlock: { kind: 'races', count: 2 },
    visual: 'vee',
    mass: 50,
    dragArea: 0.07,
    stability: 0,
    pitchFactor: 1.07,
    yawFactor: 0.95,
    responsiveness: 1.08,
    look: 'Two angled tail surfaces, no fin',
  },
];

export const GEARS: readonly GearPart[] = [
  {
    id: 'gear-light',
    kind: 'part',
    category: 'gear',
    name: 'Spatted Wheels',
    tagline: 'Wheel pants and a tailwheel.',
    description: 'Fixed main wheels in streamlined spats. Light and tidy.',
    role: 'Baseline',
    strength: 'Light, modest drag',
    tradeoff: 'No extra toughness',
    price: 0,
    unlock: { kind: 'default' },
    visual: 'spats',
    mass: 120,
    dragArea: 0.1,
    durability: 0,
    look: 'Streamlined wheel spats',
  },
  {
    id: 'gear-tundra',
    kind: 'part',
    category: 'gear',
    name: 'Tundra Tyres',
    tagline: 'Soft rubber for hard landings.',
    description:
      'Big low-pressure tyres on spring-steel legs. Skimming the ground stops being a disaster, and the drag is the price.',
    role: 'Toughness',
    strength: 'Survives harder ground contact',
    tradeoff: 'More drag',
    price: 800,
    unlock: { kind: 'purchase' },
    visual: 'tundra',
    mass: 150,
    dragArea: 0.18,
    durability: 0.3,
    look: 'Oversized balloon tyres on bent legs',
  },
  {
    id: 'gear-retract',
    kind: 'part',
    category: 'gear',
    name: 'Retractable Gear',
    tagline: 'Folds away after take-off.',
    description:
      'Hydraulic legs that fold into the wings once airborne. The cleanest airframe you can have, and the heaviest wheels to carry.',
    role: 'Speed',
    strength: 'Almost no drag in flight',
    tradeoff: 'Heavier, a little fragile',
    price: 2000,
    unlock: { kind: 'races', count: 2 },
    visual: 'retract',
    mass: 150,
    dragArea: 0.02,
    durability: -0.06,
    look: 'Legs and doors that fold into the wings in flight',
  },
  {
    id: 'gear-floats',
    kind: 'part',
    category: 'gear',
    name: 'Twin Floats',
    tagline: 'Plants you on the water, not in it.',
    description:
      'A pair of stepped floats on N-struts. Skimming water or sand becomes a bounce rather than a crash, and they are the draggiest thing you can bolt on.',
    role: 'Toughness',
    strength: 'Toughest against water and ground',
    tradeoff: 'Heavy and very draggy',
    price: 1200,
    unlock: { kind: 'races', count: 1 },
    visual: 'floats',
    mass: 230,
    dragArea: 0.3,
    durability: 0.38,
    look: 'Two stepped floats on struts',
  },
];

// --- Airframes -------------------------------------------------------------------------

const ALL_FRAMES = ['frame-standard', 'frame-light', 'frame-composite', 'frame-reinforced'] as const;
const SINGLE_ENGINES = [
  'engine-efficient',
  'engine-tuned',
  'engine-hornet',
  'engine-albatross',
  'engine-wasp',
] as const;
const ALL_PROPS = ['prop-three', 'prop-two', 'prop-scimitar', 'prop-four', 'prop-paddle'] as const;

/** An airframe as authored: its sections are generated below. */
type AirframeSpec = Omit<Airframe, 'accepts' | 'defaults'> & {
  accepts: Record<ComponentCategory, readonly string[]>;
  defaults: Record<ComponentCategory, string>;
};

const TWIN_ENGINES = ['engine-twin', 'engine-pod'] as const;

const STOCK_AIRFRAMES: readonly AirframeSpec[] = [
  {
    id: 'airframe-sport',
    kind: 'airframe',
    archetype: 'Sport',
    designation: 'M-2',
    name: 'Meridian',
    tagline: 'The one everybody learns on, and keeps.',
    description:
      'A low-wing two-seater with a bubble canopy and a forgiving temper. Fast enough to win, steady enough to enjoy, and it takes almost any part in the hangar.',
    role: 'Balanced all-rounder',
    strength: 'Takes the widest range of parts',
    tradeoff: 'Never the best at one thing',
    price: 0,
    unlock: { kind: 'default' },
    visual: 'sport',
    mass: 680,
    dragArea: 0.55,
    pitchRate: 1.3,
    responsiveness: 7,
    stability: 0.85,
    rollFactor: 1,
    coolingBonus: 0,
    durability: 1,
    wingScale: 1,
    accepts: {
      frame: ALL_FRAMES,
      engine: [...SINGLE_ENGINES, ...TWIN_ENGINES, 'engine-pulse'],
      prop: ALL_PROPS,
      wings: ['wings-balanced', 'wings-compact', 'wings-elliptic', 'wings-highlift'],
      tail: ['tail-standard', 'tail-big', 'tail-twin', 'tail-vee'],
      gear: ['gear-light', 'gear-tundra', 'gear-retract'],
    },
    defaults: {
      frame: 'frame-standard',
      engine: 'engine-efficient',
      prop: 'prop-three',
      wings: 'wings-balanced',
      tail: 'tail-standard',
      gear: 'gear-light',
    },
  },
  {
    id: 'airframe-scout',
    kind: 'airframe',
    archetype: 'Scout',
    designation: 'S-1',
    name: 'Wren',
    tagline: 'Small enough to turn inside a gate.',
    description:
      'A stubby single-seater built around a radial and a bubble canopy. It changes direction the moment you think about it, and runs short of breath on long straights.',
    role: 'Tight turns',
    strength: 'Quickest response in the hangar',
    tradeoff: 'Light, twitchy, modest top speed',
    price: 1800,
    unlock: { kind: 'purchase' },
    visual: 'scout',
    mass: 430,
    dragArea: 0.42,
    pitchRate: 1.62,
    responsiveness: 9.5,
    stability: 0.62,
    rollFactor: 1.18,
    coolingBonus: 0.01,
    durability: 0.7,
    wingScale: 0.8,
    accepts: {
      frame: ALL_FRAMES,
      engine: [...SINGLE_ENGINES, 'engine-pulse'],
      prop: ['prop-three', 'prop-two', 'prop-scimitar', 'prop-four'],
      wings: ['wings-balanced', 'wings-compact', 'wings-elliptic'],
      tail: ['tail-standard', 'tail-big', 'tail-vee'],
      gear: ['gear-light', 'gear-tundra'],
    },
    defaults: {
      frame: 'frame-standard',
      engine: 'engine-wasp',
      prop: 'prop-two',
      wings: 'wings-compact',
      tail: 'tail-standard',
      gear: 'gear-light',
    },
  },
  {
    id: 'airframe-racer',
    kind: 'airframe',
    archetype: 'Racer',
    designation: 'R-7',
    name: 'Needle',
    tagline: 'All nose, all momentum.',
    description:
      'A long-nosed pylon racer with the cockpit pushed back to the tail and a belly radiator scoop. It carries speed through everything and pays for every mistake.',
    role: 'Speed and momentum',
    strength: 'Lowest drag of any airframe',
    tradeoff: 'Fragile and nervous',
    price: 3200,
    unlock: { kind: 'podium', count: 1 },
    visual: 'racer',
    mass: 560,
    dragArea: 0.42,
    pitchRate: 1.35,
    responsiveness: 7.5,
    stability: 0.6,
    rollFactor: 1.0,
    coolingBonus: -0.01,
    durability: 0.6,
    wingScale: 0.92,
    accepts: {
      frame: ALL_FRAMES,
      engine: [...SINGLE_ENGINES, 'engine-pulse'],
      prop: ['prop-three', 'prop-two', 'prop-scimitar'],
      wings: ['wings-balanced', 'wings-compact', 'wings-elliptic'],
      tail: ['tail-standard', 'tail-vee'],
      gear: ['gear-light', 'gear-retract'],
    },
    defaults: {
      frame: 'frame-standard',
      engine: 'engine-efficient',
      prop: 'prop-two',
      wings: 'wings-compact',
      tail: 'tail-vee',
      gear: 'gear-retract',
    },
  },
  {
    id: 'airframe-bush',
    kind: 'airframe',
    archetype: 'Bush plane',
    designation: 'B-4',
    name: 'Mule',
    tagline: 'Goes where the runway isn’t.',
    description:
      'A boxy high-wing cabin on braced struts and balloon tyres. It hangs in the air at walking pace and bounces off the ground that would end anyone else’s race.',
    role: 'Slow, forgiving flight',
    strength: 'Toughest and most forgiving',
    tradeoff: 'Draggy, slow on the straights',
    price: 2200,
    unlock: { kind: 'races', count: 1 },
    visual: 'bush',
    mass: 740,
    dragArea: 0.66,
    pitchRate: 1.25,
    responsiveness: 6.5,
    stability: 1,
    rollFactor: 0.95,
    coolingBonus: 0.02,
    durability: 1.3,
    wingScale: 1.06,
    accepts: {
      frame: ALL_FRAMES,
      engine: [...SINGLE_ENGINES, ...TWIN_ENGINES],
      prop: ['prop-three', 'prop-two', 'prop-four', 'prop-paddle'],
      wings: ['wings-balanced', 'wings-highlift', 'wings-glider'],
      tail: ['tail-standard', 'tail-big', 'tail-twin'],
      gear: ['gear-light', 'gear-tundra', 'gear-floats'],
    },
    defaults: {
      frame: 'frame-standard',
      engine: 'engine-efficient',
      prop: 'prop-four',
      wings: 'wings-highlift',
      tail: 'tail-big',
      gear: 'gear-tundra',
    },
  },
  {
    id: 'airframe-seaplane',
    kind: 'airframe',
    archetype: 'Seaplane',
    designation: 'P-3',
    name: 'Petrel',
    tagline: 'Engine up high, floats down low.',
    description:
      'A parasol-wing floatplane with its engine on a pylon above the wing. Water and sand are where it is happiest, and it rides out contact that would wreck a landplane.',
    role: 'Low and over water',
    strength: 'Shrugs off water and ground contact',
    tradeoff: 'Heavy floats, lots of drag',
    price: 2800,
    unlock: { kind: 'races', count: 3 },
    visual: 'seaplane',
    mass: 640,
    dragArea: 0.5,
    pitchRate: 1.22,
    responsiveness: 6.2,
    stability: 1.02,
    rollFactor: 0.94,
    coolingBonus: 0.03,
    durability: 1.15,
    wingScale: 1.1,
    accepts: {
      frame: ALL_FRAMES,
      engine: [...SINGLE_ENGINES, ...TWIN_ENGINES],
      prop: ['prop-three', 'prop-two', 'prop-four', 'prop-paddle'],
      wings: ['wings-balanced', 'wings-highlift', 'wings-glider'],
      tail: ['tail-standard', 'tail-big', 'tail-twin'],
      gear: ['gear-floats'],
    },
    defaults: {
      frame: 'frame-standard',
      engine: 'engine-efficient',
      prop: 'prop-three',
      wings: 'wings-highlift',
      tail: 'tail-standard',
      gear: 'gear-floats',
    },
  },
  {
    id: 'airframe-cruiser',
    kind: 'airframe',
    archetype: 'Heavy cruiser',
    designation: 'C-9',
    name: 'Bastion',
    tagline: 'Heavy frame. Settles into every line.',
    description:
      'A long-range twin with a stepped windscreen, a long wing and twin fins. Hard to upset and forgiving on contact, but it needs room to turn and carries its momentum everywhere.',
    role: 'Stability and momentum',
    strength: 'Most stable, keeps its speed',
    tradeoff: 'Needs room to turn',
    price: 4200,
    unlock: { kind: 'races', count: 2 },
    visual: 'cruiser',
    mass: 900,
    dragArea: 0.62,
    pitchRate: 1.08,
    responsiveness: 5,
    stability: 1.1,
    rollFactor: 0.88,
    coolingBonus: 0.035,
    durability: 1.4,
    wingScale: 1.2,
    accepts: {
      frame: ALL_FRAMES,
      engine: [...SINGLE_ENGINES, ...TWIN_ENGINES],
      prop: ['prop-three', 'prop-two', 'prop-four', 'prop-paddle'],
      wings: ['wings-balanced', 'wings-highlift', 'wings-glider', 'wings-elliptic'],
      tail: ['tail-standard', 'tail-big', 'tail-twin'],
      gear: ['gear-light', 'gear-tundra', 'gear-retract'],
    },
    defaults: {
      frame: 'frame-standard',
      engine: 'engine-twin',
      prop: 'prop-three',
      wings: 'wings-balanced',
      tail: 'tail-twin',
      gear: 'gear-retract',
    },
  },
  {
    id: 'airframe-stunt',
    kind: 'airframe',
    archetype: 'Aerobatic',
    designation: 'A-3',
    name: 'Starling',
    tagline: 'Two wings, no patience for straight lines.',
    description:
      'A short-coupled display biplane with N-struts, flying wires and an open cockpit. It rolls faster than anything in the hangar and loops on a whim, and it is in no hurry on the straights.',
    role: 'Aerobatics',
    strength: 'Fastest roll, tightest loop',
    tradeoff: 'Draggy, slowest on a straight',
    price: 3600,
    unlock: { kind: 'stars', count: 8 },
    visual: 'stunt',
    wingSets: 2,
    mass: 470,
    dragArea: 0.5,
    pitchRate: 1.78,
    responsiveness: 9,
    stability: 0.72,
    rollFactor: 1.5,
    coolingBonus: 0.03,
    durability: 0.85,
    wingScale: 0.74,
    accepts: {
      frame: ALL_FRAMES,
      engine: SINGLE_ENGINES,
      prop: ['prop-three', 'prop-two', 'prop-four'],
      wings: ['wings-balanced', 'wings-compact', 'wings-elliptic'],
      tail: ['tail-standard', 'tail-big'],
      gear: ['gear-light', 'gear-tundra'],
    },
    defaults: {
      frame: 'frame-light',
      engine: 'engine-wasp',
      prop: 'prop-four',
      wings: 'wings-compact',
      tail: 'tail-standard',
      gear: 'gear-light',
    },
  },
];

// --- Sections ---------------------------------------------------------------------------

const SECTION_LOOKS: Record<SectionCategory, Record<string, string>> = {
  nose: {
    sport: 'Rounded firewall for a pointed cowl',
    scout: 'Short barrel nose for a big radial',
    racer: 'Long, slim racing nose',
    bush: 'Square-shouldered utility nose',
    seaplane: 'Streamlined nose cap; engines ride on a pylon or the wings',
    cruiser: 'Glazed observation nose',
    stunt: 'Stubby nose for a radial behind a short cowl',
  },
  cabin: {
    sport: 'Bubble canopy, low wing',
    scout: 'Bubble canopy, mid wing',
    racer: 'Set-back cockpit with a belly scoop, low wing',
    bush: 'Boxy glazed cabin, strutted high wing',
    seaplane: 'Cockpit under a parasol wing with an engine pylon',
    cruiser: 'Stepped windscreen and a row of cabin windows',
    stunt: 'Open cockpit between two wings on N-struts',
  },
  boom: {
    sport: 'Medium boom with a gentle upsweep',
    scout: 'Short, stubby boom',
    racer: 'Long, low boom',
    bush: 'Steeply upswept boom',
    seaplane: 'High boom that clears the spray',
    cruiser: 'Long, deep boom',
    stunt: 'Short, tapered boom',
  },
};

/** [role, best at, trade-off] for each section. */
const SECTION_ROLES: Record<SectionCategory, Record<string, [string, string, string]>> = {
  nose: {
    sport: ['Baseline', 'Even weight up front', 'No specialism'],
    scout: ['Agility', 'Quick to point', 'Short and frail'],
    racer: ['Speed', 'Low drag', 'Fragile'],
    bush: ['Toughness', 'Shrugs off knocks', 'Blunt and draggy'],
    seaplane: ['Toughness', 'Clean, tough nose', 'Needs a pylon cabin or wing engines'],
    cruiser: ['Stability', 'Calm and tough', 'Heavy'],
    stunt: ['Agility', 'Light and quick', 'Short of cooling'],
  },
  cabin: {
    sport: ['Baseline', 'Takes most wings and gear', 'No specialism'],
    scout: ['Agility', 'Light and lively', 'Small wings only'],
    racer: ['Speed', 'Slippery cockpit', 'Fragile'],
    bush: ['Low speed', 'Big high wing and tough gear', 'Draggy'],
    seaplane: ['Toughness', 'Floats and a pylon engine', 'Draggy'],
    cruiser: ['Stability', 'Long wings and twin engines', 'Heavy'],
    stunt: ['Agility', 'Fast roll, two wings', 'Draggy'],
  },
  boom: {
    sport: ['Baseline', 'Even pitch feel', 'No specialism'],
    scout: ['Agility', 'Sharp pitch', 'Twitchy'],
    racer: ['Speed', 'Long and slippery', 'Barely self-levels'],
    bush: ['Stability', 'Big tail authority', 'Draggy'],
    seaplane: ['Stability', 'Steady and high', 'Slow pitch'],
    cruiser: ['Stability', 'Very steady', 'Slow to rotate'],
    stunt: ['Agility', 'Sharp pitch', 'Barely self-levels'],
  },
};

/** Sections each rival will stake in a challenge race (see progression/rivals.ts). */
export const RIVAL_PRIZES: Readonly<Record<string, string>> = {
  'nose-racer': 'ai-aggressive',
  'boom-cruiser': 'ai-speed',
  'cabin-bush': 'ai-precision',
};

const SECTION_NAMES: Record<SectionCategory, string> = { nose: 'Nose', cabin: 'Cabin', boom: 'Tail Boom' };

const sectionsOf = (airframe: AirframeSpec): SectionPart[] =>
  SECTION_CATEGORIES.map((category) => {
    const id = `${category}-${airframe.visual}`;
    const [role, strength, tradeoff] = SECTION_ROLES[category][airframe.visual]!;
    const rival = RIVAL_PRIZES[id];
    return {
      id,
      kind: 'part',
      category,
      source: airframe.id,
      name: `${airframe.name} ${SECTION_NAMES[category]}`,
      tagline: `Off the ${airframe.name} ${airframe.designation}.`,
      description: `The ${SECTION_NAMES[category].toLowerCase()} of the ${airframe.name}. Bolt it onto a Workshop Special to mix it with sections from other aircraft.`,
      role,
      strength,
      tradeoff,
      price: 0,
      unlock: rival
        ? { kind: 'rival', airframe: airframe.id, rival }
        : { kind: 'airframe', airframe: airframe.id },
      look: SECTION_LOOKS[category][airframe.visual]!,
    };
  });

export const SECTIONS: readonly SectionPart[] = STOCK_AIRFRAMES.flatMap(sectionsOf);

const withSections = (airframe: AirframeSpec): Airframe => ({
  ...airframe,
  accepts: {
    nose: [`nose-${airframe.visual}`],
    cabin: [`cabin-${airframe.visual}`],
    boom: [`boom-${airframe.visual}`],
    ...airframe.accepts,
  },
  defaults: {
    nose: `nose-${airframe.visual}`,
    cabin: `cabin-${airframe.visual}`,
    boom: `boom-${airframe.visual}`,
    ...airframe.defaults,
  },
});

/**
 * The Workshop Special: a jig that takes any sections you own. Its handling, sockets and
 * which parts fit come from those sections (see `effectiveAirframe` in build.ts); the
 * numbers here are the Meridian's, its starting sections.
 */
const CUSTOM_AIRFRAME: Airframe = {
  ...withSections(STOCK_AIRFRAMES[0]!),
  id: 'airframe-custom',
  kind: 'airframe',
  archetype: 'Kitbash',
  designation: 'X-1',
  name: 'Workshop Special',
  tagline: 'Whatever you can bolt together.',
  description:
    'A bare jig in the corner of the hangar. Bolt on any nose, cabin and tail boom you own, from any aircraft, and it becomes your own machine. Its handling comes from the sections you choose.',
  role: 'Your own design',
  strength: 'Mix sections from every aircraft',
  tradeoff: 'Only as good as what you bolt on',
  price: 1500,
  unlock: { kind: 'races', count: 2 },
  visual: 'custom',
  accepts: {
    nose: SECTIONS.filter((section) => section.category === 'nose').map((section) => section.id),
    cabin: SECTIONS.filter((section) => section.category === 'cabin').map((section) => section.id),
    boom: SECTIONS.filter((section) => section.category === 'boom').map((section) => section.id),
    frame: ALL_FRAMES,
    engine: [...SINGLE_ENGINES, ...TWIN_ENGINES, 'engine-pulse'],
    prop: ALL_PROPS,
    wings: ['wings-balanced', 'wings-compact', 'wings-elliptic', 'wings-highlift', 'wings-glider'],
    tail: ['tail-standard', 'tail-big', 'tail-twin', 'tail-vee'],
    gear: ['gear-light', 'gear-tundra', 'gear-retract', 'gear-floats'],
  },
};

export const AIRFRAMES: readonly Airframe[] = [...STOCK_AIRFRAMES.map(withSections), CUSTOM_AIRFRAME];

export const ALL_PARTS: readonly AircraftPart[] = [
  ...SECTIONS,
  ...FRAMES,
  ...ENGINES,
  ...PROPS,
  ...WINGS,
  ...TAILS,
  ...GEARS,
];
export const ALL_ITEMS: readonly ShopItem[] = [...AIRFRAMES, ...ALL_PARTS];

const partIndex = new Map<string, AircraftPart>(ALL_PARTS.map((part) => [part.id, part]));
const airframeIndex = new Map<string, Airframe>(AIRFRAMES.map((airframe) => [airframe.id, airframe]));

export const getPart = (id: string): AircraftPart | undefined => partIndex.get(id);
export const getAirframe = (id: string): Airframe | undefined => airframeIndex.get(id);
export const getItem = (id: string): ShopItem | undefined => partIndex.get(id) ?? airframeIndex.get(id);

/** Typed lookup for one slot; returns undefined for unknown ids or ids from another slot. */
export const getPartIn = <C extends PartCategory>(
  category: C,
  id: string,
): Extract<AircraftPart, { category: C }> | undefined => {
  const part = partIndex.get(id);
  return part?.category === category ? (part as Extract<AircraftPart, { category: C }>) : undefined;
};

const CATEGORY_LISTS: Record<PartCategory, readonly AircraftPart[]> = {
  nose: SECTIONS.filter((section) => section.category === 'nose'),
  cabin: SECTIONS.filter((section) => section.category === 'cabin'),
  boom: SECTIONS.filter((section) => section.category === 'boom'),
  frame: FRAMES,
  engine: ENGINES,
  prop: PROPS,
  wings: WINGS,
  tail: TAILS,
  gear: GEARS,
};

export const partsForCategory = (category: PartCategory): readonly AircraftPart[] => CATEGORY_LISTS[category];

export const CATEGORY_LABELS: Record<PartCategory, string> = {
  nose: 'Nose',
  cabin: 'Cabin',
  boom: 'Tail boom',
  frame: 'Frame',
  engine: 'Engine',
  prop: 'Propeller',
  wings: 'Wings',
  tail: 'Tail',
  gear: 'Gear',
};

export const DEFAULT_AIRFRAME_ID: AirframeId = 'airframe-sport';

/** Whether an airframe accepts a part. */
export const isCompatible = (airframe: Airframe, part: AircraftPart): boolean =>
  airframe.accepts[part.category].includes(part.id);

/** Airframes that accept a part, for "fits" hints. */
export const airframesAccepting = (part: AircraftPart): Airframe[] =>
  AIRFRAMES.filter((airframe) => isCompatible(airframe, part));

export const describeUnlock = (rule: UnlockRule): string => {
  switch (rule.kind) {
    case 'default':
      return 'Standard issue';
    case 'purchase':
      return 'Available to purchase';
    case 'races':
      return `Finish ${rule.count} race${rule.count === 1 ? '' : 's'} to unlock`;
    case 'podium':
      return `Finish on the podium ${rule.count === 1 ? 'once' : `${rule.count} times`} to unlock`;
    case 'wins':
      return `Win ${rule.count === 1 ? 'a race' : `${rule.count} races`} to unlock`;
    case 'style':
      return `Score ${rule.score.toLocaleString('en-US')} style points in one race to unlock`;
    case 'airframe':
      return `Comes with the ${getAirframe(rule.airframe)?.name ?? 'aircraft'}`;
    case 'rival':
      return `Comes with the ${getAirframe(rule.airframe)?.name ?? 'aircraft'}, or win it in a rival challenge`;
    case 'stars':
      return `Earn ${rule.count} licence stars (activity medals and discoveries) to unlock`;
  }
};
