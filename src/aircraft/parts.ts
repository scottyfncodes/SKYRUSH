/**
 * Aircraft component catalogue.
 *
 * Every value here feeds the performance model in `performance.ts` and the
 * procedural model builder in `render/aircraftModel.ts`. Numbers are in SI
 * units unless noted. See docs/FLIGHT_MODEL.md for the assumptions.
 */

export type PartCategory = 'fuselage' | 'engine' | 'wings';

export type UnlockRule =
  | { kind: 'default' }
  | { kind: 'purchase' }
  | { kind: 'races'; count: number }
  | { kind: 'podium'; count: number };

interface PartBase {
  id: string;
  category: PartCategory;
  name: string;
  tagline: string;
  description: string;
  price: number;
  unlock: UnlockRule;
  mass: number;
}

export interface FuselagePart extends PartBase {
  category: 'fuselage';
  visual: 'needle' | 'allrounder' | 'heavy';
  dragArea: number;
  pitchRate: number; // rad/s at full authority
  responsiveness: number; // how quickly rotation rates reach their target (1/s)
  stability: number; // auto-level and damping strength multiplier
  rollFactor: number; // multiplies wing roll rate
  coolingBonus: number; // added to engine cooling rate (per second)
  durability: number; // 1 = baseline; affects scrape tolerance and crash penalty
}

export interface EnginePart extends PartBase {
  category: 'engine';
  visual: 'efficient' | 'twin' | 'pulse';
  thrust: number; // N at full throttle
  boostMultiplier: number; // thrust multiplier while boosting
  dragArea: number;
  baseLoad: number; // heat equilibrium at full throttle without boost (0..1)
  boostLoad: number; // extra heat load while boosting (pushes equilibrium above 1)
  heatRate: number; // how quickly heat approaches the load when heating (1/s)
  coolRate: number; // how quickly heat approaches the load when cooling (1/s)
  boostCapacity: number; // seconds of continuous boost
  boostRechargeTime: number; // seconds from empty to full while not boosting
}

export interface WingPart extends PartBase {
  category: 'wings';
  visual: 'compact' | 'balanced' | 'highlift';
  dragArea: number;
  liftArea: number; // controls stall speed
  rollRate: number; // rad/s
  grip: number; // velocity alignment rate at reference speed (rad/s)
  gripExponent: number; // how strongly grip falls off with speed
  stability: number; // added to fuselage stability
}

export type AircraftPart = FuselagePart | EnginePart | WingPart;

export const FUSELAGES: readonly FuselagePart[] = [
  {
    id: 'fuselage-needle',
    category: 'fuselage',
    name: 'Needle',
    tagline: 'Light. Nervous. Fast to point.',
    description:
      'A slender carbon spar with a minimal canopy and almost no reserve structure. It changes direction instantly but pays for every mistake.',
    price: 1800,
    unlock: { kind: 'purchase' },
    mass: 650,
    visual: 'needle',
    dragArea: 0.55,
    pitchRate: 1.65,
    responsiveness: 9,
    stability: 0.75,
    rollFactor: 1.15,
    coolingBonus: -0.01,
    durability: 0.6,
  },
  {
    id: 'fuselage-allrounder',
    category: 'fuselage',
    name: 'Meridian',
    tagline: 'The balanced all-rounder.',
    description:
      'The championship reference frame. Predictable pitch response, moderate mass and enough structure to survive a bad landing.',
    price: 0,
    unlock: { kind: 'default' },
    mass: 900,
    visual: 'allrounder',
    dragArea: 0.7,
    pitchRate: 1.3,
    responsiveness: 7,
    stability: 1.0,
    rollFactor: 1.0,
    coolingBonus: 0,
    durability: 1.0,
  },
  {
    id: 'fuselage-heavy',
    category: 'fuselage',
    name: 'Bastion',
    tagline: 'Heavy frame. Settles into every line.',
    description:
      'A wide, armoured hull with integrated cooling ducts. Hard to upset and forgiving on contact, but it needs room to turn and more thrust to move.',
    price: 2200,
    unlock: { kind: 'races', count: 2 },
    mass: 1250,
    visual: 'heavy',
    dragArea: 0.9,
    pitchRate: 1.05,
    responsiveness: 5,
    stability: 1.35,
    rollFactor: 0.85,
    coolingBonus: 0.035,
    durability: 1.4,
  },
];

export const ENGINES: readonly EnginePart[] = [
  {
    id: 'engine-efficient',
    category: 'engine',
    name: 'Kestrel Turbine',
    tagline: 'Moderate thrust, cool running.',
    description:
      'A single high-bypass racing turbine tuned for endurance. It will never win a drag race, but it rarely overheats and keeps boost in reserve.',
    price: 0,
    unlock: { kind: 'default' },
    mass: 300,
    visual: 'efficient',
    thrust: 9000,
    boostMultiplier: 1.45,
    dragArea: 0.2,
    baseLoad: 0.35,
    boostLoad: 0.95,
    heatRate: 0.14,
    coolRate: 0.16,
    boostCapacity: 5.5,
    boostRechargeTime: 14,
  },
  {
    id: 'engine-twin',
    category: 'engine',
    name: 'Tandem Twin',
    tagline: 'Two turbines. Twice the argument.',
    description:
      'Paired turbines on outboard pylons. Enormous thrust and top speed, but the extra mass blunts turn-in and the heat builds fast under boost.',
    price: 2600,
    unlock: { kind: 'races', count: 1 },
    mass: 560,
    visual: 'twin',
    thrust: 12800,
    boostMultiplier: 1.5,
    dragArea: 0.35,
    baseLoad: 0.6,
    boostLoad: 1.0,
    heatRate: 0.2,
    coolRate: 0.12,
    boostCapacity: 4.5,
    boostRechargeTime: 16,
  },
  {
    id: 'engine-pulse',
    category: 'engine',
    name: 'Vantage Pulse Drive',
    tagline: 'Experimental. Explosive. Short-lived.',
    description:
      'A pulsed-detonation prototype. Boost hits like a hammer and heat soars with it. Short boost windows reward timing over brute force.',
    price: 3400,
    unlock: { kind: 'podium', count: 1 },
    mass: 420,
    visual: 'pulse',
    thrust: 11000,
    boostMultiplier: 1.95,
    dragArea: 0.25,
    baseLoad: 0.5,
    boostLoad: 1.4,
    heatRate: 0.25,
    coolRate: 0.13,
    boostCapacity: 3.2,
    boostRechargeTime: 11,
  },
];

export const WINGS: readonly WingPart[] = [
  {
    id: 'wings-compact',
    category: 'wings',
    name: 'Razor Compact',
    tagline: 'Snap rolls, thin margins.',
    description:
      'Short clipped wings with oversized ailerons. Roll response is instant and drag is low, but the stall speed climbs and slow corners get loose.',
    price: 1500,
    unlock: { kind: 'purchase' },
    mass: 120,
    visual: 'compact',
    dragArea: 0.33,
    liftArea: 9,
    rollRate: 3.2,
    grip: 1.55,
    gripExponent: 0.85,
    stability: -0.15,
  },
  {
    id: 'wings-balanced',
    category: 'wings',
    name: 'Crescent Balanced',
    tagline: 'Versatile, honest handling.',
    description:
      'A moderately swept planform with conventional control surfaces. Nothing exceptional, nothing to apologise for.',
    price: 0,
    unlock: { kind: 'default' },
    mass: 170,
    visual: 'balanced',
    dragArea: 0.45,
    liftArea: 13,
    rollRate: 2.4,
    grip: 1.4,
    gripExponent: 1.0,
    stability: 0,
  },
  {
    id: 'wings-highlift',
    category: 'wings',
    name: 'Condor High-Lift',
    tagline: 'Slow corners, strong grip.',
    description:
      'Long, cambered wings with full-span flaps. The aircraft stays controllable at very low speeds and settles into tight lines, at the cost of drag on the straights.',
    price: 1700,
    unlock: { kind: 'purchase' },
    mass: 230,
    visual: 'highlift',
    dragArea: 0.58,
    liftArea: 18,
    rollRate: 1.9,
    grip: 1.3,
    gripExponent: 1.25,
    stability: 0.3,
  },
];

export interface Livery {
  id: string;
  name: string;
  base: number;
  accent: number;
  secondary: number;
  canopy: number;
}

export const LIVERIES: readonly Livery[] = [
  {
    id: 'livery-ember',
    name: 'Graphite Ember',
    base: 0x2a2f36,
    accent: 0xff9f1c,
    secondary: 0xf2ede4,
    canopy: 0x183a4a,
  },
  {
    id: 'livery-glacier',
    name: 'Glacier Cyan',
    base: 0xe8e4dc,
    accent: 0x29c7e6,
    secondary: 0x1a2232,
    canopy: 0x11283a,
  },
  {
    id: 'livery-midnight',
    name: 'Midnight Orange',
    base: 0x151c2c,
    accent: 0xff6a1f,
    secondary: 0xc9d2de,
    canopy: 0x0f2334,
  },
  {
    id: 'livery-signal',
    name: 'Signal White',
    base: 0xf4f1ea,
    accent: 0xe8332a,
    secondary: 0x22262e,
    canopy: 0x1a2f3e,
  },
];

export const ALL_PARTS: readonly AircraftPart[] = [...FUSELAGES, ...ENGINES, ...WINGS];

const partIndex = new Map<string, AircraftPart>(ALL_PARTS.map((part) => [part.id, part]));
const liveryIndex = new Map<string, Livery>(LIVERIES.map((livery) => [livery.id, livery]));

export const getPart = (id: string): AircraftPart | undefined => partIndex.get(id);
export const getFuselage = (id: string): FuselagePart | undefined => {
  const part = partIndex.get(id);
  return part?.category === 'fuselage' ? part : undefined;
};
export const getEngine = (id: string): EnginePart | undefined => {
  const part = partIndex.get(id);
  return part?.category === 'engine' ? part : undefined;
};
export const getWings = (id: string): WingPart | undefined => {
  const part = partIndex.get(id);
  return part?.category === 'wings' ? part : undefined;
};
export const getLivery = (id: string): Livery | undefined => liveryIndex.get(id);

export const partsForCategory = (category: PartCategory): readonly AircraftPart[] =>
  category === 'fuselage' ? FUSELAGES : category === 'engine' ? ENGINES : WINGS;

export const DEFAULT_PART_IDS: Record<PartCategory, string> = {
  fuselage: 'fuselage-allrounder',
  engine: 'engine-efficient',
  wings: 'wings-balanced',
};

export const DEFAULT_LIVERY_ID = LIVERIES[0]!.id;

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
  }
};
