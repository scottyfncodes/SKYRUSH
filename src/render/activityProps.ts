import {
  AdditiveBlending,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Vector3,
} from 'three';
import type { ShowActivity } from '../activities/catalog';
import { HOOK_RADIUS, type ResolvedDiscovery, type ResolvedStop } from '../activities/places';
import { PALETTE } from './materials';

/**
 * Scenery the activities add to a region: things to discover, the show box
 * pylons and the delivery hook masts. Built from a few primitives each with
 * shared materials, so the whole set is a handful of draw calls per object.
 */

interface Kit {
  geometries: BufferGeometry[];
  materials: Material[];
}

const track = <T extends BufferGeometry | Material>(kit: Kit, item: T): T => {
  if ('isMaterial' in item) kit.materials.push(item as Material);
  else kit.geometries.push(item as BufferGeometry);
  return item;
};

const standard = (
  kit: Kit,
  color: number,
  options: Partial<{ roughness: number; metalness: number; emissive: number }> = {},
) =>
  track(
    kit,
    new MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.8,
      metalness: options.metalness ?? 0.1,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissive ? 0.9 : 0,
    }),
  );

const place = (
  parent: Object3D,
  geometry: BufferGeometry,
  material: Material,
  x: number,
  y: number,
  z: number,
  rotation: [number, number, number] = [0, 0, 0],
): Mesh => {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
};

// --- Discoveries --------------------------------------------------------------------------------

export interface DiscoveryProps {
  group: Group;
  update: (time: number, focus: Vector3) => void;
  /** Collects one trail ring (it fades out). */
  collectTrailRing: (id: string, index: number) => void;
  dispose: () => void;
}

const TRAIL_VISIBLE = 650;

export const createDiscoveryProps = (discoveries: readonly ResolvedDiscovery[]): DiscoveryProps => {
  const kit: Kit = { geometries: [], materials: [] };
  const group = new Group();
  const metal = standard(kit, 0xb9bcbf, { metalness: 0.55, roughness: 0.55 });
  const rust = standard(kit, 0x7a4a32, { roughness: 0.9 });
  const fabric = standard(kit, 0xe6dcc6, { roughness: 0.95 });
  const stone = standard(kit, 0x8d8478, { roughness: 1 });
  const timber = standard(kit, 0x6b4a33, { roughness: 0.95 });
  const roof = standard(kit, 0x9c3b2c, { roughness: 0.85 });
  const flag = standard(kit, 0xe0442a, { roughness: 0.7 });
  const white = standard(kit, 0xf1e8d4, { roughness: 0.6 });
  const lamp = standard(kit, 0xff4a3a, { emissive: 0xff4a3a });
  const hull = standard(kit, 0x3b2a22, { roughness: 0.9 });
  const trailMaterial = track(
    kit,
    new MeshBasicMaterial({ color: 0x7cf0d4, transparent: true, opacity: 0.9, fog: false }),
  );
  const trailRings = new Map<string, Mesh[]>();
  const blinkers: Mesh[] = [];
  const box = (w: number, h: number, d: number) => track(kit, new BoxGeometry(w, h, d));
  const cyl = (top: number, bottom: number, height: number, segments = 10) =>
    track(kit, new CylinderGeometry(top, bottom, height, segments));

  for (const discovery of discoveries) {
    const root = new Group();
    const p = discovery.position;
    root.position.copy(p);
    root.rotation.y = (discovery.spec.x * 0.013 + discovery.spec.z * 0.007) % (Math.PI * 2);
    switch (discovery.spec.kind) {
      case 'wreck': {
        // A crashed mail plane, nose down in the ground with a wing torn off.
        place(root, cyl(0.9, 0.6, 7.5, 12), metal, 0, 1.2, 0, [Math.PI / 2 - 0.25, 0, 0.3]);
        place(root, box(12, 0.25, 2.2), fabric, 1.5, 0.6, 1.2, [0.05, 0.2, -0.18]);
        place(root, box(6, 0.25, 2), fabric, -6, 0.3, -3, [0.3, 0.9, 0.5]);
        place(root, box(0.2, 2.2, 1.6), rust, -0.5, 2.6, -3.4, [0.2, 0, 0.3]);
        place(root, cyl(0.15, 0.15, 3, 6), rust, 1.2, 0.6, 3.2, [0.4, 0, 1.2]);
        break;
      }
      case 'cairn': {
        const rock = track(kit, new DodecahedronGeometry(1));
        for (let i = 0; i < 6; i += 1) {
          const r = 1.6 - i * 0.22;
          const stoneMesh = place(
            root,
            rock,
            stone,
            Math.sin(i * 2.1) * 0.3,
            0.8 + i * 1.15,
            Math.cos(i * 1.7) * 0.3,
          );
          stoneMesh.scale.set(r * 1.3, r * 0.75, r * 1.2);
        }
        place(root, cyl(0.08, 0.08, 8, 6), timber, 0, 9.5, 0);
        place(root, box(0.08, 1.6, 2.6), flag, 0, 12.4, 1.3);
        break;
      }
      case 'cabin': {
        place(root, box(7, 4, 5.5), timber, 0, 2, 0);
        const ridge = track(kit, new CylinderGeometry(0.01, 4.6, 3, 4, 1));
        const roofMesh = place(root, ridge, roof, 0, 5.4, 0, [0, Math.PI / 4, 0]);
        roofMesh.scale.set(1.15, 1, 0.9);
        place(root, box(0.9, 2.6, 0.9), stone, 2.2, 6, 1.2);
        place(root, box(1.4, 2.2, 0.15), white, 1.6, 1.3, 2.8);
        break;
      }
      case 'beacon': {
        // A lattice relay mast with a blinking light.
        for (let i = 0; i < 3; i += 1) {
          const a = (i / 3) * Math.PI * 2;
          place(root, cyl(0.15, 0.3, 34, 6), white, Math.cos(a) * 1.4, 17, Math.sin(a) * 1.4, [
            Math.sin(a) * 0.04,
            0,
            -Math.cos(a) * 0.04,
          ]);
        }
        for (let y = 4; y < 34; y += 6)
          place(root, cyl(1.5 - y * 0.02, 1.5 - y * 0.02, 0.3, 6), flag, 0, y, 0);
        place(root, box(5, 3, 4), metal, 4, 1.5, 0);
        blinkers.push(place(root, track(kit, new SphereGeometry(0.8, 10, 8)), lamp, 0, 35, 0));
        break;
      }
      case 'shipwreck': {
        const hullMesh = place(
          root,
          track(kit, new SphereGeometry(4, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
          hull,
          0,
          0.6,
          0,
          [Math.PI, 0, 0.35],
        );
        hullMesh.scale.set(1, 0.7, 4.2);
        place(root, cyl(0.25, 0.3, 16, 6), timber, 0.8, 6.5, 4, [0.12, 0, 0.45]);
        place(root, cyl(0.2, 0.25, 12, 6), timber, 0.5, 4.5, -5, [-0.1, 0, 0.5]);
        place(root, box(0.1, 5, 6), fabric, 3.2, 9, 4, [0.12, 0, 0.45]);
        break;
      }
      case 'buoy': {
        place(root, cyl(1.8, 2.2, 2.5, 14), flag, 0, 0.6, 0);
        place(root, cyl(0.6, 1.4, 5, 6), white, 0, 4, 0);
        blinkers.push(place(root, track(kit, new SphereGeometry(0.6, 10, 8)), lamp, 0, 7, 0));
        break;
      }
      case 'observatory': {
        place(root, cyl(7, 7.5, 7, 20), white, 0, 3.5, 0);
        const dome = place(
          root,
          track(kit, new SphereGeometry(7, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2)),
          metal,
          0,
          7,
          0,
        );
        dome.rotation.y = 0.6;
        place(
          root,
          box(1.6, 6.5, 14.4),
          track(kit, new MeshBasicMaterial({ color: 0x12182a })),
          0,
          10,
          0,
          [0, 0.6, 0],
        );
        break;
      }
      case 'trail': {
        const torus = track(kit, new TorusGeometry(discovery.rings[0]?.radius ?? 9, 0.55, 8, 32));
        const meshes = discovery.rings.map((ring) => {
          const mesh = new Mesh(torus, trailMaterial);
          mesh.position.copy(ring.position);
          mesh.lookAt(ring.position.clone().add(ring.normal));
          group.add(mesh);
          return mesh;
        });
        trailRings.set(discovery.spec.id, meshes);
        continue;
      }
    }
    group.add(root);
  }

  const fading = new Map<Mesh, number>();
  let now = 0;
  return {
    group,
    update: (time, focus) => {
      now = time;
      const blink = Math.sin(time * 4) > 0.2;
      for (const light of blinkers) light.visible = blink;
      // Trail rings only show up close: you have to find the line.
      for (const meshes of trailRings.values()) {
        for (const mesh of meshes) {
          if (fading.has(mesh)) continue;
          mesh.visible = mesh.position.distanceTo(focus) < TRAIL_VISIBLE;
          if (mesh.visible) mesh.rotation.z = time * 0.8;
        }
      }
      for (const [mesh, start] of fading) {
        const t = (time - start) / 0.5;
        if (t >= 1) {
          mesh.visible = false;
          continue;
        }
        mesh.scale.setScalar(1 + t);
      }
    },
    collectTrailRing: (id, index) => {
      const mesh = trailRings.get(id)?.[index];
      if (mesh && !fading.has(mesh)) fading.set(mesh, now);
    },
    dispose: () => {
      kit.geometries.forEach((g) => g.dispose());
      kit.materials.forEach((m) => m.dispose());
      group.removeFromParent();
    },
  };
};

// --- The air show box ----------------------------------------------------------------------------

export const createShowBox = (
  activity: ShowActivity,
  floor: number,
): { group: Group; dispose: () => void } => {
  const kit: Kit = { geometries: [], materials: [] };
  const group = new Group();
  const { x, z, half } = activity.box;
  const pole = track(kit, new CylinderGeometry(1.4, 1.8, 70, 10));
  const band = track(kit, new CylinderGeometry(1.9, 1.9, 7, 10));
  const cap = track(kit, new ConeGeometry(3, 6, 10));
  const white = standard(kit, 0xf1e8d4);
  const red = standard(kit, 0xd3203f);
  const line = standard(kit, 0xf1e8d4, { emissive: 0x8a8070 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = x + sx * half;
      const pz = z + sz * half;
      place(group, pole, white, px, floor + 35, pz);
      for (let i = 0; i < 4; i += 1) place(group, band, red, px, floor + 8 + i * 16, pz);
      place(group, cap, red, px, floor + 73, pz);
    }
  }
  // The display line along the crowd side.
  const lineGeometry = track(kit, new BoxGeometry(half * 2, 0.6, 3));
  place(group, lineGeometry, line, x, floor + 0.6, z - half);
  return {
    group,
    dispose: () => {
      kit.geometries.forEach((g) => g.dispose());
      kit.materials.forEach((m) => m.dispose());
      group.removeFromParent();
    },
  };
};

// --- Delivery stops ---------------------------------------------------------------------------------

export interface StopProps {
  group: Group;
  /** Highlights the next stop and dims the ones done. */
  setNext: (index: number) => void;
  update: (time: number) => void;
  dispose: () => void;
}

export const createDeliveryStops = (stops: readonly ResolvedStop[]): StopProps => {
  const kit: Kit = { geometries: [], materials: [] };
  const group = new Group();
  const mast = track(kit, new CylinderGeometry(0.35, 0.45, 18, 8));
  const arm = track(kit, new BoxGeometry(0.3, 0.3, 9));
  const bag = track(kit, new SphereGeometry(1.2, 10, 8));
  const ringGeometry = track(kit, new RingGeometry(HOOK_RADIUS - 2.5, HOOK_RADIUS, 48));
  const beamGeometry = track(kit, new CylinderGeometry(3, 3, 400, 12, 1, true));
  const timber = standard(kit, 0x6b4a33);
  const canvas = standard(kit, 0xe8dcc0);
  const visuals = stops.map((stop) => {
    const root = new Group();
    root.position.copy(stop.position);
    const ringMaterial = track(
      kit,
      new MeshBasicMaterial({
        color: PALETTE.amber,
        transparent: true,
        opacity: 0.85,
        side: DoubleSide,
        fog: false,
      }),
    );
    const beamMaterial = track(
      kit,
      new MeshBasicMaterial({
        color: PALETTE.amber,
        transparent: true,
        opacity: 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    const ring = place(root, ringGeometry, ringMaterial, 0, 0.8, 0, [-Math.PI / 2, 0, 0]);
    const beam = place(root, beamGeometry, beamMaterial, 0, 200, 0);
    if (stop.water) {
      place(root, track(kit, new CylinderGeometry(2, 2.4, 2.5, 12)), standard(kit, 0xe0442a), 0, 0.5, 0);
      place(root, mast, timber, 0, 9, 0);
    } else {
      // Two masts with a line strung between them: the classic mail-pickup rig.
      place(root, mast, timber, -4.5, 9, 0);
      place(root, mast, timber, 4.5, 9, 0);
      place(root, arm, timber, 0, 17.5, 0, [0, Math.PI / 2, 0]);
      place(root, bag, canvas, 0, 15.5, 0);
    }
    group.add(root);
    return { ring, ringMaterial, beam, beamMaterial };
  });
  let next = 0;
  const setNext = (index: number) => {
    next = index;
    visuals.forEach((visual, i) => {
      const done = i < index;
      visual.ringMaterial.color.setHex(done ? 0x56606b : i === index ? PALETTE.amber : 0xf1e8d4);
      visual.ringMaterial.opacity = done ? 0.35 : i === index ? 0.9 : 0.5;
      visual.beam.visible = i === index;
    });
  };
  setNext(0);
  return {
    group,
    setNext,
    update: (time) => {
      const visual = visuals[next];
      if (visual) visual.beamMaterial.opacity = 0.14 + 0.06 * Math.sin(time * 3);
    },
    dispose: () => {
      kit.geometries.forEach((g) => g.dispose());
      kit.materials.forEach((m) => m.dispose());
      group.removeFromParent();
    },
  };
};
