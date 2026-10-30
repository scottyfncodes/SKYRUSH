import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { resolveBuild, type AircraftSetup, type ResolvedBuild } from '../aircraft/build';
import { factoryPaint, swatchColor, type Paint } from '../aircraft/paint';
import { getAirframe, type SectionPart, type WingPart } from '../aircraft/parts';
import { createGlowMaterial } from './materials';
import { shapeForBuild, type AirframeShape } from './aircraft/airframes';
import {
  StaticBatch,
  bodyPoint,
  loftSurface,
  mirrorX,
  revolve,
  rodMatrix,
  sampleBody,
  sculptBody,
  stationAt,
  stationsBetween,
  upperSurfaceY,
  type BodyStation,
  type SurfaceStation,
} from './aircraft/geometry';
import { createBodyTexture, createInsigniaTexture, createPropDiscTexture } from './aircraft/livery';

/**
 * Procedural aircraft assembly from a build and its paint.
 * Local frame: +Z nose, +Y up, +X pilot's left. Units are metres.
 * Every slot of the build changes real geometry: airframe silhouette, frame
 * finish, cowl and exhausts, propeller blades and spinner, wing planform and
 * tips, tail layout and landing gear. Static parts are merged per material.
 */

export interface PropHandle {
  spin: Object3D;
  blades: MeshStandardMaterial;
  disc: Mesh;
}

export interface AircraftModelHandles {
  root: Group;
  /** Exhaust flames: scaled along local Z by throttle and boost. */
  exhausts: Mesh[];
  glows: Mesh[];
  /** Control surfaces; each rotates about its local X (hinge) axis. */
  ailerons: { left: Object3D; right: Object3D };
  elevators: Object3D[];
  rudders: Object3D[];
  airbrakes: Object3D[];
  props: PropHandle[];
  /** Retractable gear legs (rotation.z folds them inward), empty for fixed gear. */
  gearLegs: { pivot: Object3D; side: 1 | -1 }[];
  /** Materials with emissive accents; index 1 glows when the engine overheats. */
  accentMaterials: MeshStandardMaterial[];
  engineMaterials: MeshStandardMaterial[];
  /** Wingtip positions in the aircraft's local frame (contrail emitters). */
  wingtips: Vector3[];
  /** How the aircraft sits on the ground: lowest contact height and nose-up rest angle. */
  stance: { ground: number; restPitch: number };
  /** Bounding radius about the origin (m), for framing. */
  radius: number;
  dispose: () => void;
}

export interface AircraftModelOptions {
  envMap?: Texture | null;
}

const X_AXIS = new Vector3(1, 0, 0);

const unitCylinder = new CylinderGeometry(1, 1, 1, 8, 1);
const unitSphere = new SphereGeometry(1, 16, 12);
const rivetHead = new SphereGeometry(1, 6, 4);

/** Materials for one aircraft. Everything created here is disposed with the model. */
class Paints {
  readonly list: Material[] = [];
  readonly textures: Texture[] = [];
  private readonly byColor = new Map<string, MeshStandardMaterial>();

  constructor(private readonly envMap: Texture | null) {}

  track<M extends Material>(material: M): M {
    if (material instanceof MeshStandardMaterial && this.envMap) {
      material.envMap = this.envMap;
      material.envMapIntensity = material.envMapIntensity ?? 1;
    }
    this.list.push(material);
    return material;
  }

  /** Enamel paint in a colour (shared within the aircraft). */
  enamel(color: number, roughness = 0.36): MeshStandardMaterial {
    const key = `${color}:${roughness}`;
    let material = this.byColor.get(key);
    if (!material) {
      material = this.track(
        new MeshStandardMaterial({ color, roughness, metalness: 0.12, envMapIntensity: 0.8 }),
      );
      this.byColor.set(key, material);
    }
    return material;
  }

  /** Doped fabric for control surfaces: a touch darker and matte. */
  fabric(color: number): MeshStandardMaterial {
    const key = `fabric:${color}`;
    let material = this.byColor.get(key);
    if (!material) {
      const tinted = darken(color, 0.9);
      material = this.track(
        new MeshStandardMaterial({ color: tinted, roughness: 0.78, metalness: 0, envMapIntensity: 0.35 }),
      );
      this.byColor.set(key, material);
    }
    return material;
  }
}

const darken = (color: number, factor: number): number => {
  const r = Math.round(((color >> 16) & 255) * factor);
  const g = Math.round(((color >> 8) & 255) * factor);
  const b = Math.round((color & 255) * factor);
  return (r << 16) | (g << 8) | b;
};

/** Pivot whose local X runs along a hinge from `a` to `b` (both in the aircraft frame). */
const hingePivot = (a: Vector3, b: Vector3): Object3D => {
  const pivot = new Object3D();
  pivot.position.copy(a);
  pivot.quaternion.setFromUnitVectors(X_AXIS, new Vector3().subVectors(b, a).normalize());
  pivot.updateMatrix();
  return pivot;
};

/** Mirror of a left-side pivot for the right side (same deflection angle gives a mirrored pose). */
const mirrorPivot = (pivot: Object3D): Object3D => {
  const mirrored = new Object3D();
  mirrored.position.set(-pivot.position.x, pivot.position.y, pivot.position.z);
  const q = pivot.quaternion;
  mirrored.quaternion.set(q.x, -q.y, -q.z, q.w);
  mirrored.updateMatrix();
  return mirrored;
};

/** Puts a world-space geometry under a pivot (left) and its mirror (right). */
const attachToPivots = (
  geometry: BufferGeometry,
  pivot: Object3D,
  material: Material,
  mirror: boolean,
): { left: Object3D; right: Object3D | null } => {
  const inverse = new Matrix4().copy(pivot.matrix).invert();
  const local = geometry.clone().applyMatrix4(inverse);
  local.computeVertexNormals();
  const flapLeft = new Object3D();
  pivot.add(flapLeft);
  const leftMesh = new Mesh(local, material);
  leftMesh.castShadow = true;
  flapLeft.add(leftMesh);
  let right: Object3D | null = null;
  if (mirror) {
    const rightPivot = mirrorPivot(pivot);
    const flapRight = new Object3D();
    rightPivot.add(flapRight);
    const rightMesh = new Mesh(mirrorX(local), material);
    rightMesh.castShadow = true;
    flapRight.add(rightMesh);
    right = flapRight;
    (flapLeft.userData as { partner?: Object3D }).partner = rightPivot;
  }
  geometry.dispose();
  return { left: flapLeft, right };
};

// --- Wing planforms --------------------------------------------------------------------------

interface Planform {
  stations: SurfaceStation[];
  span: number;
}

const wingPlanform = (visual: WingPart['visual'], scale: number, rootLe: number, y: number): Planform => {
  const span = visual.span * scale;
  const rc = visual.rootChord * scale;
  const tc = visual.tipChord * scale;
  const sweep = visual.sweep * scale;
  const camber = visual.planform === 'plank' || visual.planform === 'glider' ? 0.035 : 0.018;
  const stations: SurfaceStation[] = [];
  const samples = 16;
  for (let i = 0; i <= samples; i += 1) {
    // Denser sampling toward the tip where shapes change fastest.
    const s = 1 - (1 - i / samples) ** 1.4;
    const x = s * span;
    let chord: number;
    let le: number;
    if (visual.planform === 'elliptic') {
      chord = Math.max(tc, rc * Math.sqrt(Math.max(0, 1 - s * s)));
      le = rootLe - sweep * s * s - (rc - chord) * 0.28;
    } else {
      chord = rc + (tc - rc) * s;
      le = rootLe - sweep * s;
    }
    if (visual.tip === 'round' && s > 0.86) {
      const k = (s - 0.86) / 0.14;
      const shrink = Math.max(0.18, Math.sqrt(Math.max(0, 1 - k * k)));
      le -= chord * (1 - shrink) * 0.45;
      chord *= shrink;
    }
    if (visual.tip === 'raked' && s > 0.86) {
      const k = (s - 0.86) / 0.14;
      le -= k * chord * 0.5;
      chord *= 1 - k * 0.5;
    }
    stations.push({
      x,
      y: y + x * Math.tan(visual.dihedral),
      le,
      chord,
      t: 0.135 - 0.04 * s,
      camber,
    });
  }
  return { stations, span };
};

// --- Model ---------------------------------------------------------------------------------

export const buildAircraftModel = (
  setup: AircraftSetup,
  options: AircraftModelOptions = {},
): AircraftModelHandles => {
  const resolved = resolveBuild(setup.build);
  return assemble(
    resolved,
    shapeForBuild(setup.build),
    setup.paint,
    setup.marks ?? 0,
    options.envMap ?? null,
  );
};

const assemble = (
  r: ResolvedBuild,
  shape: AirframeShape,
  paint: Paint,
  marks: number,
  envMap: Texture | null,
): AircraftModelHandles => {
  const { airframe, frame, engine, prop, wings, tail, gear } = r;
  const root = new Group();
  root.name = `aircraft-${airframe.id}`;
  const paints = new Paints(envMap);
  const batch = new StaticBatch();
  const geometries: BufferGeometry[] = [];
  const keep = <G extends BufferGeometry>(g: G): G => {
    geometries.push(g);
    return g;
  };

  // Colours.
  const primaryColor = swatchColor(paint.primary);
  const primary = paints.enamel(primaryColor, frame.visual === 'composite' ? 0.24 : 0.36);
  const secondary = paints.enamel(swatchColor(paint.secondary));
  const accent = paints.enamel(swatchColor(paint.accent), 0.32);
  const tips = paints.enamel(swatchColor(paint.tips), 0.32);
  const noseMat = paints.enamel(swatchColor(paint.nose), 0.3);
  const fabric = paints.fabric(frame.visual === 'light' ? primaryColor : swatchColor(paint.secondary));

  // As salvaged, the cabin wears the owner's paint and sections spliced on from
  // other aircraft keep the factory paint they came with.
  const salvage = paint.pattern === 'salvage';
  const donorPaint = (section: SectionPart): Paint =>
    salvage && section.source !== r.cabin.source ? factoryPaint(section.source) : paint;
  const nosePaint = donorPaint(r.nose);
  const boomPaint = donorPaint(r.boom);
  const cowlSkin = paints.enamel(swatchColor(nosePaint.primary), frame.visual === 'composite' ? 0.24 : 0.36);
  const cowlRing = paints.enamel(swatchColor(nosePaint.nose), 0.3);
  const tailSkin = paints.enamel(swatchColor(boomPaint.primary), frame.visual === 'composite' ? 0.24 : 0.36);
  const tailFabric = paints.fabric(swatchColor(boomPaint.primary));
  const tailTips = paints.enamel(swatchColor(boomPaint.tips), 0.32);
  const darkMetal = paints.track(
    new MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.5, metalness: 0.75, envMapIntensity: 0.9 }),
  );
  const aluminium = paints.track(
    new MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.3, metalness: 0.85, envMapIntensity: 1.1 }),
  );
  const rubber = paints.track(new MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.92, metalness: 0 }));
  const glass = paints.track(
    new MeshStandardMaterial({
      color: 0x1b3140,
      roughness: 0.06,
      metalness: 0.35,
      transparent: true,
      opacity: 0.62,
      envMapIntensity: 1.6,
      depthWrite: false,
    }),
  );
  const leather = paints.track(new MeshStandardMaterial({ color: 0x6a452c, roughness: 0.7 }));
  const heatMaterial = paints.track(
    new MeshStandardMaterial({
      color: 0x3a302a,
      roughness: 0.6,
      metalness: 0.6,
      emissive: 0xff5a1f,
      emissiveIntensity: 0,
    }),
  );
  const navRed = paints.track(new MeshBasicMaterial({ color: 0xff3a2a }));
  const navGreen = paints.track(new MeshBasicMaterial({ color: 0x41f08a }));
  const exhaustMaterial = paints.track(createGlowMaterial(0xff9a3a, 0.5));
  const glowMaterial = paints.track(createGlowMaterial(0xffc46a, 0.4));

  const exhausts: Mesh[] = [];
  const glows: Mesh[] = [];
  const elevators: Object3D[] = [];
  const rudders: Object3D[] = [];
  const airbrakes: Object3D[] = [];
  const props: PropHandle[] = [];
  const gearLegs: { pivot: Object3D; side: 1 | -1 }[] = [];
  const ailerons = { left: new Object3D(), right: new Object3D() };

  /** Adds a static geometry to both sides (mirrored) or once. */
  const addStatic = (geometry: BufferGeometry, material: Material, mirror = false) => {
    batch.add(geometry, material);
    if (mirror) batch.add(mirrorX(geometry), material);
  };
  const rod = (from: Vector3, to: Vector3, radius: number, material: Material, mirror = false) => {
    const m = rodMatrix(from, to, radius);
    batch.add(unitCylinder, material, m);
    if (mirror) batch.add(unitCylinder, material, new Matrix4().makeScale(-1, 1, 1).multiply(m));
  };

  const engineInNose = !engine.visual.twin && !shape.pylon;

  // --- Fuselage ---------------------------------------------------------------------------
  const firewall = shape.stations[0]!;
  const bodyStations: BodyStation[] = [...shape.stations];
  let noseStations: BodyStation[] = [];
  if (!engineInNose) {
    const L = shape.noseCap;
    noseStations = [
      { z: firewall.z + L, w: 0.03, top: 0.03, bottom: 0.03, y: (firewall.y ?? 0) - 0.04 },
      {
        z: firewall.z + L * 0.82,
        w: firewall.w * 0.62,
        top: firewall.top * 0.58,
        bottom: firewall.bottom * 0.62,
        y: (firewall.y ?? 0) - 0.03,
      },
      {
        z: firewall.z + L * 0.45,
        w: firewall.w * 0.92,
        top: firewall.top * 0.9,
        bottom: firewall.bottom * 0.92,
        y: firewall.y ?? 0,
      },
      firewall,
    ];
    if (!shape.glazedNose) bodyStations.unshift(...noseStations.slice(0, 3));
  }
  const bodyNoseZ = bodyStations[0]!.z;
  const bodyTailZ = bodyStations[bodyStations.length - 1]!.z;
  const bodyLength = bodyNoseZ - bodyTailZ;
  const widest = shape.stations.reduce((m, s) => Math.max(m, s.w + (s.top + s.bottom) / 2), 0);
  const registrationOf = (designation: string, number: number) =>
    `SR-${designation}·${String(number).padStart(2, '0')}`;
  const designationOf = (section: SectionPart) => getAirframe(section.source)?.designation ?? '';
  const splitV = (z: number) => Math.min(1, Math.max(0, (bodyNoseZ - z) / bodyLength));
  const donors = [
    { section: r.nose, paint: nosePaint, v0: 0, v1: splitV(shape.split[0]) },
    { section: r.boom, paint: boomPaint, v0: splitV(shape.split[1]), v1: 1 },
  ]
    .filter((donor) => donor.paint !== paint)
    .map(({ section, paint: donor, v0, v1 }) => ({
      v0,
      v1,
      paint: donor,
      registration: registrationOf(designationOf(section), donor.number),
    }));
  const special = r.nose.source !== r.cabin.source || r.boom.source !== r.cabin.source;
  const bodyTexture = createBodyTexture({
    paint,
    frame: frame.visual,
    length: bodyLength,
    circumference: Math.PI * widest,
    registration: registrationOf(airframe.designation, paint.number),
    canopyV: (bodyNoseZ - shape.canopy.z) / bodyLength,
    donors,
    seams: (shape.joints ?? []).map(splitV),
    plate: special
      ? [
          `NOSE  ${designationOf(r.nose)}`,
          `CABIN ${designationOf(r.cabin)}`,
          `BOOM  ${designationOf(r.boom)}`,
        ]
      : undefined,
    exhaustStains: engineInNose,
    marks,
  });
  paints.textures.push(bodyTexture);
  const bodyMaterial = paints.track(
    new MeshStandardMaterial({
      map: bodyTexture,
      roughness: frame.visual === 'composite' ? 0.26 : frame.visual === 'light' ? 0.5 : 0.36,
      metalness: 0.12,
      envMapIntensity: 0.8,
    }),
  );
  addStatic(sculptBody(bodyStations), bodyMaterial);

  if (shape.glazedNose && noseStations.length) {
    // Glazed bombardier-style nose with framing ribs.
    addStatic(sculptBody(noseStations, 14, 24), glass);
    for (const k of [0.3, 0.62]) {
      const s = sampleBody(noseStations, firewall.z + shape.noseCap * k);
      const ring = new TorusGeometry(1, 0.035, 5, 28);
      ring.scale(s.w, (s.top + s.bottom) / 2, 1 / Math.max(s.w, 0.1));
      ring.translate(0, s.y + (s.top - s.bottom) / 2, s.z);
      addStatic(ring, darkMetal);
    }
    const spine = new BoxGeometry(0.04, 0.04, shape.noseCap * 0.9);
    spine.translate(0, (firewall.y ?? 0) + firewall.top * 0.75, firewall.z + shape.noseCap * 0.42);
    addStatic(spine, darkMetal);
  }

  const bodyAt = (z: number) => sampleBody(bodyStations, z);
  const topAt = (z: number) => {
    const s = bodyAt(z);
    return s.y + s.top;
  };
  const bottomAt = (z: number) => {
    const s = bodyAt(z);
    return s.y - s.bottom;
  };

  // Splices: a bare-metal collar over each joint, wide enough to cover the step
  // between two aircraft's sections, with a row of rivets along each edge.
  for (const z of shape.joints ?? []) {
    const half = 0.11;
    const around = [z + half + 0.05, z + half, z, z - half, z - half - 0.05].map(bodyAt);
    const w = Math.max(...around.map((s) => s.w)) * 1.04 + 0.012;
    const top = Math.max(...around.map((s) => s.top)) * 1.04 + 0.012;
    const bottom = Math.max(...around.map((s) => s.bottom)) * 1.04 + 0.012;
    const at = (zz: number): BodyStation => {
      const s = bodyAt(zz);
      return { z: zz, w, top, bottom, y: s.y, square: s.square };
    };
    const tuck = (zz: number): BodyStation => {
      const s = bodyAt(zz);
      return { z: zz, w: s.w * 0.98, top: s.top * 0.98, bottom: s.bottom * 0.98, y: s.y, square: s.square };
    };
    const collar = [tuck(z + half + 0.03), at(z + half), at(z - half), tuck(z - half - 0.03)];
    addStatic(sculptBody(collar, 6, 28), aluminium);
    const point = new Vector3();
    for (const edge of [z + half - 0.035, z - half + 0.035]) {
      const s = sampleBody(collar, edge);
      for (let j = 0; j < 18; j += 1) {
        bodyPoint(s, ((j + 0.5) / 18) * Math.PI * 2, point);
        batch.add(
          rivetHead,
          darkMetal,
          new Matrix4()
            .makeTranslation(point.x, point.y, point.z)
            .multiply(new Matrix4().makeScale(0.018, 0.018, 0.018)),
        );
      }
    }
  }

  // --- Canopy -----------------------------------------------------------------------------
  const canopy = shape.canopy;
  if (canopy.kind === 'bubble') {
    const bubble = new SphereGeometry(1, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
    bubble.scale(canopy.width / 2, canopy.height, canopy.length / 2);
    bubble.translate(0, canopy.y, canopy.z);
    addStatic(bubble, glass);
    // Frame bows.
    for (const k of [0.32, -0.1]) {
      const along = k * canopy.length;
      const factor = Math.sqrt(Math.max(0.05, 1 - (along / (canopy.length / 2)) ** 2));
      const bow = new TorusGeometry(1, 0.028, 5, 24, Math.PI);
      bow.scale((canopy.width / 2) * factor, canopy.height * factor, 1);
      bow.translate(0, canopy.y, canopy.z + along);
      addStatic(bow, darkMetal);
    }
    if (canopy.pilot) {
      const head = unitSphere.clone();
      head.scale(0.16, 0.18, 0.17);
      head.translate(0, canopy.y + 0.16, canopy.z - canopy.length * 0.08);
      addStatic(head, leather);
      const goggles = new TorusGeometry(0.07, 0.02, 5, 12);
      for (const side of [-1, 1]) {
        const g = goggles.clone();
        g.translate(side * 0.065, canopy.y + 0.2, canopy.z - canopy.length * 0.08 + 0.15);
        addStatic(g, darkMetal);
      }
      goggles.dispose();
    }
    // Turtle deck fairing behind the canopy.
    const deckStart = canopy.z - canopy.length * 0.42;
    const deckEnd = Math.max(bodyTailZ + 1, deckStart - 2.2);
    const deck: BodyStation[] = [];
    for (let i = 0; i <= 4; i += 1) {
      const z = deckStart + (deckEnd - deckStart) * (i / 4);
      const f = 1 - i / 4;
      deck.push({
        z,
        w: 0.05 + canopy.width * 0.36 * f,
        top: 0.02 + canopy.height * 0.55 * f,
        bottom: 0.05,
        y: topAt(z) - 0.04,
      });
    }
    addStatic(sculptBody(deck, 10, 14), primary);
  } else if (canopy.kind === 'cabin') {
    // Flat side windows on the boxy cabin, and a raked windscreen.
    const s = bodyAt(canopy.z);
    const side = new BoxGeometry(0.02, canopy.height, canopy.length);
    side.translate(s.w + 0.006, canopy.y + canopy.height / 2, canopy.z);
    addStatic(side, glass, true);
    const frameBar = new BoxGeometry(0.03, canopy.height + 0.04, 0.05);
    for (const dz of [-canopy.length / 2, 0, canopy.length / 2]) {
      const bar = frameBar.clone();
      bar.translate(s.w + 0.012, canopy.y + canopy.height / 2, canopy.z + dz);
      addStatic(bar, darkMetal, true);
    }
    frameBar.dispose();
    const top = topAt(canopy.windscreen);
    const screen = new BoxGeometry(bodyAt(canopy.windscreen).w * 1.7, 0.02, 0.75);
    screen.rotateX(-0.75);
    screen.translate(0, top - 0.06, canopy.windscreen + 0.12);
    addStatic(screen, glass);
  } else {
    // Stepped windscreen and a row of cabin windows.
    const top = topAt(canopy.z);
    for (const side of [-1, 1]) {
      const pane = new BoxGeometry(canopy.width * 0.5, 0.02, 0.62);
      pane.rotateX(-0.85);
      pane.rotateY(side * 0.32);
      pane.translate(side * canopy.width * 0.24, top - 0.02, canopy.z + 0.02);
      addStatic(pane, glass);
    }
    const sill = new BoxGeometry(canopy.width, 0.05, 0.06);
    sill.translate(0, top - 0.22, canopy.z + 0.28);
    addStatic(sill, darkMetal);
    for (let i = 0; i < canopy.windows; i += 1) {
      const z = canopy.z - 1.5 - i * 0.78;
      const s = bodyAt(z);
      const window = new BoxGeometry(0.025, 0.26, 0.38);
      window.translate(s.w * 0.985, s.y + 0.22, z);
      addStatic(window, glass, true);
    }
  }

  // --- Wings ------------------------------------------------------------------------------
  const wingPlan = wingPlanform(wings.visual, airframe.wingScale, shape.wing.le, shape.wing.y);
  const ws = wingPlan.stations;
  const span = wingPlan.span;
  const aileronFrom = span * 0.5;
  const aileronTo = span * 0.86;
  const tipFrom = span * 0.9;
  const hingeAt = 0.72;
  const addPanel = (x0: number, x1: number, c0: number, c1: number, material: Material) =>
    addStatic(loftSurface(stationsBetween(ws, x0, x1), c0, c1), material, true);
  addPanel(0, aileronFrom, 0, 1, primary);
  addPanel(aileronFrom, aileronTo, 0, hingeAt, primary);
  addPanel(aileronTo, tipFrom, 0, 1, primary);
  addPanel(tipFrom, span, 0, 1, tips);
  {
    const a = stationAt(ws, aileronFrom + 0.02);
    const b = stationAt(ws, aileronTo - 0.02);
    const hingeA = new Vector3(a.x, a.y + (a.camber ?? 0) * a.chord, a.le - hingeAt * a.chord);
    const hingeB = new Vector3(b.x, b.y + (b.camber ?? 0) * b.chord, b.le - hingeAt * b.chord);
    const pivot = hingePivot(hingeA, hingeB);
    const flap = loftSurface(stationsBetween(ws, aileronFrom + 0.02, aileronTo - 0.02), hingeAt, 1);
    const { left, right } = attachToPivots(flap, pivot, fabric, true);
    root.add(pivot, (left.userData as { partner: Object3D }).partner);
    ailerons.left = left;
    ailerons.right = right!;
  }
  // Spoiler airbrakes on the inner upper surface.
  {
    const a = stationAt(ws, span * 0.2);
    const b = stationAt(ws, span * 0.4);
    const hingeA = new Vector3(a.x, upperSurfaceY(a, 0.4) + 0.005, a.le - 0.4 * a.chord);
    const hingeB = new Vector3(b.x, upperSurfaceY(b, 0.4) + 0.005, b.le - 0.4 * b.chord);
    const pivot = hingePivot(hingeA, hingeB);
    const plate = new BoxGeometry(hingeA.distanceTo(hingeB), 0.025, 0.32);
    plate.translate(0, 0.012, -0.16);
    plate.applyMatrix4(pivot.matrix);
    const { left, right } = attachToPivots(plate, pivot, primary, true);
    root.add(pivot, (left.userData as { partner: Object3D }).partner);
    airbrakes.push(left, right!);
  }
  // Wing tip devices.
  const tipStation = ws[ws.length - 1]!;
  if (wings.visual.tip === 'endplate') {
    const plate: SurfaceStation[] = [
      { x: -0.35, y: 0, le: tipStation.le + 0.08, chord: tipStation.chord * 1.08, t: 0.06 },
      { x: 0.35, y: 0, le: tipStation.le + 0.02, chord: tipStation.chord * 0.9, t: 0.06 },
    ];
    const g = loftSurface(plate);
    g.applyMatrix4(new Matrix4().makeRotationZ(Math.PI / 2));
    g.translate(tipStation.x + 0.02, tipStation.y, 0);
    addStatic(g, tips, true);
  } else if (wings.visual.tip === 'winglet') {
    const winglet: SurfaceStation[] = [
      { x: 0, y: 0, le: tipStation.le, chord: tipStation.chord, t: 0.08 },
      { x: 0.6, y: 0, le: tipStation.le - 0.3, chord: tipStation.chord * 0.45, t: 0.08 },
    ];
    const g = loftSurface(winglet);
    g.applyMatrix4(new Matrix4().makeRotationZ(Math.PI / 2 - 0.25));
    g.translate(tipStation.x - 0.02, tipStation.y, 0);
    addStatic(g, tips, true);
  }
  if (wings.visual.planform === 'plank') {
    // Flap track fairings under the high-lift wing.
    for (const k of [0.22, 0.4, 0.62, 0.8]) {
      const s = stationAt(ws, span * k);
      const fairing = new BoxGeometry(0.08, 0.12, s.chord * 0.42);
      fairing.translate(s.x, s.y - 0.08, s.le - s.chord * 0.86);
      addStatic(fairing, darkMetal, true);
    }
  }
  // Navigation lights: red on the left (port) tip, green on the right.
  {
    const light = unitSphere.clone();
    light.scale(0.05, 0.05, 0.07);
    light.translate(tipStation.x + 0.02, tipStation.y, tipStation.le - tipStation.chord * 0.25);
    batch.add(light, navRed);
    batch.add(mirrorX(light), navGreen);
  }
  // Pitot tube under the left wing.
  {
    const s = stationAt(ws, span * 0.72);
    rod(
      new Vector3(s.x, s.y - 0.06, s.le - 0.1),
      new Vector3(s.x, s.y - 0.06, s.le + 0.45),
      0.018,
      darkMetal,
    );
  }
  const wingtips = [
    new Vector3(tipStation.x, tipStation.y, tipStation.le - tipStation.chord * 0.5),
    new Vector3(-tipStation.x, tipStation.y, tipStation.le - tipStation.chord * 0.5),
  ];

  // Lift struts (high wing) and cabane struts (parasol).
  if (shape.wing.mount === 'high' && shape.wing.struts) {
    const meet = stationAt(ws, span * shape.wing.struts);
    const base = bodyAt(meet.le - meet.chord * 0.4);
    const foot = new Vector3(base.w * 0.82, bottomAt(base.z) + 0.25, base.z);
    rod(foot, new Vector3(meet.x, meet.y - 0.05, meet.le - meet.chord * 0.2), 0.045, secondary, true);
    rod(foot, new Vector3(meet.x, meet.y - 0.05, meet.le - meet.chord * 0.7), 0.045, secondary, true);
    const jury = stationAt(ws, span * shape.wing.struts * 0.55);
    rod(
      new Vector3(jury.x, jury.y - 0.05, jury.le - jury.chord * 0.45),
      new Vector3(jury.x * 0.85, foot.y + (jury.y - foot.y) * 0.4, jury.le - jury.chord * 0.45),
      0.025,
      darkMetal,
      true,
    );
  }
  if (shape.wing.mount === 'parasol') {
    const front = stationAt(ws, 0.55);
    for (const k of [0.2, 0.7]) {
      const z = front.le - front.chord * k;
      const s = bodyAt(z);
      rod(
        new Vector3(s.w * 0.55, topAt(z) - 0.05, z),
        new Vector3(0.55, front.y - 0.04, z + 0.15),
        0.04,
        darkMetal,
        true,
      );
    }
  }

  // Biplane: the upper wing, staggered forward on cabane struts, braced by N-struts and flying wires.
  const upper = shape.wing.upper;
  if (upper) {
    const upperPlan = wingPlanform(
      wings.visual,
      airframe.wingScale * 1.05,
      shape.wing.le + upper.stagger,
      upper.y,
    );
    const us = upperPlan.stations;
    const upperSpan = upperPlan.span;
    const tipStart = upperSpan * 0.9;
    addStatic(loftSurface(stationsBetween(us, 0, tipStart), 0, 1), primary, true);
    addStatic(loftSurface(stationsBetween(us, tipStart, upperSpan), 0, 1), tips, true);
    // Cabane struts from the fuselage top to the centre section.
    const centre = stationAt(us, 0.45);
    for (const k of [0.15, 0.75]) {
      const z = centre.le - centre.chord * k - upper.stagger * 0.5;
      rod(
        new Vector3(bodyAt(z).w * 0.5, topAt(z) - 0.04, z),
        new Vector3(0.45, centre.y - 0.03, centre.le - centre.chord * k),
        0.035,
        darkMetal,
        true,
      );
    }
    // Interplane N-struts.
    const top = stationAt(us, upperSpan * upper.struts);
    const bottom = stationAt(ws, Math.min(span * 0.95, upperSpan * upper.struts));
    const topFront = new Vector3(top.x, top.y - 0.03, top.le - top.chord * 0.18);
    const topBack = new Vector3(top.x, top.y - 0.03, top.le - top.chord * 0.78);
    const bottomFront = new Vector3(bottom.x, upperSurfaceY(bottom, 0.18), bottom.le - bottom.chord * 0.18);
    const bottomBack = new Vector3(bottom.x, upperSurfaceY(bottom, 0.78), bottom.le - bottom.chord * 0.78);
    rod(bottomFront, topFront, 0.04, secondary, true);
    rod(bottomBack, topBack, 0.04, secondary, true);
    rod(bottomBack, topFront, 0.03, secondary, true);
    // Flying and landing wires: thin diagonals from the struts to the fuselage.
    const rootLow = stationAt(ws, 0.5);
    const rootHigh = stationAt(us, 0.5);
    rod(
      new Vector3(rootLow.x, rootLow.y, rootLow.le - rootLow.chord * 0.4),
      topFront,
      0.008,
      darkMetal,
      true,
    );
    rod(
      new Vector3(rootHigh.x, rootHigh.y, rootHigh.le - rootHigh.chord * 0.4),
      bottomBack,
      0.008,
      darkMetal,
      true,
    );
  }

  // Insignia decals on the wings.
  const insignia = createInsigniaTexture(paint);
  if (insignia) {
    paints.textures.push(insignia);
    const decal = paints.track(
      new MeshStandardMaterial({
        map: insignia,
        transparent: true,
        alphaTest: 0.3,
        roughness: 0.4,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        side: DoubleSide,
      }),
    );
    const s = stationAt(ws, span * 0.66);
    const radius = Math.min(0.42, s.chord * 0.36);
    const disc = new CircleGeometry(radius, 24);
    disc.rotateX(-Math.PI / 2);
    disc.translate(s.x, upperSurfaceY(s, 0.42) + 0.008, s.le - s.chord * 0.45);
    addStatic(disc, decal, true);
  }

  // --- Tail ---------------------------------------------------------------------------------
  const ts = shape.tail.scale * (tail.visual === 'big' ? 1.25 : 1);
  const stabSpan = 1.6 * ts * (tail.visual === 'twin' ? 1.12 : tail.visual === 'vee' ? 1.2 : 1);
  const stabStations: SurfaceStation[] = [];
  for (let i = 0; i <= 6; i += 1) {
    const s = i / 6;
    const chord = (1.05 - 0.42 * s) * ts * (tail.visual === 'vee' ? 1.05 : 1);
    stabStations.push({
      x: s * stabSpan,
      y: 0,
      le: shape.tail.le - 0.3 * ts * s - (s > 0.85 ? (s - 0.85) * 1.4 * chord : 0),
      chord: s > 0.85 ? chord * (1 - (s - 0.85) * 2.4) : chord,
      t: 0.1,
    });
  }
  const stabMatrix = new Matrix4()
    .makeTranslation(0, shape.tail.y, 0)
    .multiply(new Matrix4().makeRotationZ(tail.visual === 'vee' ? 0.62 : 0));
  const elevHinge = 0.64;
  const addTailSurface = (
    stations: SurfaceStation[],
    matrix: Matrix4,
    hingeFrom: number,
    hingeTo: number,
    hinge: number,
    mirror: boolean,
    mainMaterial: Material,
  ): { left: Object3D; right: Object3D | null } => {
    const x0 = stations[0]!.x;
    const x1 = stations[stations.length - 1]!.x;
    const parts: [number, number, number, number][] = [
      [x0, hingeFrom, 0, 1],
      [hingeFrom, hingeTo, 0, hinge],
      [hingeTo, x1, 0, 1],
    ];
    for (const [a, b, c0, c1] of parts) {
      if (b - a < 0.01) continue;
      const g = loftSurface(stationsBetween(stations, a, b), c0, c1, 5);
      g.applyMatrix4(matrix);
      addStatic(g, mainMaterial, mirror);
    }
    const a = stationAt(stations, hingeFrom + 0.01);
    const b = stationAt(stations, hingeTo - 0.01);
    const hingeA = new Vector3(a.x, a.y, a.le - hinge * a.chord).applyMatrix4(matrix);
    const hingeB = new Vector3(b.x, b.y, b.le - hinge * b.chord).applyMatrix4(matrix);
    const pivot = hingePivot(hingeA, hingeB);
    const surface = loftSurface(stationsBetween(stations, hingeFrom + 0.01, hingeTo - 0.01), hinge, 1, 4);
    surface.applyMatrix4(matrix);
    const attached = attachToPivots(surface, pivot, tailFabric, mirror);
    root.add(pivot);
    if (mirror) root.add((attached.left.userData as { partner: Object3D }).partner);
    return attached;
  };
  {
    const { left, right } = addTailSurface(
      stabStations,
      stabMatrix,
      0.12 * ts,
      stabSpan * 0.9,
      elevHinge,
      true,
      tailSkin,
    );
    elevators.push(left, right!);
    if (tail.visual === 'vee') rudders.push(left, right!);
  }
  const finHeight = 1.3 * ts;
  if (tail.visual === 'standard' || tail.visual === 'big') {
    const finStations: SurfaceStation[] = [];
    for (let i = 0; i <= 7; i += 1) {
      const s = i / 7;
      let chord = (1.4 - 0.75 * s) * ts;
      let le = shape.tail.le + 0.55 * ts - 0.62 * ts * s;
      if (s > 0.7) {
        const k = (s - 0.7) / 0.3;
        const shrink = Math.max(0.2, Math.sqrt(Math.max(0, 1 - k * k)));
        le -= chord * (1 - shrink) * 0.55;
        chord *= shrink;
      }
      finStations.push({ x: s * finHeight - 0.1, y: 0, le, chord, t: 0.1 });
    }
    const finMatrix = new Matrix4()
      .makeTranslation(0, shape.tail.finY, 0)
      .multiply(new Matrix4().makeRotationZ(Math.PI / 2));
    const finTipFrom = finHeight * 0.8;
    const { left } = addTailSurface(finStations, finMatrix, 0.05, finTipFrom - 0.05, 0.6, false, tailSkin);
    rudders.push(left);
    const tipGeometry = loftSurface(stationsBetween(finStations, finTipFrom, finStations[7]!.x), 0, 1, 5);
    tipGeometry.applyMatrix4(finMatrix);
    addStatic(tipGeometry, tailTips);
  } else if (tail.visual === 'twin') {
    const finStations: SurfaceStation[] = [];
    for (let i = 0; i <= 8; i += 1) {
      const s = i / 8;
      const e = Math.sqrt(Math.max(0.04, 1 - (2 * s - 1) ** 2));
      finStations.push({
        x: -0.45 * ts + s * 1.35 * ts,
        y: 0,
        le: shape.tail.le - 0.2 * ts - (1 - e) * 0.35 * ts,
        chord: 1.15 * ts * e,
        t: 0.09,
      });
    }
    const tipStab = stationAt(stabStations, stabSpan * 0.96);
    const finMatrix = new Matrix4()
      .makeTranslation(tipStab.x, shape.tail.y, 0.15 * ts)
      .multiply(new Matrix4().makeRotationZ(Math.PI / 2));
    const { left, right } = addTailSurface(finStations, finMatrix, -0.3 * ts, 0.8 * ts, 0.62, true, tailTips);
    rudders.push(left, right!);
  }

  // --- Engines and propellers --------------------------------------------------------------
  const pods = engine.visual.pod === true;
  const propRadius = (prop.visual.diameter / 2) * shape.prop * (pods ? 1.05 : engine.visual.twin ? 0.82 : 1);
  const bladeMaterial = paints.track(
    new MeshStandardMaterial({
      color: 0x24262a,
      roughness: 0.45,
      metalness: 0.55,
      transparent: true,
      opacity: 1,
    }),
  );
  const discTexture = createPropDiscTexture(swatchColor(paint.tips));
  paints.textures.push(discTexture);
  const discMaterial = paints.track(
    new MeshBasicMaterial({
      map: discTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  const bladeGeometry = keep(buildBlade(propRadius, prop.visual.chord * shape.prop, prop.visual.scimitar));
  const bladeTipGeometry = keep(
    buildBlade(propRadius, prop.visual.chord * shape.prop, prop.visual.scimitar, true),
  );
  const bladeTipMaterial = paints.track(
    new MeshStandardMaterial({
      color: swatchColor(paint.tips),
      roughness: 0.4,
      transparent: true,
      opacity: 1,
    }),
  );

  const addProp = (front: Vector3, spinnerRadius: number) => {
    const spin = new Object3D();
    spin.position.copy(front);
    root.add(spin);
    const spinnerLength =
      prop.visual.spinner === 'bullet'
        ? spinnerRadius * 2.6
        : prop.visual.spinner === 'dome'
          ? spinnerRadius * 1.1
          : spinnerRadius * 1.9;
    const spinnerProfile: [number, number][] =
      prop.visual.spinner === 'bullet'
        ? [
            [spinnerLength, 0.005],
            [spinnerLength * 0.7, spinnerRadius * 0.55],
            [spinnerLength * 0.3, spinnerRadius * 0.92],
            [0, spinnerRadius],
          ]
        : prop.visual.spinner === 'dome'
          ? [
              [spinnerLength, 0.005],
              [spinnerLength * 0.8, spinnerRadius * 0.6],
              [spinnerLength * 0.4, spinnerRadius * 0.92],
              [0, spinnerRadius],
            ]
          : [
              [spinnerLength, 0.005],
              [spinnerLength * 0.5, spinnerRadius * 0.62],
              [0, spinnerRadius],
            ];
    const spinner = new Mesh(keep(revolve(spinnerProfile, 18)), noseMat);
    spin.add(spinner);
    const blades = prop.visual.blades;
    for (let i = 0; i < blades; i += 1) {
      const holder = new Object3D();
      holder.rotation.z = (i / blades) * Math.PI * 2;
      const blade = new Mesh(bladeGeometry, bladeMaterial);
      const tip = new Mesh(bladeTipGeometry, bladeTipMaterial);
      blade.position.z = spinnerLength * 0.2;
      tip.position.z = spinnerLength * 0.2;
      holder.add(blade, tip);
      spin.add(holder);
    }
    const disc = new Mesh(keep(new CircleGeometry(propRadius * 1.02, 40)), discMaterial);
    disc.position.z = spinnerLength * 0.2;
    spin.add(disc);
    props.push({ spin, blades: bladeMaterial, disc });
  };

  const stackFlame = (origin: Vector3, scale: number) => {
    const flame = new Mesh(flameGeometry, exhaustMaterial);
    flame.position.copy(origin);
    flame.scale.setScalar(scale);
    flame.userData.base = scale;
    root.add(flame);
    exhausts.push(flame);
    const glow = new Mesh(glowGeometry, glowMaterial);
    glow.position.copy(origin);
    glow.scale.setScalar(scale);
    root.add(glow);
    glows.push(glow);
  };

  /** One engine: cowl forward from `z0` (rear radius r0) and an optional tail cone behind it. */
  const engineUnit = (x: number, y: number, z0: number, r0: number, tailCone: number) => {
    const scale = r0 / 0.6;
    const cowl = engine.visual.cowl;
    const L = (cowl === 'radial' ? 0.75 : cowl === 'long' ? 1.95 : cowl === 'pulse' ? 1.8 : 1.5) * scale;
    const front = cowl === 'radial' ? r0 * 1.04 : r0 * 0.5;
    const rearProfile: [number, number][] = [];
    const frontProfile: [number, number][] = [];
    if (cowl === 'radial') {
      frontProfile.push([z0 + L, front * 0.92], [z0 + L * 0.85, r0 * 1.12]);
      rearProfile.push([z0 + L * 0.85, r0 * 1.12], [z0 + L * 0.45, r0 * 1.1], [z0, r0]);
    } else {
      frontProfile.push([z0 + L, front * 0.98], [z0 + L * 0.9, front * 1.25], [z0 + L * 0.78, r0 * 0.82]);
      rearProfile.push([z0 + L * 0.78, r0 * 0.82], [z0 + L * 0.45, r0 * 0.97], [z0, r0]);
    }
    if (tailCone > 0) rearProfile.push([z0 - tailCone * 0.5, r0 * 0.78], [z0 - tailCone, 0.04]);
    const place = (g: BufferGeometry) => g.translate(x, y, 0);
    // A nose engine's cowl belongs to the nose section, so it wears that section's paint.
    const inNose = x === 0 && engineInNose;
    addStatic(place(revolve(frontProfile, 24)), inNose ? cowlRing : noseMat);
    addStatic(place(revolve(rearProfile, 24)), inNose ? cowlSkin : primary);
    // Engine face behind the cowl opening.
    const face = new CircleGeometry(front * 0.98, 24);
    face.translate(x, y, z0 + L - 0.04);
    addStatic(face, darkMetal);

    if (cowl === 'radial') {
      // Five exposed cylinder heads with cooling fins round a crankcase.
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
        const head = new CylinderGeometry(0.11 * scale, 0.12 * scale, 0.42 * scale, 10);
        head.rotateZ(a - Math.PI / 2);
        head.translate(x + Math.cos(a) * r0 * 0.66, y + Math.sin(a) * r0 * 0.66, z0 + L * 0.82);
        addStatic(head, aluminium);
        for (const k of [-0.1, 0, 0.1]) {
          const fin = new TorusGeometry(0.125 * scale, 0.012, 4, 12);
          fin.rotateX(Math.PI / 2);
          fin.rotateZ(a - Math.PI / 2);
          const along = 0.16 * scale + k * scale;
          fin.translate(
            x + Math.cos(a) * (r0 * 0.66 + along - 0.16 * scale),
            y + Math.sin(a) * (r0 * 0.66 + along - 0.16 * scale),
            z0 + L * 0.82,
          );
          addStatic(fin, aluminium);
        }
      }
      const crank = new CylinderGeometry(r0 * 0.3, r0 * 0.34, 0.3 * scale, 14);
      crank.rotateX(Math.PI / 2);
      crank.translate(x, y, z0 + L * 0.8);
      addStatic(crank, darkMetal);
      // Collector ring exhausts under the cowl.
      for (const side of [-1, 1]) {
        const pipe = new Vector3(x + side * r0 * 0.45, y - r0 * 0.95, z0 + 0.1);
        rod(pipe, pipe.clone().add(new Vector3(0, -0.02, -0.45)), 0.05 * scale, darkMetal);
        stackFlame(pipe.clone().add(new Vector3(0, -0.02, -0.48)), 0.55 * scale);
      }
    } else {
      const stacks = engine.visual.stacks;
      const stackY = y + r0 * 0.25;
      for (const side of [-1, 1]) {
        if (cowl === 'long') {
          // Flame-damper pipe running back along the flank.
          const start = new Vector3(x + side * r0 * 0.98, stackY, z0 + L * 0.6);
          const end = new Vector3(x + side * r0 * 1.02, stackY - 0.04, z0 - 0.5);
          rod(start, end, 0.065 * scale, darkMetal);
          stackFlame(end.clone().add(new Vector3(0, 0, -0.04)), 0.5 * scale);
        } else if (cowl === 'pulse') {
          // Two glowing combustor cans.
          const can = new CylinderGeometry(0.16 * scale, 0.13 * scale, 1.3 * scale, 14);
          can.rotateX(Math.PI / 2);
          can.translate(x + side * r0 * 1.02, y - r0 * 0.1, z0 + L * 0.35);
          addStatic(can, heatMaterial);
          for (let k = 0; k < 3; k += 1) {
            const band = new TorusGeometry(0.16 * scale, 0.02, 5, 14);
            band.translate(x + side * r0 * 1.02, y - r0 * 0.1, z0 + L * 0.35 - 0.4 * scale + k * 0.4 * scale);
            addStatic(band, accent);
          }
          stackFlame(
            new Vector3(x + side * r0 * 1.02, y - r0 * 0.1, z0 + L * 0.35 - 0.7 * scale),
            0.9 * scale,
          );
        } else {
          for (let i = 0; i < stacks; i += 1) {
            const z = z0 + L * 0.68 - i * (0.85 / Math.max(stacks, 1)) * scale;
            const base = new Vector3(x + side * r0 * 0.88, stackY, z);
            const outlet = base.clone().add(new Vector3(side * 0.12 * scale, -0.02, -0.12 * scale));
            rod(base, outlet, 0.04 * scale, darkMetal);
            if (i === stacks - 1)
              stackFlame(outlet.clone().add(new Vector3(side * 0.02, 0, -0.02)), 0.6 * scale);
          }
        }
      }
      if (cowl === 'pulse') {
        for (const k of [0.3, 0.55]) {
          const band = new TorusGeometry(r0 * 0.92, 0.03, 5, 28);
          band.translate(x, y, z0 + L * k);
          addStatic(band, accent);
        }
      }
    }
    if (engine.visual.scoop) {
      // Supercharger intake on top of the cowl.
      const scoopStations: BodyStation[] = [
        { z: z0 + L * 0.82, w: 0.16 * scale, top: 0.16 * scale, bottom: 0.06 },
        { z: z0 + L * 0.55, w: 0.18 * scale, top: 0.2 * scale, bottom: 0.06 },
        { z: z0 + L * 0.1, w: 0.08 * scale, top: 0.04, bottom: 0.04 },
      ];
      const scoop = sculptBody(scoopStations, 8, 14);
      scoop.translate(x, y + r0 * 0.88, 0);
      addStatic(scoop, primary);
      const mouth = new CircleGeometry(0.13 * scale, 14);
      mouth.scale(1, 1.05, 1);
      mouth.translate(x, y + r0 * 0.88 + 0.06 * scale, z0 + L * 0.82 + 0.005);
      addStatic(mouth, darkMetal);
    }
    addProp(new Vector3(x, y, z0 + L - 0.02), cowl === 'radial' ? r0 * 0.34 : front * 0.95);
  };

  if (engineInNose) {
    const r0 = Math.max(firewall.w, (firewall.top + firewall.bottom) / 2) * shape.cowl;
    engineUnit(0, firewall.y ?? 0, firewall.z, Math.max(r0, firewall.w), 0);
  } else if (pods) {
    // Thunderpods: huge engines slung under the wings on outriggers, reaching well past the nose line.
    const s = stationAt(ws, span * Math.min(0.5, shape.nacelle + 0.1));
    const r0 = 0.74 * shape.cowl;
    const y = s.y - r0 - 0.18;
    const z0 = s.le + 0.9;
    for (const side of [1, -1] as const) {
      engineUnit(side * s.x, y, z0, r0, 3.4);
      // Outrigger: a faired pylon from the wing to the pod, braced fore and aft.
      const top = new Vector3(side * s.x, s.y - 0.04, s.le - s.chord * 0.3);
      rod(top, new Vector3(side * s.x, y + r0 * 0.8, z0 - 0.8), 0.07, darkMetal);
      rod(
        top.clone().setZ(s.le - s.chord * 0.85),
        new Vector3(side * s.x, y + r0 * 0.8, z0 - 2.4),
        0.06,
        darkMetal,
      );
      const pylon = new BoxGeometry(0.1, Math.max(0.1, s.y - (y + r0)), s.chord * 0.7);
      pylon.translate(side * s.x, (s.y + y + r0) / 2, s.le - s.chord * 0.45);
      addStatic(pylon, primary);
    }
  } else if (engine.visual.twin) {
    const s = stationAt(ws, span * shape.nacelle);
    const r0 = 0.42 * shape.cowl;
    const y = s.y - 0.06;
    engineUnit(s.x, y, s.le + 0.15, r0, 2.4);
    // Mirror the right nacelle by building it again on the other side.
    engineUnit(-s.x, y, s.le + 0.15, r0, 2.4);
  } else if (shape.pylon) {
    const r0 = 0.44 * shape.cowl;
    engineUnit(0, shape.pylon.y, shape.pylon.z, r0, 1.9);
    const root0 = stationAt(ws, 0);
    const pylon: SurfaceStation[] = [
      { x: 0, y: 0, le: shape.pylon.z - 0.1, chord: 1.4, t: 0.12 },
      { x: shape.pylon.y - root0.y - r0 * 0.6, y: 0, le: shape.pylon.z - 0.15, chord: 1.2, t: 0.12 },
    ];
    const g = loftSurface(pylon, 0, 1, 5);
    g.applyMatrix4(
      new Matrix4().makeTranslation(0, root0.y, 0).multiply(new Matrix4().makeRotationZ(Math.PI / 2)),
    );
    addStatic(g, primary);
  }

  // --- Landing gear -------------------------------------------------------------------------
  const g = shape.gear;
  let ground = g.ground;
  let restPitch = 0;
  if (gear.visual === 'floats') {
    const floatLength = bodyLength * 0.82;
    const floatY = g.ground + 0.3;
    const floatFront = g.z + floatLength * 0.48;
    const floatStations: BodyStation[] = [
      { z: floatFront, w: 0.05, top: 0.05, bottom: 0.03, y: 0.18 },
      { z: floatFront - 0.4, w: 0.24, top: 0.22, bottom: 0.12, y: 0.1, square: 2.4 },
      { z: floatFront - 1.4, w: 0.32, top: 0.28, bottom: 0.28, square: 2.6 },
      { z: g.z - 0.2, w: 0.32, top: 0.28, bottom: 0.3, square: 2.6 },
      { z: g.z - 0.3, w: 0.3, top: 0.27, bottom: 0.2, square: 2.6 },
      { z: floatFront - floatLength * 0.92, w: 0.14, top: 0.16, bottom: 0.04, y: 0.12 },
      { z: floatFront - floatLength, w: 0.03, top: 0.04, bottom: 0.02, y: 0.16 },
    ];
    const float = sculptBody(floatStations, 24, 18);
    float.translate(g.track, floatY, 0);
    addStatic(float, secondary, true);
    const stripe = new BoxGeometry(0.02, 0.05, floatLength * 0.7);
    stripe.translate(g.track + 0.32, floatY + 0.05, floatFront - floatLength * 0.42);
    addStatic(stripe, accent, true);
    for (const dz of [0.55, -0.85]) {
      const z = g.z + dz;
      const top = new Vector3(bodyAt(z).w * 0.5, bottomAt(z) + 0.12, z);
      const foot = new Vector3(g.track, floatY + 0.26, z);
      rod(top, foot, 0.045, darkMetal, true);
      rod(top.clone().add(new Vector3(0, 0, -0.5)), foot, 0.035, darkMetal, true);
    }
    // Spreader bars between the floats.
    rod(
      new Vector3(g.track, floatY + 0.3, g.z + 0.55),
      new Vector3(-g.track, floatY + 0.3, g.z + 0.55),
      0.03,
      darkMetal,
    );
    ground = floatY - 0.3;
  } else {
    const tundra = gear.visual === 'tundra';
    const wheelR = tundra ? 0.4 : 0.3;
    const wheelW = tundra ? 0.3 : 0.14;
    const wheelZ = g.z;
    const contact = g.ground;
    const hub = new Vector3(g.track, contact + wheelR, wheelZ);
    const attach =
      shape.wing.mount === 'low' || shape.wing.mount === 'mid'
        ? new Vector3(g.track * 0.92, stationAt(ws, g.track).y - 0.04, wheelZ + 0.05)
        : new Vector3(bodyAt(wheelZ).w * 0.6, g.attachY, wheelZ);
    const buildWheel = (): BufferGeometry[] => {
      const parts: BufferGeometry[] = [];
      const tyre = new TorusGeometry(wheelR - wheelW * 0.45, wheelW * 0.5, 10, 22);
      tyre.rotateY(Math.PI / 2);
      parts.push(tyre);
      return parts;
    };
    const wheelGroup = (side: 1 | -1, parent: Object3D | null, origin: Vector3) => {
      const offset = new Vector3(side * hub.x, hub.y, hub.z).sub(origin);
      for (const part of buildWheel()) {
        part.translate(offset.x, offset.y, offset.z);
        if (parent) {
          const mesh = new Mesh(keep(part), rubber);
          parent.add(mesh);
        } else batch.add(part, rubber);
      }
      const rim = new CylinderGeometry(wheelR * 0.5, wheelR * 0.5, wheelW * 0.8, 14);
      rim.rotateZ(Math.PI / 2);
      rim.translate(offset.x, offset.y, offset.z);
      if (parent) parent.add(new Mesh(keep(rim), aluminium));
      else batch.add(rim, aluminium);
    };
    if (gear.visual === 'retract') {
      for (const side of [1, -1] as const) {
        const pivot = new Object3D();
        const origin = new Vector3(side * attach.x, attach.y, attach.z);
        pivot.position.copy(origin);
        root.add(pivot);
        gearLegs.push({ pivot, side });
        const legLength = origin.y - hub.y;
        const leg = new CylinderGeometry(0.05, 0.05, legLength, 8);
        leg.translate(side * (hub.x - attach.x) * 0.5, -legLength / 2, 0);
        pivot.add(new Mesh(keep(leg), aluminium));
        const door = new BoxGeometry(0.03, legLength * 0.8, 0.42);
        door.translate(side * ((hub.x - attach.x) * 0.5 + 0.09), -legLength * 0.45, 0);
        pivot.add(new Mesh(keep(door), primary));
        wheelGroup(side, pivot, origin);
      }
    } else {
      for (const side of [1, -1] as const) {
        const top = new Vector3(side * attach.x, attach.y, attach.z);
        const axle = new Vector3(side * (hub.x - (tundra ? 0.05 : 0)), hub.y, hub.z);
        if (tundra) {
          // Bent spring-steel legs.
          const knee = new Vector3(side * (attach.x + (hub.x - attach.x) * 0.8), hub.y + 0.35, hub.z + 0.05);
          rod(top, knee, 0.05, darkMetal);
          rod(knee, axle, 0.05, darkMetal);
        } else {
          // Faired leg into a streamlined spat.
          const leg = rodMatrix(top, axle.clone().add(new Vector3(0, wheelR * 0.4, 0)), 1);
          const fairing = new CylinderGeometry(0.08, 0.06, 1, 8);
          fairing.scale(0.6, 1, 1.6);
          batch.add(fairing, primary, leg);
          fairing.dispose();
          const spat = sculptBody(
            [
              { z: hub.z + 0.62, w: 0.03, top: 0.03, bottom: 0.03, y: -0.02 },
              { z: hub.z + 0.3, w: 0.12, top: 0.22, bottom: 0.2 },
              { z: hub.z - 0.15, w: 0.11, top: 0.22, bottom: 0.18, y: 0.02 },
              { z: hub.z - 0.55, w: 0.06, top: 0.12, bottom: 0.08, y: 0.06 },
              { z: hub.z - 0.85, w: 0.015, top: 0.02, bottom: 0.02, y: 0.1 },
            ],
            12,
            14,
          );
          spat.translate(side * hub.x, hub.y + 0.02, 0);
          addStatic(spat, accent);
        }
        wheelGroup(side, null, new Vector3());
      }
    }
    // Tailwheel on a short sprung leg.
    const tailTop = new Vector3(0, bottomAt(g.tailZ) + 0.05, g.tailZ);
    // A realistic three-point stance: the tail sits roughly nine degrees above the mains.
    const stanceY = contact + 0.135 + Math.tan(0.16) * (wheelZ - g.tailZ);
    const tailWheel = new Vector3(0, Math.min(tailTop.y - 0.22, stanceY), g.tailZ - 0.15);
    rod(tailTop, tailWheel, 0.03, darkMetal);
    const tw = new TorusGeometry(0.09, 0.045, 8, 14);
    tw.rotateY(Math.PI / 2);
    tw.translate(tailWheel.x, tailWheel.y, tailWheel.z);
    batch.add(tw, rubber);
    const tailContact = tailWheel.y - 0.135;
    ground = contact;
    restPitch = Math.atan2(tailContact - contact, wheelZ - tailWheel.z);
  }

  // --- Details --------------------------------------------------------------------------------
  if (shape.scoop) {
    const s = shape.scoop;
    const under = bottomAt(s.z);
    const scoop = sculptBody(
      [
        { z: s.z + s.length * 0.5, w: 0.26, top: 0.02, bottom: 0.2 },
        { z: s.z, w: 0.3, top: 0.02, bottom: 0.26 },
        { z: s.z - s.length * 0.5, w: 0.06, top: 0.02, bottom: 0.03 },
      ],
      10,
      16,
    );
    scoop.translate(0, under + 0.06, 0);
    addStatic(scoop, primary);
    const mouth = new CircleGeometry(0.21, 16);
    mouth.scale(1.15, 0.8, 1);
    mouth.translate(0, under - 0.08, s.z + s.length * 0.5 + 0.005);
    addStatic(mouth, darkMetal);
  }
  if (shape.mast) {
    const z = shape.mast.z;
    const base = new Vector3(0, topAt(z) - 0.02, z);
    const tip = new Vector3(0, base.y + 0.45, z - 0.15);
    rod(base, tip, 0.02, darkMetal);
    const finTop = new Vector3(0, shape.tail.finY + finHeight * 0.75, shape.tail.le - 0.2);
    if (tail.visual === 'standard' || tail.visual === 'big') rod(tip, finTop, 0.005, darkMetal);
  }
  // Fin insignia (both sides) on single-fin tails.
  if (insignia && (tail.visual === 'standard' || tail.visual === 'big')) {
    const decal = paints.list.find(
      (m): m is MeshStandardMaterial => m instanceof MeshStandardMaterial && m.map === insignia,
    );
    if (decal) {
      const disc = new CircleGeometry(0.2 * ts, 20);
      disc.rotateY(Math.PI / 2);
      disc.translate(0.075 * ts, shape.tail.finY + finHeight * 0.38, shape.tail.le - 0.15 * ts);
      addStatic(disc, decal, true);
    }
  }

  // --- Assemble ------------------------------------------------------------------------------
  for (const mesh of batch.build()) {
    keep(mesh.geometry);
    root.add(mesh);
  }
  root.traverse((child) => {
    if (child instanceof Mesh) child.receiveShadow = false;
  });
  for (const mesh of [...exhausts, ...glows]) mesh.castShadow = false;
  for (const prop of props) prop.disc.castShadow = false;

  let radius = 0;
  const probe = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const geometry = child.geometry;
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    if (!sphere) return;
    probe.copy(sphere.center).applyMatrix4(child.matrixWorld);
    radius = Math.max(radius, probe.length() + sphere.radius);
  });

  return {
    root,
    exhausts,
    glows,
    ailerons,
    elevators,
    rudders,
    airbrakes,
    props,
    gearLegs,
    accentMaterials: [accent, heatMaterial],
    engineMaterials: [darkMetal, heatMaterial],
    wingtips,
    stance: { ground, restPitch },
    radius,
    dispose: () => {
      root.traverse((child) => {
        if (child instanceof Mesh && child.geometry !== flameGeometry && child.geometry !== glowGeometry)
          geometries.push(child.geometry);
      });
      for (const geometry of new Set(geometries)) geometry.dispose();
      for (const material of paints.list) material.dispose();
      for (const texture of paints.textures) texture.dispose();
    },
  };
};

/** Shared exhaust flame: base at the origin, extending along −Z. */
const flameGeometry = (() => {
  const cone = new ConeGeometry(0.12, 0.7, 10, 1, true);
  cone.rotateX(-Math.PI / 2);
  cone.translate(0, 0, -0.35);
  return cone;
})();
const glowGeometry = new SphereGeometry(0.1, 10, 8);

/** One propeller blade along +Y in the disc plane (chord along X), optionally just its painted tip. */
const buildBlade = (radius: number, chord: number, scimitar: boolean, tipOnly = false): BufferGeometry => {
  const stations: SurfaceStation[] = [];
  const from = tipOnly ? 0.9 : 0.12;
  const to = tipOnly ? 1 : 0.9;
  const samples = tipOnly ? 3 : 7;
  for (let i = 0; i <= samples; i += 1) {
    const s = from + ((to - from) * i) / samples;
    const width =
      chord *
      (0.75 + 0.6 * Math.sin(Math.min(1, s * 1.3) * Math.PI * 0.85)) *
      (s > 0.85 ? 1 - (s - 0.85) * 3 : 1);
    const sweep = scimitar ? s * s * chord * 1.6 : 0;
    stations.push({ x: s * radius, y: 0, le: width * 0.5 - sweep, chord: Math.max(0.03, width), t: 0.09 });
  }
  const g = loftSurface(stations, 0, 1, 4);
  // Surface frame (span X, thickness Y, chord −Z) → blade frame (span Y, chord X, thickness Z), with pitch.
  const m = new Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  g.applyMatrix4(m);
  g.applyMatrix4(new Matrix4().makeRotationY(0.38));
  g.computeVertexNormals();
  return g;
};

export const AIRCRAFT_FORWARD = new Vector3(0, 0, 1);
