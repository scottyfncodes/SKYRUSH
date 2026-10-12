import type { Material } from 'three';
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { ResolvedBuild } from '../aircraft/build';
import type { EnginePart, FuselagePart, WingPart } from '../aircraft/parts';
import {
  createAccentMaterial,
  createBodyMaterial,
  createCanopyMaterial,
  createDarkMetalMaterial,
  createGlowMaterial,
} from './materials';

/**
 * Procedural aircraft assembly.
 * Local frame: +Z nose, +Y up, +X right. Units are metres.
 * Every part reports mount points so engines and wings attach in coherent places
 * regardless of which fuselage is installed.
 */

export interface AircraftModelHandles {
  root: Group;
  /** Exhaust flame meshes, scaled by throttle/boost. */
  exhausts: Mesh[];
  /** Exhaust glow discs. */
  glows: Mesh[];
  /** Control surfaces animated from input. */
  ailerons: { left: Object3D; right: Object3D };
  elevators: Object3D[];
  rudders: Object3D[];
  airbrakes: Object3D[];
  /** Materials with emissive accents (for overheat tinting). */
  accentMaterials: MeshStandardMaterial[];
  engineMaterials: MeshStandardMaterial[];
  /** Wingtip positions in the aircraft's local frame (contrail emitters). */
  wingtips: Vector3[];
  dispose: () => void;
}

interface FuselageLayout {
  length: number;
  maxRadius: number;
  widthScale: number;
  /** Where wings attach: lateral half width at root, vertical offset, chord centre z. */
  wingRoot: { x: number; y: number; z: number };
  /** Centre line engine mount (z of nozzle face, y). */
  engineMount: { y: number; z: number };
  /** Outboard engine mount for twin nacelles. */
  outboardMount: { x: number; y: number; z: number };
  tailZ: number;
  canopy: { z: number; y: number; length: number; width: number };
}

const LAYOUTS: Record<FuselagePart['visual'], FuselageLayout> = {
  needle: {
    length: 10.6,
    maxRadius: 0.5,
    widthScale: 1,
    wingRoot: { x: 0.4, y: -0.05, z: -0.6 },
    engineMount: { y: 0.05, z: -4.6 },
    outboardMount: { x: 1.35, y: -0.15, z: -3.2 },
    tailZ: -5.2,
    canopy: { z: 1.5, y: 0.36, length: 2.4, width: 0.5 },
  },
  allrounder: {
    length: 9.2,
    maxRadius: 0.72,
    widthScale: 1.1,
    wingRoot: { x: 0.6, y: -0.1, z: -0.4 },
    engineMount: { y: 0.1, z: -4.1 },
    outboardMount: { x: 1.65, y: -0.2, z: -2.8 },
    tailZ: -4.5,
    canopy: { z: 1.3, y: 0.54, length: 2.6, width: 0.64 },
  },
  heavy: {
    length: 8.8,
    maxRadius: 0.95,
    widthScale: 1.45,
    wingRoot: { x: 1.1, y: -0.15, z: -0.3 },
    engineMount: { y: 0.15, z: -3.9 },
    outboardMount: { x: 2.1, y: -0.25, z: -2.6 },
    tailZ: -4.3,
    canopy: { z: 1.1, y: 0.74, length: 2.8, width: 0.8 },
  },
};

const latheAlongZ = (points: Vector2[], segments = 28): LatheGeometry => {
  const geometry = new LatheGeometry(points, segments);
  geometry.rotateX(Math.PI / 2); // lathe axis Y → +Z (profile y becomes nose-ward z)
  geometry.computeVertexNormals();
  return geometry;
};

const fuselageProfile = (visual: FuselagePart['visual'], layout: FuselageLayout): Vector2[] => {
  const half = layout.length / 2;
  const r = layout.maxRadius;
  switch (visual) {
    case 'needle':
      return [
        new Vector2(0.001, half),
        new Vector2(0.08, half - 1.2),
        new Vector2(0.24, half - 2.8),
        new Vector2(r * 0.9, half - 4.4),
        new Vector2(r, -0.4),
        new Vector2(r * 0.92, -2.2),
        new Vector2(r * 0.6, -half + 1.2),
        new Vector2(r * 0.42, -half + 0.3),
        new Vector2(0.001, -half),
      ];
    case 'allrounder':
      return [
        new Vector2(0.001, half),
        new Vector2(0.18, half - 0.6),
        new Vector2(0.48, half - 1.8),
        new Vector2(r * 0.95, half - 3.4),
        new Vector2(r, -0.6),
        new Vector2(r * 0.9, -2.4),
        new Vector2(r * 0.62, -half + 0.8),
        new Vector2(r * 0.5, -half + 0.2),
        new Vector2(0.001, -half),
      ];
    case 'heavy':
      return [
        new Vector2(0.001, half),
        new Vector2(0.35, half - 0.5),
        new Vector2(0.7, half - 1.4),
        new Vector2(r, half - 2.8),
        new Vector2(r, -1.2),
        new Vector2(r * 0.88, -2.8),
        new Vector2(r * 0.7, -half + 0.6),
        new Vector2(r * 0.55, -half + 0.15),
        new Vector2(0.001, -half),
      ];
  }
};

const wingShape = (
  visual: WingPart['visual'],
): { shape: Shape; span: number; tipChord: number; aileronSpan: number } => {
  // Half wing in the XZ plane: x outward (span), y in the shape = forward (z).
  const shape = new Shape();
  switch (visual) {
    case 'compact': {
      const span = 3.3;
      shape.moveTo(0, 1.3);
      shape.lineTo(span, -0.55);
      shape.lineTo(span, -1.45);
      shape.lineTo(0, -1.5);
      shape.closePath();
      return { shape, span, tipChord: 0.9, aileronSpan: 1.5 };
    }
    case 'balanced': {
      const span = 4.7;
      shape.moveTo(0, 1.4);
      shape.lineTo(span * 0.55, 0.2);
      shape.lineTo(span, -0.75);
      shape.lineTo(span, -1.4);
      shape.lineTo(span * 0.4, -1.6);
      shape.lineTo(0, -1.65);
      shape.closePath();
      return { shape, span, tipChord: 0.65, aileronSpan: 1.7 };
    }
    case 'highlift': {
      const span = 6.3;
      shape.moveTo(0, 1.5);
      shape.lineTo(span * 0.45, 0.9);
      shape.lineTo(span, 0.1);
      shape.lineTo(span, -0.95);
      shape.lineTo(span * 0.5, -1.7);
      shape.lineTo(0, -1.9);
      shape.closePath();
      return { shape, span, tipChord: 1.05, aileronSpan: 2.2 };
    }
  }
};

const extrudeFlat = (shape: Shape, thickness: number): ExtrudeGeometry => {
  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.5,
    bevelSize: 0.08,
    bevelSegments: 2,
  });
  // Shape lies in XY with extrusion along Z. We want the shape in XZ (y = forward → z) and thickness along Y.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, thickness * 0.5, 0);
  geometry.computeVertexNormals();
  return geometry;
};

const disposeObject = (object: Object3D): void => {
  object.traverse((child) => {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      const material = child.material as Material | Material[];
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
  });
};

export const buildAircraftModel = (build: ResolvedBuild): AircraftModelHandles => {
  const { fuselage, engine, wings, livery } = build;
  const layout = LAYOUTS[fuselage.visual];
  const root = new Group();
  root.name = `aircraft-${fuselage.id}-${engine.id}-${wings.id}`;

  const bodyMaterial = createBodyMaterial(livery.base);
  const secondaryMaterial = createBodyMaterial(livery.secondary);
  const accentMaterial = createAccentMaterial(livery.accent);
  const darkMetal = createDarkMetalMaterial();
  const canopyMaterial = createCanopyMaterial(livery.canopy);
  const engineMaterial = new MeshStandardMaterial({ color: 0x3a3e46, roughness: 0.5, metalness: 0.75 });
  const heatMaterial = new MeshStandardMaterial({
    color: 0x2b2a2a,
    roughness: 0.7,
    metalness: 0.6,
    emissive: 0xff5a1f,
    emissiveIntensity: 0.0,
  });
  const exhaustMaterial = createGlowMaterial(0xff9a3a, 0.32);
  const glowMaterial = createGlowMaterial(0xffc46a, 0.28);

  const exhausts: Mesh[] = [];
  const glows: Mesh[] = [];
  const elevators: Object3D[] = [];
  const rudders: Object3D[] = [];
  const airbrakes: Object3D[] = [];

  // --- Fuselage -------------------------------------------------------------------
  const fuselageMesh = new Mesh(latheAlongZ(fuselageProfile(fuselage.visual, layout)), bodyMaterial);
  fuselageMesh.scale.x = layout.widthScale;
  fuselageMesh.castShadow = true;
  root.add(fuselageMesh);

  // Underside secondary panel.
  const belly = new Mesh(
    new BoxGeometry(layout.maxRadius * 1.5 * layout.widthScale, 0.18, layout.length * 0.42),
    secondaryMaterial,
  );
  belly.position.set(0, -layout.maxRadius * 0.78, -0.4);
  root.add(belly);

  // Spine accent stripe.
  const spine = new Mesh(new BoxGeometry(0.16, 0.06, layout.length * 0.55), accentMaterial);
  spine.position.set(0, layout.maxRadius * 0.98, -0.8);
  root.add(spine);

  // Canopy.
  const canopy = new Mesh(new SphereGeometry(1, 20, 14), canopyMaterial);
  canopy.scale.set(layout.canopy.width * 0.55, layout.canopy.width * 0.5, layout.canopy.length * 0.5);
  canopy.position.set(0, layout.canopy.y, layout.canopy.z);
  root.add(canopy);
  const canopyFrame = new Mesh(new TorusGeometry(layout.canopy.width * 0.54, 0.03, 6, 24), darkMetal);
  canopyFrame.rotation.x = Math.PI / 2;
  canopyFrame.position.set(0, layout.canopy.y, layout.canopy.z - layout.canopy.length * 0.15);
  canopyFrame.scale.set(1, 1, 0.7);
  root.add(canopyFrame);

  // Nose sensor / pitot.
  const pitot = new Mesh(new CylinderGeometry(0.03, 0.03, 0.9, 6), darkMetal);
  pitot.rotation.x = Math.PI / 2;
  pitot.position.set(0, 0, layout.length / 2 + 0.3);
  root.add(pitot);

  // Intakes on the flanks.
  const intakeGeometry = new BoxGeometry(0.32, 0.5, 1.6);
  for (const side of [-1, 1]) {
    const intake = new Mesh(intakeGeometry, darkMetal);
    intake.position.set(side * (layout.maxRadius * layout.widthScale + 0.1), -0.05, 0.6);
    root.add(intake);
    const intakeLip = new Mesh(new BoxGeometry(0.36, 0.56, 0.12), accentMaterial);
    intakeLip.position.set(side * (layout.maxRadius * layout.widthScale + 0.1), -0.05, 1.42);
    root.add(intakeLip);
  }

  // Tail: vertical fin and horizontal stabilisers with elevators.
  const finShape = new Shape();
  finShape.moveTo(0, 0.9);
  finShape.lineTo(1.5, 0);
  finShape.lineTo(-0.6, -1.1);
  finShape.lineTo(-0.9, 0.1);
  finShape.closePath();
  const finGeometry = new ExtrudeGeometry(finShape, {
    depth: 0.1,
    bevelEnabled: true,
    bevelSize: 0.04,
    bevelThickness: 0.04,
    bevelSegments: 2,
  });
  finGeometry.rotateY(-Math.PI / 2); // shape XY → ZY (shape x becomes forward z)
  finGeometry.computeVertexNormals();
  const finCount = fuselage.visual === 'heavy' ? 2 : 1;
  for (let i = 0; i < finCount; i += 1) {
    const fin = new Mesh(finGeometry, bodyMaterial);
    const offset = finCount === 2 ? (i === 0 ? -0.9 : 0.9) : 0;
    fin.position.set(offset, layout.maxRadius * 0.6, layout.tailZ + 0.4);
    fin.rotation.z = finCount === 2 ? -offset * 0.3 : 0;
    fin.scale.setScalar(fuselage.visual === 'needle' ? 0.85 : 1);
    root.add(fin);
    const rudder = new Mesh(new BoxGeometry(0.08, 0.7, 0.45), accentMaterial);
    rudder.position.set(0, 0.5, -1.0);
    fin.add(rudder);
    rudders.push(rudder);
  }

  const stabGeometry = new BoxGeometry(1.0, 0.08, 0.9);
  for (const side of [-1, 1]) {
    const stab = new Mesh(stabGeometry, bodyMaterial);
    stab.position.set(side * (layout.maxRadius * layout.widthScale + 0.45), 0.05, layout.tailZ + 0.3);
    stab.rotation.y = side * 0.35;
    root.add(stab);
    const elevatorPivot = new Object3D();
    elevatorPivot.position.set(0, 0, -0.45);
    stab.add(elevatorPivot);
    const elevator = new Mesh(new BoxGeometry(0.95, 0.06, 0.35), accentMaterial);
    elevator.position.set(0, 0, -0.18);
    elevatorPivot.add(elevator);
    elevators.push(elevatorPivot);
  }

  // Airbrake petals on the upper rear fuselage.
  for (const side of [-1, 1]) {
    const pivot = new Object3D();
    pivot.position.set(side * 0.28, layout.maxRadius * 0.9, -1.8);
    const petal = new Mesh(new BoxGeometry(0.5, 0.05, 1.1), bodyMaterial);
    petal.position.set(0, 0.03, -0.55);
    pivot.add(petal);
    root.add(pivot);
    airbrakes.push(pivot);
  }

  // Canards for the needle fuselage.
  if (fuselage.visual === 'needle') {
    for (const side of [-1, 1]) {
      const canard = new Mesh(new BoxGeometry(1.1, 0.06, 0.5), bodyMaterial);
      canard.position.set(side * 0.9, 0, 2.6);
      canard.rotation.y = side * 0.5;
      root.add(canard);
    }
  }

  // Heavy frame gets armour ribs and extra cooling vents.
  if (fuselage.visual === 'heavy') {
    for (let i = 0; i < 4; i += 1) {
      const rib = new Mesh(new TorusGeometry(layout.maxRadius * 1.02, 0.05, 6, 28), darkMetal);
      rib.scale.x = layout.widthScale;
      rib.position.z = -2.4 + i * 0.9;
      root.add(rib);
    }
    for (const side of [-1, 1]) {
      const vent = new Mesh(new BoxGeometry(0.5, 0.25, 1.4), heatMaterial);
      vent.position.set(side * layout.maxRadius * layout.widthScale * 0.95, 0.35, -2.0);
      root.add(vent);
    }
  }

  // --- Wings --------------------------------------------------------------------------
  const { shape, span, aileronSpan } = wingShape(wings.visual);
  const wingGeometry = extrudeFlat(shape, 0.12);
  const ailerons: { left: Object3D; right: Object3D } = { left: new Object3D(), right: new Object3D() };
  const wingtips: Vector3[] = [];
  for (const side of [-1, 1]) {
    const wing = new Mesh(wingGeometry, bodyMaterial);
    wing.castShadow = true;
    wing.position.set(side * layout.wingRoot.x, layout.wingRoot.y, layout.wingRoot.z);
    wing.scale.x = side;
    wing.rotation.z = side * (wings.visual === 'highlift' ? 0.06 : wings.visual === 'compact' ? -0.03 : 0.02);
    root.add(wing);

    // Wingtip accent.
    const tip = new Mesh(new BoxGeometry(0.12, 0.2, 0.9), accentMaterial);
    tip.position.set(span - 0.05, 0.06, -0.9);
    wing.add(tip);
    wingtips.push(
      new Vector3(side * (layout.wingRoot.x + span), layout.wingRoot.y + 0.06, layout.wingRoot.z - 1.1),
    );

    // Aileron on the outer trailing edge.
    const pivot = new Object3D();
    pivot.position.set(span - aileronSpan * 0.5 - 0.1, 0.06, wings.visual === 'highlift' ? -1.15 : -1.3);
    const aileron = new Mesh(new BoxGeometry(aileronSpan, 0.05, 0.42), secondaryMaterial);
    aileron.position.set(0, 0, -0.2);
    pivot.add(aileron);
    wing.add(pivot);
    if (side < 0) ailerons.left = pivot;
    else ailerons.right = pivot;

    // Flap track fairings on the high-lift set.
    if (wings.visual === 'highlift') {
      for (let i = 0; i < 2; i += 1) {
        const fairing = new Mesh(new BoxGeometry(0.14, 0.18, 1.1), darkMetal);
        fairing.position.set(1.2 + i * 1.6, -0.05, -1.2);
        wing.add(fairing);
      }
    }
  }

  // --- Engine -------------------------------------------------------------------------
  const addNozzle = (
    parent: Object3D,
    radius: number,
    z: number,
    y: number,
    x: number,
    wide = false,
  ): void => {
    const nozzle = new Mesh(
      new CylinderGeometry(radius * 0.72, radius * 0.95, 0.6, 20, 1, true),
      heatMaterial,
    );
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(x, y, z - 0.3);
    parent.add(nozzle);
    const flame = new Mesh(new ConeGeometry(radius * 0.7, 2.4, 14, 1, true), exhaustMaterial);
    flame.rotation.x = -Math.PI / 2; // apex trails behind the nozzle
    flame.position.set(x, y, z - 1.5);
    flame.scale.set(wide ? 1.4 : 1, 1, 1);
    parent.add(flame);
    exhausts.push(flame);
    const glow = new Mesh(new CylinderGeometry(radius * 0.55, radius * 0.55, 0.02, 20), glowMaterial);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(x, y, z - 0.62);
    parent.add(glow);
    glows.push(glow);
  };

  const buildNacelle = (radius: number, length: number): Group => {
    const nacelle = new Group();
    const body = new Mesh(new CylinderGeometry(radius, radius * 0.9, length, 22), engineMaterial);
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    nacelle.add(body);
    const lip = new Mesh(new TorusGeometry(radius * 0.98, radius * 0.14, 8, 24), accentMaterial);
    lip.position.z = length / 2;
    nacelle.add(lip);
    const spinner = new Mesh(new ConeGeometry(radius * 0.45, radius * 0.9, 12), darkMetal);
    spinner.rotation.x = Math.PI / 2;
    spinner.position.z = length / 2 - 0.1;
    nacelle.add(spinner);
    const bladeDisc = new Mesh(new CylinderGeometry(radius * 0.9, radius * 0.9, 0.05, 24), darkMetal);
    bladeDisc.rotation.x = Math.PI / 2;
    bladeDisc.position.z = length / 2 - 0.3;
    nacelle.add(bladeDisc);
    return nacelle;
  };

  const mountEngine = (part: EnginePart): void => {
    switch (part.visual) {
      case 'efficient': {
        const radius = 0.62;
        const length = 3.4;
        const y = -layout.maxRadius * 0.55;
        const nacelle = buildNacelle(radius, length);
        nacelle.position.set(0, y, layout.engineMount.z + length / 2 - 0.3);
        root.add(nacelle);
        addNozzle(root, radius, layout.engineMount.z - 0.3, y, 0);
        // Cooling fins along the nacelle flanks.
        for (let i = 0; i < 3; i += 1) {
          const fin = new Mesh(new BoxGeometry(1.7, 0.05, 0.4), darkMetal);
          fin.position.set(0, y - radius * 0.2, layout.engineMount.z + 0.5 + i * 0.7);
          root.add(fin);
        }
        break;
      }
      case 'twin': {
        const radius = 0.46;
        const length = 3.1;
        for (const side of [-1, 1]) {
          const x = side * layout.outboardMount.x;
          const nacelle = buildNacelle(radius, length);
          nacelle.position.set(x, layout.outboardMount.y, layout.outboardMount.z + length / 2 - 1.2);
          root.add(nacelle);
          const pylon = new Mesh(new BoxGeometry(Math.abs(x) - layout.maxRadius * 0.6, 0.16, 1.2), darkMetal);
          pylon.position.set(x * 0.6, layout.outboardMount.y + 0.1, layout.outboardMount.z - 0.4);
          root.add(pylon);
          addNozzle(root, radius, layout.outboardMount.z - 1.2, layout.outboardMount.y, x);
        }
        break;
      }
      case 'pulse': {
        const width = 1.5;
        const height = 0.8;
        const length = 3.6;
        const drive = new Mesh(new BoxGeometry(width, height, length), engineMaterial);
        drive.castShadow = true;
        drive.position.set(0, layout.engineMount.y - 0.05, layout.engineMount.z + length / 2 - 0.4);
        root.add(drive);
        for (let i = 0; i < 3; i += 1) {
          const ring = new Mesh(new TorusGeometry(0.55, 0.07, 8, 28), i === 1 ? accentMaterial : darkMetal);
          ring.position.set(0, layout.engineMount.y - 0.05, layout.engineMount.z + 0.3 + i * 0.9);
          root.add(ring);
        }
        for (const side of [-1, 1]) {
          const blade = new Mesh(new BoxGeometry(0.06, 1.1, 2.2), secondaryMaterial);
          blade.position.set(
            side * (width / 2 + 0.03),
            layout.engineMount.y + 0.1,
            layout.engineMount.z + 1.2,
          );
          root.add(blade);
        }
        addNozzle(root, 0.62, layout.engineMount.z - 0.4, layout.engineMount.y - 0.05, 0, true);
        break;
      }
    }
  };
  mountEngine(engine);

  // Shadow receivers off (aircraft are shadow casters only).
  root.traverse((child) => {
    if (child instanceof Mesh) child.receiveShadow = false;
  });

  const accentMaterials = [accentMaterial, heatMaterial];
  const engineMaterials = [engineMaterial, heatMaterial];

  return {
    root,
    exhausts,
    glows,
    ailerons,
    elevators,
    rudders,
    airbrakes,
    accentMaterials,
    engineMaterials,
    wingtips,
    dispose: () => {
      disposeObject(root);
      exhaustMaterial.dispose();
      glowMaterial.dispose();
      canopyMaterial.dispose();
    },
  };
};

export const AIRCRAFT_FORWARD = new Vector3(0, 0, 1);
