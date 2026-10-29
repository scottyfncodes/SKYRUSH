import { getAirframe, getPartIn, type Airframe } from '../../aircraft/parts';
import { sampleBody, type BodyStation, type BodySample } from './geometry';

/**
 * Shapes and attachment sockets for each airframe. Fuselages start at the
 * firewall: a nose engine's cowl continues forward from there, and when the
 * engines are elsewhere a rounded nose cap does.
 */
export interface AirframeShape {
  /** Fuselage stations from the firewall back to the tail (nose → tail). */
  stations: BodyStation[];
  /** Where the nose meets the cabin and the cabin meets the tail boom (z). */
  split: [number, number];
  /** Nose cap length when no engine is in the nose. */
  noseCap: number;
  /** Glazed nose cap (cruiser) instead of a painted one. */
  glazedNose?: boolean;
  canopy:
    | { kind: 'bubble'; z: number; y: number; length: number; width: number; height: number; pilot: boolean }
    | { kind: 'cabin'; z: number; y: number; length: number; height: number; windscreen: number }
    | { kind: 'stepped'; z: number; y: number; width: number; height: number; windows: number };
  wing: {
    mount: 'low' | 'mid' | 'high' | 'parasol';
    y: number;
    /** Leading edge z at the root. */
    le: number;
    /** Lift struts from the fuselage to the wing (span fraction where they meet it). */
    struts?: number;
  };
  tail: {
    /** Tailplane leading edge z and height. */
    le: number;
    y: number;
    /** Fin root height (top of the fuselage there). */
    finY: number;
    scale: number;
  };
  gear: {
    /** Main wheel z and half track. */
    z: number;
    track: number;
    /** Height of the main wheels' contact point. */
    ground: number;
    /** Where the main legs attach (y). */
    attachY: number;
    /** Tailwheel z and the fuselage underside there. */
    tailZ: number;
    tailY: number;
  };
  /** Cowl scale for nose engines. */
  cowl: number;
  /** Propeller scale. */
  prop: number;
  /** Single engines on a pylon above the wing instead of the nose (seaplane). */
  pylon?: { y: number; z: number };
  /** Twin engine nacelles: span fraction. */
  nacelle: number;
  /** Belly radiator scoop (racer). */
  scoop?: { z: number; length: number };
  /** Radio mast behind the canopy, with a wire to the fin. */
  mast?: { z: number };
  /** Where sections from different aircraft are spliced together (z), each under a riveted collar. */
  joints?: number[];
}

type StockVisual = Exclude<Airframe['visual'], 'custom'>;

const SHAPES: Record<StockVisual, AirframeShape> = {
  sport: {
    split: [1.6, -1.6],
    stations: [
      { z: 2.55, w: 0.6, top: 0.6, bottom: 0.62 },
      { z: 1.6, w: 0.66, top: 0.66, bottom: 0.7 },
      { z: 0.4, w: 0.64, top: 0.68, bottom: 0.68, y: 0.02 },
      { z: -0.9, w: 0.55, top: 0.66, bottom: 0.56, y: 0.05 },
      { z: -2.2, w: 0.4, top: 0.48, bottom: 0.38, y: 0.12 },
      { z: -3.5, w: 0.24, top: 0.3, bottom: 0.2, y: 0.22 },
      { z: -4.55, w: 0.05, top: 0.08, bottom: 0.05, y: 0.32 },
    ],
    noseCap: 1.2,
    canopy: { kind: 'bubble', z: 0.15, y: 0.56, length: 2.0, width: 0.88, height: 0.56, pilot: true },
    wing: { mount: 'low', y: -0.42, le: 1.35 },
    tail: { le: -3.55, y: 0.24, finY: 0.42, scale: 1 },
    gear: { z: 1.0, track: 1.45, ground: -1.65, attachY: -0.5, tailZ: -4.05, tailY: 0.05 },
    cowl: 1,
    prop: 1,
    nacelle: 0.36,
    mast: { z: -1.15 },
  },
  scout: {
    split: [1.1, -1.3],
    stations: [
      { z: 1.75, w: 0.64, top: 0.64, bottom: 0.64 },
      { z: 0.9, w: 0.66, top: 0.68, bottom: 0.66 },
      { z: -0.3, w: 0.54, top: 0.62, bottom: 0.52, y: 0.04 },
      { z: -1.6, w: 0.34, top: 0.42, bottom: 0.3, y: 0.14 },
      { z: -2.65, w: 0.14, top: 0.2, bottom: 0.12, y: 0.24 },
      { z: -3.2, w: 0.04, top: 0.08, bottom: 0.04, y: 0.3 },
    ],
    noseCap: 1,
    canopy: { kind: 'bubble', z: -0.2, y: 0.58, length: 1.55, width: 0.82, height: 0.56, pilot: true },
    wing: { mount: 'mid', y: -0.18, le: 0.95 },
    tail: { le: -2.55, y: 0.26, finY: 0.36, scale: 0.86 },
    gear: { z: 0.75, track: 1.15, ground: -1.42, attachY: -0.45, tailZ: -2.9, tailY: 0.16 },
    cowl: 1.1,
    prop: 0.88,
    nacelle: 0.36,
  },
  racer: {
    split: [2.2, -2.4],
    stations: [
      { z: 3.5, w: 0.5, top: 0.5, bottom: 0.52 },
      { z: 2.2, w: 0.55, top: 0.55, bottom: 0.6 },
      { z: 0.6, w: 0.56, top: 0.56, bottom: 0.62 },
      { z: -0.9, w: 0.5, top: 0.6, bottom: 0.54, y: 0.02 },
      { z: -2.4, w: 0.36, top: 0.5, bottom: 0.36, y: 0.06 },
      { z: -3.9, w: 0.2, top: 0.28, bottom: 0.2, y: 0.14 },
      { z: -5.05, w: 0.05, top: 0.08, bottom: 0.05, y: 0.22 },
    ],
    noseCap: 1.3,
    canopy: { kind: 'bubble', z: -1.25, y: 0.52, length: 1.5, width: 0.72, height: 0.46, pilot: true },
    wing: { mount: 'low', y: -0.34, le: 1.75 },
    tail: { le: -4.15, y: 0.18, finY: 0.32, scale: 0.92 },
    gear: { z: 1.35, track: 1.25, ground: -1.55, attachY: -0.42, tailZ: -4.6, tailY: 0.04 },
    cowl: 0.92,
    prop: 0.95,
    nacelle: 0.36,
    scoop: { z: -0.2, length: 2.0 },
  },
  bush: {
    split: [1.9, -1.2],
    stations: [
      { z: 2.35, w: 0.56, top: 0.6, bottom: 0.62, square: 2.4 },
      { z: 1.6, w: 0.64, top: 0.84, bottom: 0.68, square: 3 },
      { z: 0.3, w: 0.66, top: 0.9, bottom: 0.7, y: 0.02, square: 3.4 },
      { z: -0.9, w: 0.56, top: 0.74, bottom: 0.52, y: 0.1, square: 3 },
      { z: -2.5, w: 0.34, top: 0.42, bottom: 0.26, y: 0.3, square: 2.4 },
      { z: -4.0, w: 0.12, top: 0.16, bottom: 0.1, y: 0.5, square: 2 },
      { z: -4.35, w: 0.04, top: 0.06, bottom: 0.04, y: 0.54 },
    ],
    noseCap: 1.1,
    canopy: { kind: 'cabin', z: 0.6, y: 0.35, length: 1.9, height: 0.42, windscreen: 1.7 },
    wing: { mount: 'high', y: 0.95, le: 1.55, struts: 0.46 },
    tail: { le: -3.85, y: 0.55, finY: 0.66, scale: 1.05 },
    gear: { z: 1.25, track: 1.55, ground: -1.85, attachY: -0.6, tailZ: -3.95, tailY: 0.42 },
    cowl: 1,
    prop: 1.05,
    nacelle: 0.38,
    mast: { z: -0.6 },
  },
  seaplane: {
    split: [1.9, -1.0],
    stations: [
      { z: 2.75, w: 0.46, top: 0.48, bottom: 0.52 },
      { z: 1.3, w: 0.56, top: 0.6, bottom: 0.64 },
      { z: -0.3, w: 0.52, top: 0.58, bottom: 0.54, y: 0.04 },
      { z: -2.1, w: 0.34, top: 0.38, bottom: 0.3, y: 0.16 },
      { z: -3.7, w: 0.14, top: 0.16, bottom: 0.1, y: 0.32 },
      { z: -4.25, w: 0.04, top: 0.06, bottom: 0.04, y: 0.38 },
    ],
    noseCap: 1.15,
    canopy: { kind: 'bubble', z: 0.55, y: 0.5, length: 1.7, width: 0.78, height: 0.46, pilot: true },
    wing: { mount: 'parasol', y: 1.45, le: 1.75 },
    tail: { le: -3.7, y: 0.34, finY: 0.42, scale: 1 },
    gear: { z: 0.5, track: 1.45, ground: -1.9, attachY: -0.4, tailZ: -3.9, tailY: 0.2 },
    cowl: 0.92,
    prop: 1,
    pylon: { y: 2.05, z: 1.95 },
    nacelle: 0.36,
  },
  cruiser: {
    split: [3.6, -2.0],
    stations: [
      { z: 4.4, w: 0.78, top: 0.78, bottom: 0.8 },
      { z: 3.1, w: 0.92, top: 0.96, bottom: 0.92 },
      { z: 0.9, w: 0.98, top: 1.02, bottom: 0.96, y: 0.02 },
      { z: -1.6, w: 0.9, top: 0.96, bottom: 0.84, y: 0.06 },
      { z: -3.9, w: 0.56, top: 0.62, bottom: 0.42, y: 0.24 },
      { z: -5.7, w: 0.16, top: 0.2, bottom: 0.12, y: 0.48 },
      { z: -6.1, w: 0.05, top: 0.06, bottom: 0.04, y: 0.52 },
    ],
    noseCap: 1.4,
    glazedNose: true,
    canopy: { kind: 'stepped', z: 3.25, y: 0.62, width: 0.9, height: 0.42, windows: 5 },
    wing: { mount: 'low', y: -0.36, le: 1.9 },
    tail: { le: -5.25, y: 0.42, finY: 0.62, scale: 1.18 },
    gear: { z: 1.4, track: 2.6, ground: -2.05, attachY: -0.5, tailZ: -5.2, tailY: 0.18 },
    cowl: 1.1,
    prop: 1.08,
    nacelle: 0.3,
    mast: { z: 0.6 },
  },
};

const size = (sample: BodySample): number => (sample.w + (sample.top + sample.bottom) / 2) / 2;

const visualOf = (category: 'nose' | 'cabin' | 'boom', id: string): StockVisual | undefined => {
  const section = getPartIn(category, id);
  const source = section ? getAirframe(section.source) : undefined;
  return source && source.visual !== 'custom' ? source.visual : undefined;
};

/**
 * A fuselage composed from three aircraft's sections. The cabin keeps its own frame
 * (canopy, wing, gear and engine pylon sockets); the nose and tail boom are moved to
 * meet it and scaled most of the way to the cabin's section. The rest of the mismatch
 * is left as a step at each splice, which the model covers with a riveted collar, so
 * a Special looks bolted together from other aircraft rather than built in one piece.
 */
export const composeShape = (
  noseVisual: StockVisual,
  cabinVisual: StockVisual,
  boomVisual: StockVisual,
): AirframeShape => {
  const N = SHAPES[noseVisual];
  const C = SHAPES[cabinVisual];
  const B = SHAPES[boomVisual];
  if (noseVisual === cabinVisual && cabinVisual === boomVisual) return C;
  const [cFront, cBack] = C.split;
  const front = sampleBody(C.stations, cFront);
  const back = sampleBody(C.stations, cBack);
  const noseJoint = sampleBody(N.stations, N.split[0]);
  const boomJoint = sampleBody(B.stations, B.split[1]);
  // Close 65% of the size difference: enough to bolt on, not enough to hide the seam.
  const clampScale = (k: number) => 1 + (Math.min(1.45, Math.max(0.7, k)) - 1) * 0.65;
  const kn = clampScale(size(front) / size(noseJoint));
  const kb = clampScale(size(back) / size(boomJoint));
  const joints: number[] = [];
  if (noseVisual !== cabinVisual) joints.push(cFront);
  if (boomVisual !== cabinVisual) joints.push(cBack);

  const nose: BodyStation[] = N.stations
    .filter((station) => station.z > N.split[0] + 0.05)
    .map((station) => ({
      ...station,
      z: cFront + (station.z - N.split[0]) * (0.5 + 0.5 * kn),
      w: station.w * kn,
      top: station.top * kn,
      bottom: station.bottom * kn,
      y: front.y + ((station.y ?? 0) - noseJoint.y) * kn,
    }));
  // Each donor's own section right at the splice, so the skin steps there instead of blending.
  const scaled = (sample: BodySample, z: number, k: number, y: number): BodyStation => ({
    z,
    w: sample.w * k,
    top: sample.top * k,
    bottom: sample.bottom * k,
    y,
    square: sample.square,
  });
  if (noseVisual !== cabinVisual) nose.push(scaled(noseJoint, cFront + 0.04, kn, front.y));
  const cabin: BodyStation[] = [
    front,
    ...C.stations.filter((station) => station.z < cFront - 0.05 && station.z > cBack + 0.05),
    back,
  ];
  const boom: BodyStation[] = B.stations
    .filter((station) => station.z < B.split[1] - 0.05)
    .map((station) => ({
      ...station,
      z: cBack + (station.z - B.split[1]),
      w: station.w * kb,
      top: station.top * kb,
      bottom: station.bottom * kb,
      y: back.y + ((station.y ?? 0) - boomJoint.y) * kb,
    }));
  if (boomVisual !== cabinVisual) boom.unshift(scaled(boomJoint, cBack - 0.04, kb, back.y));
  const boomZ = (z: number) => cBack + (z - B.split[1]);
  const boomY = (y: number) => back.y + (y - boomJoint.y) * kb;
  return {
    ...C,
    stations: [...nose, ...cabin, ...boom],
    split: [cFront, cBack],
    noseCap: N.noseCap * (0.5 + 0.5 * kn),
    glazedNose: N.glazedNose,
    cowl: N.cowl,
    prop: N.prop,
    tail: {
      le: boomZ(B.tail.le),
      y: boomY(B.tail.y),
      finY: boomY(B.tail.finY),
      scale: B.tail.scale * Math.sqrt(kb),
    },
    gear: { ...C.gear, tailZ: boomZ(B.gear.tailZ), tailY: boomY(B.gear.tailY) },
    mast: C.mast ? { z: Math.max(C.mast.z, cBack + 0.3) } : undefined,
    joints,
  };
};

/** The shape a build is drawn with: stock aircraft use their own; a Workshop Special composes one. */
export const shapeForBuild = (build: {
  airframe: string;
  nose: string;
  cabin: string;
  boom: string;
}): AirframeShape => {
  const airframe = getAirframe(build.airframe);
  if (airframe && airframe.visual !== 'custom') return SHAPES[airframe.visual];
  return composeShape(
    visualOf('nose', build.nose) ?? 'sport',
    visualOf('cabin', build.cabin) ?? 'sport',
    visualOf('boom', build.boom) ?? 'sport',
  );
};

/** The shape of a stock airframe (a Workshop Special shows its starting Meridian sections). */
export const shapeFor = (airframe: Airframe): AirframeShape =>
  airframe.visual === 'custom' ? SHAPES.sport : SHAPES[airframe.visual];
