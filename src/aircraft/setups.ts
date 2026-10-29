import type { AircraftBuild } from './build';

/**
 * Curated starting points for each aircraft. They are ordinary builds: the
 * character comes from the parts, and the player can change any slot after
 * applying one. Applying needs every part to be owned.
 */
export interface FactorySetup {
  id: string;
  name: string;
  note: string;
  build: AircraftBuild;
}

export const FACTORY_SETUPS: readonly FactorySetup[] = [
  // Meridian
  {
    id: 'sport-club-racer',
    name: 'Club Racer',
    note: 'Tuned engine, clipped wings and a V-tail for flat-out courses',
    build: {
      airframe: 'airframe-sport',
      nose: 'nose-sport',
      cabin: 'cabin-sport',
      boom: 'boom-sport',
      frame: 'frame-standard',
      engine: 'engine-tuned',
      prop: 'prop-two',
      wings: 'wings-compact',
      tail: 'tail-vee',
      gear: 'gear-retract',
    },
  },
  {
    id: 'sport-ridge-climber',
    name: 'Ridge Climber',
    note: 'Four blades and a light frame to haul up mountain passes',
    build: {
      airframe: 'airframe-sport',
      nose: 'nose-sport',
      cabin: 'cabin-sport',
      boom: 'boom-sport',
      frame: 'frame-light',
      engine: 'engine-efficient',
      prop: 'prop-four',
      wings: 'wings-elliptic',
      tail: 'tail-standard',
      gear: 'gear-light',
    },
  },
  {
    id: 'sport-steady-tourer',
    name: 'Steady Tourer',
    note: 'Big tail and high-lift wings: hard to upset, easy to fly',
    build: {
      airframe: 'airframe-sport',
      nose: 'nose-sport',
      cabin: 'cabin-sport',
      boom: 'boom-sport',
      frame: 'frame-reinforced',
      engine: 'engine-albatross',
      prop: 'prop-three',
      wings: 'wings-highlift',
      tail: 'tail-big',
      gear: 'gear-light',
    },
  },
  // Wren
  {
    id: 'scout-gate-threader',
    name: 'Gate Threader',
    note: 'Fabric frame and a V-tail for the tightest lines',
    build: {
      airframe: 'airframe-scout',
      nose: 'nose-scout',
      cabin: 'cabin-scout',
      boom: 'boom-scout',
      frame: 'frame-light',
      engine: 'engine-wasp',
      prop: 'prop-three',
      wings: 'wings-compact',
      tail: 'tail-vee',
      gear: 'gear-light',
    },
  },
  {
    id: 'scout-hot-wren',
    name: 'Hot Wren',
    note: 'A Kestrel Sport up front turns the Wren into a sprinter',
    build: {
      airframe: 'airframe-scout',
      nose: 'nose-scout',
      cabin: 'cabin-scout',
      boom: 'boom-scout',
      frame: 'frame-standard',
      engine: 'engine-tuned',
      prop: 'prop-two',
      wings: 'wings-elliptic',
      tail: 'tail-standard',
      gear: 'gear-light',
    },
  },
  // Needle
  {
    id: 'racer-pylon',
    name: 'Pylon Special',
    note: 'Supercharged with scimitar blades: speed above all',
    build: {
      airframe: 'airframe-racer',
      nose: 'nose-racer',
      cabin: 'cabin-racer',
      boom: 'boom-racer',
      frame: 'frame-composite',
      engine: 'engine-hornet',
      prop: 'prop-scimitar',
      wings: 'wings-compact',
      tail: 'tail-vee',
      gear: 'gear-retract',
    },
  },
  {
    id: 'racer-tamed',
    name: 'Tamed Needle',
    note: 'Conventional tail and an elliptical wing for a calmer ride',
    build: {
      airframe: 'airframe-racer',
      nose: 'nose-racer',
      cabin: 'cabin-racer',
      boom: 'boom-racer',
      frame: 'frame-reinforced',
      engine: 'engine-efficient',
      prop: 'prop-three',
      wings: 'wings-elliptic',
      tail: 'tail-standard',
      gear: 'gear-retract',
    },
  },
  // Mule
  {
    id: 'bush-backcountry',
    name: 'Backcountry',
    note: 'Paddle prop and tundra tyres for ridge-hopping',
    build: {
      airframe: 'airframe-bush',
      nose: 'nose-bush',
      cabin: 'cabin-bush',
      boom: 'boom-bush',
      frame: 'frame-reinforced',
      engine: 'engine-efficient',
      prop: 'prop-paddle',
      wings: 'wings-highlift',
      tail: 'tail-big',
      gear: 'gear-tundra',
    },
  },
  {
    id: 'bush-long-haul',
    name: 'Long Haul',
    note: 'Long-span wing and the economy engine: boost for days',
    build: {
      airframe: 'airframe-bush',
      nose: 'nose-bush',
      cabin: 'cabin-bush',
      boom: 'boom-bush',
      frame: 'frame-light',
      engine: 'engine-albatross',
      prop: 'prop-three',
      wings: 'wings-glider',
      tail: 'tail-standard',
      gear: 'gear-light',
    },
  },
  // Petrel
  {
    id: 'seaplane-island-hopper',
    name: 'Island Hopper',
    note: 'Light frame and four blades for low, fast coastal runs',
    build: {
      airframe: 'airframe-seaplane',
      nose: 'nose-seaplane',
      cabin: 'cabin-seaplane',
      boom: 'boom-seaplane',
      frame: 'frame-light',
      engine: 'engine-tuned',
      prop: 'prop-four',
      wings: 'wings-balanced',
      tail: 'tail-standard',
      gear: 'gear-floats',
    },
  },
  {
    id: 'seaplane-patrol',
    name: 'Coastal Patrol',
    note: 'Twin engines and twin fins: a steady heavy hauler',
    build: {
      airframe: 'airframe-seaplane',
      nose: 'nose-seaplane',
      cabin: 'cabin-seaplane',
      boom: 'boom-seaplane',
      frame: 'frame-reinforced',
      engine: 'engine-twin',
      prop: 'prop-three',
      wings: 'wings-glider',
      tail: 'tail-twin',
      gear: 'gear-floats',
    },
  },
  // Bastion
  {
    id: 'cruiser-express',
    name: 'Express',
    note: 'Elliptical wing and coarse props to carry speed everywhere',
    build: {
      airframe: 'airframe-cruiser',
      nose: 'nose-cruiser',
      cabin: 'cabin-cruiser',
      boom: 'boom-cruiser',
      frame: 'frame-composite',
      engine: 'engine-twin',
      prop: 'prop-two',
      wings: 'wings-elliptic',
      tail: 'tail-twin',
      gear: 'gear-retract',
    },
  },
  {
    id: 'cruiser-single',
    name: 'Single Hornet',
    note: 'One supercharged engine in the nose and a big tail',
    build: {
      airframe: 'airframe-cruiser',
      nose: 'nose-cruiser',
      cabin: 'cabin-cruiser',
      boom: 'boom-cruiser',
      frame: 'frame-standard',
      engine: 'engine-hornet',
      prop: 'prop-four',
      wings: 'wings-highlift',
      tail: 'tail-big',
      gear: 'gear-light',
    },
  },
];

export const factorySetupsFor = (airframeId: string): FactorySetup[] =>
  FACTORY_SETUPS.filter((setup) => setup.build.airframe === airframeId);
