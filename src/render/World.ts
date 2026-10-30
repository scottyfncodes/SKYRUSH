import type { Object3D } from 'three';
import {
  AmbientLight,
  BoxGeometry,
  AdditiveBlending,
  BufferAttribute,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Circuit, Landmark } from '../course/circuit';
import type { BonusRing, GateDefinition } from '../course/gates';
import { PALETTE } from './materials';
import type { RenderQuality } from './Renderer';
import { clamp01 } from '../core/math';
import { createSky, createWater, terrainColor } from './environment';
import { createScatter } from './scatter';

const TERRAIN_SIZE = 8000;
const TERRAIN_SEGMENTS = 240;
const LOW_TERRAIN_SEGMENTS = 150;
/** Prop tiles further than this from the aircraft are hidden; the haze hides them anyway. */
const PROP_DRAW_DISTANCE = 2800;
/** Distance from the focus point to the sun light (shadow camera placement). */
const SUN_DISTANCE = 1100;

export interface GateVisual {
  gate: GateDefinition;
  group: Group;
  frameMaterial: MeshStandardMaterial;
  stripMaterial: MeshBasicMaterial;
  beacon: Mesh;
  state: 'next' | 'upcoming' | 'passed' | 'missed';
  flash: number;
}

export interface RingVisual {
  ring: BonusRing;
  group: Group;
  hoop: Mesh;
  material: MeshBasicMaterial;
  glowMaterial: MeshBasicMaterial;
  beamMaterial: MeshBasicMaterial;
  /** Seconds left of the collect burst; -1 once fully hidden. */
  burst: number;
  collected: boolean;
}

export interface WorldHandles {
  scene: Scene;
  sun: DirectionalLight;
  /** Tone-mapping exposure the course is graded for. */
  exposure: number;
  gates: GateVisual[];
  rings: RingVisual[];
  update: (dt: number, focus: Vector3) => void;
  setGateStates: (nextGate: number, missed: Set<number>) => void;
  /** Brief white flash on a gate's light strips (perfect pass feedback). */
  flashGate: (index: number) => void;
  collectRing: (index: number) => void;
  resetRings: () => void;
  dispose: () => void;
}

const RING_COLOR = 0xffc83d;
const GATE_FLASH_SECONDS = 0.45;
const RING_BURST_SECONDS = 0.45;
const _flashColor = new Color();
const _white = new Color(0xffffff);

const makeLabelTexture = (text: string, color: string): CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(14, 18, 26, 0.92)';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 244, 116);
    ctx.fillStyle = color;
    ctx.font = 'bold 84px "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 70);
  }
  const texture = new CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
};

export interface WorldOptions {
  shadows: boolean;
  quality: RenderQuality;
  /** Race gates and bonus rings (off for free-flight activities). Default true. */
  gates?: boolean;
  /** The start pad and its towers at the spawn (off away from the grid). Default true. */
  startLine?: boolean;
}

export const createWorld = (circuit: Circuit, options: WorldOptions): WorldHandles => {
  const low = options.quality === 'low';
  const { theme } = circuit;
  const scene = new Scene();
  scene.background = new Color(theme.fog.color);
  scene.fog = new Fog(theme.fog.color, theme.fog.near, theme.fog.far);

  const disposables: { dispose: () => void }[] = [];

  // --- Lights ---------------------------------------------------------------------
  const sunOffset = new Vector3(...theme.sun.direction).normalize().multiplyScalar(SUN_DISTANCE);
  const hemisphere = new HemisphereLight(
    theme.hemisphere.sky,
    theme.hemisphere.ground,
    theme.hemisphere.intensity,
  );
  scene.add(hemisphere);
  const ambient = new AmbientLight(0xffffff, theme.ambient);
  scene.add(ambient);
  const sun = new DirectionalLight(theme.sun.color, theme.sun.intensity);
  sun.position.copy(sunOffset);
  sun.castShadow = options.shadows;
  if (options.shadows) {
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 50;
    sun.shadow.camera.far = 2600;
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.6;
  }
  scene.add(sun);
  scene.add(sun.target);

  // --- Sky --------------------------------------------------------------------------
  const sky = createSky(theme, sunOffset);
  scene.add(sky.mesh);
  disposables.push(sky.mesh.geometry, sky.material, sky.clouds);

  // --- Terrain -----------------------------------------------------------------------
  const center = circuit.center;
  const segments = low ? LOW_TERRAIN_SEGMENTS : TERRAIN_SEGMENTS;
  const terrainGeometry = new PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
  terrainGeometry.rotateX(-Math.PI / 2);
  const positions = terrainGeometry.attributes.position as BufferAttribute;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i) + center.x;
    const z = positions.getZ(i) + center.z;
    positions.setXYZ(i, x, circuit.terrain.groundAt(x, z), z);
  }
  terrainGeometry.computeVertexNormals();
  // Colour from height and the computed normal, so no extra height samples are needed.
  const normals = terrainGeometry.attributes.normal as BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  const color = new Color();
  for (let i = 0; i < positions.count; i += 1) {
    const slope = clamp01((1 - normals.getY(i)) * 1.6);
    terrainColor(
      theme.terrain,
      positions.getY(i),
      slope,
      positions.getX(i),
      positions.getZ(i),
      circuit.seaLevel,
      color,
    );
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  terrainGeometry.setAttribute('color', new BufferAttribute(colors, 3));
  const terrainMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 });
  const terrain = new Mesh(terrainGeometry, terrainMaterial);
  terrain.receiveShadow = options.shadows;
  scene.add(terrain);
  disposables.push(terrainGeometry, terrainMaterial);

  // --- Water ------------------------------------------------------------------------------
  const water =
    circuit.seaLevel === null
      ? null
      : createWater(
          theme,
          circuit.terrain,
          circuit.seaLevel,
          center,
          TERRAIN_SIZE,
          sunOffset,
          low ? 100 : 200,
        );
  if (water) {
    for (const mesh of water.meshes) {
      scene.add(mesh);
      disposables.push(mesh.geometry);
    }
    disposables.push(water.material);
  }

  // --- Props: trees, rocks, cacti --------------------------------------------------------
  // Low quality (no GPU) skips the props: thousands of instances are too much for a CPU rasterizer.
  const scatter = createScatter(low ? { ...theme, scatter: [] } : theme, circuit.terrain, circuit.seaLevel, {
    center,
    extent: 2900,
    seed: circuit.propSeed,
  });
  for (const mesh of scatter.meshes) scene.add(mesh);
  disposables.push(scatter);

  // --- Course markers: ground chevrons under the route ------------------------------------
  const markerGeometry = new BoxGeometry(5, 0.6, 2.4);
  const markerMaterial = new MeshStandardMaterial({
    color: PALETTE.warmWhite,
    roughness: 0.8,
    emissive: 0x332a1c,
    emissiveIntensity: 0.3,
  });
  const markerCount = 260;
  const markers = new InstancedMesh(markerGeometry, markerMaterial, markerCount);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const routePoints = [circuit.spawn.position, ...circuit.gates.map((g) => g.position)];
  let placed = 0;
  for (let i = 0; i < routePoints.length - 1 && placed < markerCount; i += 1) {
    const a = routePoints[i]!;
    const b = routePoints[i + 1]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const count = Math.max(2, Math.floor(length / 70));
    const heading = Math.atan2(b.x - a.x, b.z - a.z);
    quaternion.setFromAxisAngle(new Vector3(0, 1, 0), heading);
    for (let j = 0; j < count && placed < markerCount; j += 1) {
      const t = j / count;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const y = circuit.terrain.heightAt(x, z) + 0.4;
      matrix.compose(new Vector3(x, y, z), quaternion, scale);
      markers.setMatrixAt(placed, matrix);
      placed += 1;
    }
  }
  markers.count = placed;
  markers.instanceMatrix.needsUpdate = true;
  scene.add(markers);
  disposables.push(markerGeometry, markerMaterial);

  // --- Gates -------------------------------------------------------------------------------
  const showGates = options.gates !== false;
  const gates: GateVisual[] = showGates
    ? circuit.gates.map((gate) => createGateVisual(gate, circuit, scene, disposables))
    : [];

  // --- Bonus rings ---------------------------------------------------------------------------
  const rings: RingVisual[] = showGates
    ? circuit.rings.map((ring) => createRingVisual(ring, scene, disposables))
    : [];

  // --- Landmarks and facility -----------------------------------------------------------------
  const landmarks = new Group();
  for (const landmark of circuit.landmarks) {
    const object = createLandmark(landmark, circuit, disposables);
    landmarks.add(object);
  }
  scene.add(landmarks);

  // Start line banner across the spawn.
  if (options.startLine !== false) scene.add(createStartLine(circuit, disposables));

  const setGateStates = (nextGate: number, missed: Set<number>): void => {
    for (const visual of gates) {
      const index = visual.gate.index;
      const state: GateVisual['state'] =
        index === nextGate
          ? 'next'
          : index < nextGate
            ? missed.has(index)
              ? 'missed'
              : 'passed'
            : 'upcoming';
      if (state !== visual.state) {
        visual.state = state;
        applyGateState(visual);
      }
    }
  };

  const flashGate = (index: number): void => {
    const visual = gates[index];
    if (visual) visual.flash = GATE_FLASH_SECONDS;
  };

  const collectRing = (index: number): void => {
    const visual = rings[index];
    if (!visual || visual.collected) return;
    visual.collected = true;
    visual.burst = RING_BURST_SECONDS;
    visual.beamMaterial.opacity = 0;
  };

  const resetRings = (): void => {
    for (const visual of rings) {
      visual.collected = false;
      visual.burst = 0;
      visual.group.visible = true;
      visual.group.scale.setScalar(1);
      visual.material.opacity = 1;
      visual.glowMaterial.opacity = 0.14;
      visual.beamMaterial.opacity = 0.32;
    }
  };

  let time = 0;
  const update = (dt: number, focus: Vector3): void => {
    time += dt;
    sun.target.position.copy(focus);
    sun.position.copy(focus).add(sunOffset);
    sky.update(time, focus);
    for (const mesh of scatter.meshes) {
      const bounds = mesh.boundingSphere;
      if (bounds) mesh.visible = bounds.center.distanceTo(focus) - bounds.radius < PROP_DRAW_DISTANCE;
    }
    water?.update(time);
    for (const visual of gates) {
      if (visual.state === 'next') {
        const pulse = 0.65 + 0.35 * Math.sin(time * 4);
        visual.stripMaterial.opacity = pulse;
        visual.beacon.scale.setScalar(1 + 0.15 * Math.sin(time * 6));
      }
      if (visual.flash > 0) {
        visual.flash = Math.max(0, visual.flash - dt);
        const base = GATE_COLORS[visual.state].strip;
        _flashColor.setHex(base).lerp(_white, visual.flash / GATE_FLASH_SECONDS);
        visual.stripMaterial.color.copy(_flashColor);
        if (visual.flash === 0) applyGateState(visual);
      }
    }
    for (const visual of rings) {
      if (!visual.collected) {
        // Gentle spin and shimmer so the rings read as pickups, not scenery.
        visual.hoop.rotation.z = time * 0.9 + visual.ring.index;
        visual.glowMaterial.opacity = 0.1 + 0.06 * Math.sin(time * 3 + visual.ring.index);
      } else if (visual.burst > 0) {
        visual.burst = Math.max(0, visual.burst - dt);
        const t = 1 - visual.burst / RING_BURST_SECONDS;
        visual.group.scale.setScalar(1 + t * 0.9);
        visual.material.opacity = 1 - t;
        visual.glowMaterial.opacity = 0.35 * (1 - t);
        if (visual.burst === 0) visual.group.visible = false;
      }
    }
  };

  return {
    scene,
    sun,
    exposure: theme.exposure,
    gates,
    rings,
    update,
    setGateStates,
    flashGate,
    collectRing,
    resetRings,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
      scene.clear();
    },
  };
};

const GATE_COLORS = {
  next: { frame: PALETTE.amber, strip: PALETTE.amber, emissive: 0.9 },
  upcoming: { frame: 0x5f6c7a, strip: PALETTE.cyan, emissive: 0.35 },
  passed: { frame: 0x3a4149, strip: 0x56606b, emissive: 0.08 },
  missed: { frame: 0x5a2a28, strip: PALETTE.red, emissive: 0.5 },
} as const;

const applyGateState = (visual: GateVisual): void => {
  const colors = GATE_COLORS[visual.state];
  visual.frameMaterial.color.setHex(colors.frame);
  visual.frameMaterial.emissive.setHex(colors.strip);
  visual.frameMaterial.emissiveIntensity = colors.emissive * 0.35;
  visual.stripMaterial.color.setHex(colors.strip);
  visual.stripMaterial.opacity = visual.state === 'next' ? 1 : visual.state === 'upcoming' ? 0.75 : 0.35;
  visual.beacon.visible = visual.state === 'next';
};

const createGateVisual = (
  gate: GateDefinition,
  circuit: Circuit,
  scene: Scene,
  disposables: { dispose: () => void }[],
): GateVisual => {
  const group = new Group();
  group.position.copy(gate.position);
  group.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), gate.normal);

  const width = gate.halfWidth * 2;
  const height = gate.halfHeight * 2;
  const beam = 2.4;
  const frameMaterial = new MeshStandardMaterial({
    color: 0x5f6c7a,
    roughness: 0.5,
    metalness: 0.6,
    emissive: 0x000000,
  });
  const stripMaterial = new MeshBasicMaterial({
    color: PALETTE.cyan,
    transparent: true,
    opacity: 0.75,
    side: DoubleSide,
  });
  disposables.push(frameMaterial, stripMaterial);

  const postGeometry = new BoxGeometry(beam, height + beam, beam);
  const barGeometry = new BoxGeometry(width + beam, beam, beam);
  disposables.push(postGeometry, barGeometry);
  const left = new Mesh(postGeometry, frameMaterial);
  left.position.set(-gate.halfWidth, 0, 0);
  const right = new Mesh(postGeometry, frameMaterial);
  right.position.set(gate.halfWidth, 0, 0);
  const top = new Mesh(barGeometry, frameMaterial);
  top.position.set(0, gate.halfHeight, 0);
  const bottom = new Mesh(barGeometry, frameMaterial);
  bottom.position.set(0, -gate.halfHeight, 0);
  group.add(left, right, top, bottom);

  // Inner light strips on the approach face.
  const stripGeometry = new PlaneGeometry(width - beam, beam * 0.45);
  const sideStripGeometry = new PlaneGeometry(beam * 0.45, height - beam);
  disposables.push(stripGeometry, sideStripGeometry);
  for (const face of [-1, 1]) {
    const topStrip = new Mesh(stripGeometry, stripMaterial);
    topStrip.position.set(0, gate.halfHeight, face * beam * 0.51);
    const bottomStrip = new Mesh(stripGeometry, stripMaterial);
    bottomStrip.position.set(0, -gate.halfHeight, face * beam * 0.51);
    const leftStrip = new Mesh(sideStripGeometry, stripMaterial);
    leftStrip.position.set(-gate.halfWidth, 0, face * beam * 0.51);
    const rightStrip = new Mesh(sideStripGeometry, stripMaterial);
    rightStrip.position.set(gate.halfWidth, 0, face * beam * 0.51);
    group.add(topStrip, bottomStrip, leftStrip, rightStrip);
  }

  // Corner chevrons for silhouette.
  const chevronGeometry = new BoxGeometry(beam * 2.2, beam * 0.8, beam * 1.2);
  disposables.push(chevronGeometry);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const chevron = new Mesh(chevronGeometry, frameMaterial);
      chevron.position.set(sx * (gate.halfWidth - beam * 0.6), sy * (gate.halfHeight + beam * 0.3), 0);
      group.add(chevron);
    }
  }

  // Number panel above the gate, facing the approach.
  const label = makeLabelTexture(gate.label, gate.kind === 'finish' ? '#ffa524' : '#f3eee4');
  const labelMaterial = new MeshBasicMaterial({ map: label, transparent: false });
  const labelGeometry = new PlaneGeometry(
    gate.kind === 'finish' || gate.kind === 'start' ? 14 : 9,
    gate.kind === 'finish' || gate.kind === 'start' ? 7 : 4.5,
  );
  disposables.push(label, labelMaterial, labelGeometry);
  const panel = new Mesh(labelGeometry, labelMaterial);
  panel.position.set(0, gate.halfHeight + 5.5, -0.2);
  panel.rotation.y = Math.PI; // face -Z (the approach side)
  group.add(panel);

  // Support pylons down to the ground anchor the gate in the landscape.
  const groundLeft = circuit.terrain.heightAt(
    gate.position.x - gate.right.x * gate.halfWidth,
    gate.position.z - gate.right.z * gate.halfWidth,
  );
  const groundRight = circuit.terrain.heightAt(
    gate.position.x + gate.right.x * gate.halfWidth,
    gate.position.z + gate.right.z * gate.halfWidth,
  );
  const pylonMaterial = new MeshStandardMaterial({ color: 0x3c434c, roughness: 0.7, metalness: 0.5 });
  disposables.push(pylonMaterial);
  for (const [sx, ground] of [
    [-1, groundLeft],
    [1, groundRight],
  ] as const) {
    const bottomY = ground - gate.position.y - 2;
    const topY = -gate.halfHeight;
    const length = topY - bottomY;
    if (length > 2) {
      const pylonGeometry = new CylinderGeometry(0.5, 1.4, length, 8);
      disposables.push(pylonGeometry);
      const pylon = new Mesh(pylonGeometry, pylonMaterial);
      pylon.position.set(sx * gate.halfWidth, bottomY + length / 2, 0);
      group.add(pylon);
    }
  }

  // Beacon ring that pulses on the next gate.
  const beaconGeometry = new TorusGeometry(3.2, 0.5, 8, 24);
  disposables.push(beaconGeometry);
  const beacon = new Mesh(beaconGeometry, stripMaterial);
  beacon.position.set(0, gate.halfHeight + 12, 0);
  beacon.visible = false;
  group.add(beacon);

  scene.add(group);
  const visual: GateVisual = {
    gate,
    group,
    frameMaterial,
    stripMaterial,
    beacon,
    state: 'upcoming',
    flash: 0,
  };
  applyGateState(visual);
  return visual;
};

const createRingVisual = (
  ring: BonusRing,
  scene: Scene,
  disposables: { dispose: () => void }[],
): RingVisual => {
  const group = new Group();
  group.position.copy(ring.position);
  group.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), ring.normal);

  const material = new MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 1 });
  const glowMaterial = new MeshBasicMaterial({
    color: RING_COLOR,
    transparent: true,
    opacity: 0.14,
    side: DoubleSide,
    depthWrite: false,
  });
  // A thin vertical light beam makes a low ring visible from the racing line above.
  const beamMaterial = new MeshBasicMaterial({
    color: RING_COLOR,
    transparent: true,
    opacity: 0.32,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  disposables.push(material, glowMaterial, beamMaterial);

  const radius = ring.radius - 0.9;
  const hoopGeometry = new TorusGeometry(radius, 0.75, 10, 40);
  // Notches on the hoop make the spin visible.
  const notchGeometry = new BoxGeometry(1.6, 2.2, 1.6);
  const glowGeometry = new CircleGeometry(radius, 32);
  const beamHeight = 110;
  const beamGeometry = new CylinderGeometry(0.55, 0.55, beamHeight, 6, 1, true);
  disposables.push(hoopGeometry, notchGeometry, glowGeometry, beamGeometry);

  const hoop = new Mesh(hoopGeometry, material);
  for (let i = 0; i < 4; i += 1) {
    const notch = new Mesh(notchGeometry, material);
    const angle = (i / 4) * Math.PI * 2;
    notch.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    notch.rotation.z = angle;
    hoop.add(notch);
  }
  const glow = new Mesh(glowGeometry, glowMaterial);
  group.add(hoop, glow);

  // Ring normals are horizontal, so the group only yaws and a child cylinder stays vertical.
  const beam = new Mesh(beamGeometry, beamMaterial);
  beam.position.set(0, radius + beamHeight / 2, 0);
  group.add(beam);

  scene.add(group);
  return { ring, group, hoop, material, glowMaterial, beamMaterial, burst: 0, collected: false };
};

const createStartLine = (circuit: Circuit, disposables: { dispose: () => void }[]): Object3D => {
  const group = new Group();
  const position = circuit.spawn.position;
  const ground = circuit.terrain.heightAt(position.x, position.z);
  const material = new MeshStandardMaterial({ color: PALETTE.graphite, roughness: 0.6, metalness: 0.5 });
  const accent = new MeshBasicMaterial({ color: PALETTE.amber });
  disposables.push(material, accent);
  const padGeometry = new BoxGeometry(140, 1.2, 60);
  const stripeGeometry = new BoxGeometry(140, 0.4, 3);
  disposables.push(padGeometry, stripeGeometry);
  const pad = new Mesh(padGeometry, material);
  pad.position.set(position.x, ground + 0.6, position.z - 20);
  group.add(pad);
  for (let i = 0; i < 6; i += 1) {
    const stripe = new Mesh(stripeGeometry, accent);
    stripe.position.set(position.x, ground + 1.5, position.z - 44 + i * 9);
    group.add(stripe);
  }
  // Towers framing the start.
  const towerGeometry = new BoxGeometry(6, 70, 6);
  disposables.push(towerGeometry);
  for (const side of [-1, 1]) {
    const tower = new Mesh(towerGeometry, material);
    tower.position.set(position.x + side * 64, ground + 35, position.z - 20);
    group.add(tower);
    const light = new Mesh(new SphereGeometry(1.8, 10, 8), accent);
    light.position.set(position.x + side * 64, ground + 72, position.z - 20);
    group.add(light);
  }
  return group;
};

const createLandmark = (
  landmark: Landmark,
  circuit: Circuit,
  disposables: { dispose: () => void }[],
): Object3D => {
  const group = new Group();
  const ground = circuit.terrain.heightAt(landmark.x, landmark.z);
  group.position.set(landmark.x, ground, landmark.z);
  group.rotation.y = landmark.rotation ?? 0;
  const scale = landmark.scale ?? 1;
  const graphite = new MeshStandardMaterial({ color: PALETTE.graphite, roughness: 0.6, metalness: 0.45 });
  const warm = new MeshStandardMaterial({ color: 0xbfb3a2, roughness: 0.75, metalness: 0.2 });
  const amber = new MeshStandardMaterial({
    color: PALETTE.amber,
    emissive: PALETTE.amber,
    emissiveIntensity: 0.8,
  });
  const cyan = new MeshStandardMaterial({
    color: PALETTE.cyan,
    emissive: PALETTE.cyan,
    emissiveIntensity: 0.8,
  });
  const rock = new MeshStandardMaterial({
    color: circuit.theme.landmarkRock,
    roughness: 0.95,
    metalness: 0.02,
    flatShading: true,
  });
  const snow = new MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.8, flatShading: true });
  const white = new MeshStandardMaterial({ color: 0xf1ede6, roughness: 0.6 });
  const red = new MeshStandardMaterial({ color: 0xc8352a, roughness: 0.55 });
  disposables.push(graphite, warm, amber, cyan, rock, snow, white, red);

  const add = (mesh: Mesh): void => {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    disposables.push(mesh.geometry);
  };

  switch (landmark.kind) {
    case 'hangar': {
      const w = 90 * scale;
      const d = 140 * scale;
      const h = 26 * scale;
      const base = new Mesh(new BoxGeometry(w, h, d), warm);
      base.position.y = h / 2;
      add(base);
      const roof = new Mesh(new CylinderGeometry(w / 2, w / 2, d, 24, 1, false, 0, Math.PI), graphite);
      roof.rotation.z = Math.PI / 2;
      roof.rotation.y = Math.PI / 2;
      roof.position.y = h;
      roof.scale.y = 1;
      add(roof);
      const stripe = new Mesh(new BoxGeometry(w + 0.5, 2, d * 0.9), amber);
      stripe.position.y = h - 3;
      add(stripe);
      break;
    }
    case 'tower': {
      const shaft = new Mesh(new CylinderGeometry(4, 6, 60, 12), graphite);
      shaft.position.y = 30;
      add(shaft);
      const cab = new Mesh(new BoxGeometry(22, 10, 22), warm);
      cab.position.y = 65;
      add(cab);
      const glass = new Mesh(new BoxGeometry(22.4, 4, 22.4), cyan);
      glass.position.y = 66;
      add(glass);
      const mast = new Mesh(new CylinderGeometry(0.4, 0.4, 20, 6), graphite);
      mast.position.y = 80;
      add(mast);
      const light = new Mesh(new SphereGeometry(1.4, 8, 8), amber);
      light.position.y = 90;
      add(light);
      break;
    }
    case 'grandstand': {
      const base = new Mesh(new BoxGeometry(150, 6, 50), graphite);
      base.position.set(0, 3, -18);
      add(base);
      for (let i = 0; i < 4; i += 1) {
        const tier = new Mesh(new BoxGeometry(140, 5, 12), i % 2 === 0 ? graphite : warm);
        tier.position.set(0, 8.5 + i * 5, -i * 10);
        add(tier);
      }
      const roof = new Mesh(new BoxGeometry(150, 1.5, 50), graphite);
      roof.position.set(0, 30, -18);
      add(roof);
      const stripe = new Mesh(new BoxGeometry(150, 1.2, 1.5), amber);
      stripe.position.set(0, 29, 6);
      add(stripe);
      break;
    }
    case 'pylon': {
      const body = new Mesh(new CylinderGeometry(1.5, 4, 120 * scale, 8), graphite);
      body.position.y = 60 * scale;
      add(body);
      const ring = new Mesh(new TorusGeometry(6, 0.8, 8, 20), amber);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 110 * scale;
      add(ring);
      break;
    }
    case 'antenna': {
      const mast = new Mesh(new CylinderGeometry(1.2, 3, 140 * scale, 6), graphite);
      mast.position.y = 70 * scale;
      add(mast);
      for (let i = 0; i < 3; i += 1) {
        const dish = new Mesh(new BoxGeometry(14, 10, 1.5), warm);
        dish.position.set(0, 40 + i * 30, 4);
        dish.rotation.y = i * 1.2;
        add(dish);
      }
      const tip = new Mesh(new SphereGeometry(1.6, 8, 8), cyan);
      tip.position.y = 142 * scale;
      add(tip);
      break;
    }
    case 'spire': {
      const s = 1 * scale;
      const main = new Mesh(new ConeGeometry(55 * s, 260 * s, 7), rock);
      main.position.y = 110 * s;
      add(main);
      const second = new Mesh(new ConeGeometry(38 * s, 170 * s, 6), rock);
      second.position.set(48 * s, 60 * s, 20 * s);
      add(second);
      if (circuit.theme.landmarkSnow) {
        // Snow caps: the top fifth of each cone, slightly proud of the rock.
        const cap = new Mesh(new ConeGeometry(12.5 * s, 56 * s, 7), snow);
        cap.position.y = 110 * s + 130 * s - 28 * s + 1;
        add(cap);
        const capSecond = new Mesh(new ConeGeometry(9 * s, 40 * s, 6), snow);
        capSecond.position.set(48 * s, 60 * s + 85 * s - 20 * s + 1, 20 * s);
        add(capSecond);
      }
      break;
    }
    case 'lighthouse': {
      const base = new Mesh(new CylinderGeometry(16, 20, 10, 9), rock);
      base.position.y = 2;
      add(base);
      for (let i = 0; i < 5; i += 1) {
        const band = new Mesh(
          new CylinderGeometry(4.6 - i * 0.35, 5 - i * 0.35, 8, 14),
          i % 2 === 0 ? white : red,
        );
        band.position.y = 11 + i * 8;
        add(band);
      }
      const gallery = new Mesh(new CylinderGeometry(4.6, 4.6, 1.2, 14), graphite);
      gallery.position.y = 51.5;
      add(gallery);
      const lamp = new Mesh(new CylinderGeometry(2.4, 2.4, 4, 10), amber);
      lamp.position.y = 54.5;
      add(lamp);
      const roof = new Mesh(new ConeGeometry(3.4, 4, 10), red);
      roof.position.y = 58.5;
      add(roof);
      break;
    }
    case 'arch': {
      const arch = new Mesh(new TorusGeometry(70 * scale, 16 * scale, 8, 24, Math.PI), rock);
      arch.position.y = 10;
      add(arch);
      break;
    }
  }
  return group;
};
