import {
  BackSide,
  BufferAttribute,
  Color,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Vector3,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

export interface EnvironmentColors {
  zenith: number;
  horizon: number;
  ground: number;
  /** Direction toward the sun (any length). */
  sun: readonly [number, number, number];
  sunColor: number;
  /** Extra warm or cool panels for a studio look (hangar). */
  panels?: { color: number; direction: readonly [number, number, number]; size: number }[];
}

/**
 * Bakes a small prefiltered environment from a gradient sky plus a sun so that
 * painted metal, enamel and canopy glass have something to reflect. Built once
 * per scene; the cost is a single cube render and blur. Dispose the returned target with the scene.
 */
export const createEnvironmentMap = (gl: WebGLRenderer, colors: EnvironmentColors): WebGLRenderTarget => {
  const scene = new Scene();
  const sky = new SphereGeometry(50, 32, 16);
  const position = sky.getAttribute('position') as BufferAttribute;
  const vertexColors = new Float32Array(position.count * 3);
  const zenith = new Color(colors.zenith);
  const horizon = new Color(colors.horizon);
  const ground = new Color(colors.ground);
  const tmp = new Color();
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i) / 50;
    if (y >= 0) tmp.copy(horizon).lerp(zenith, Math.pow(y, 0.6));
    else tmp.copy(horizon).lerp(ground, Math.min(1, -y * 3));
    vertexColors[i * 3] = tmp.r;
    vertexColors[i * 3 + 1] = tmp.g;
    vertexColors[i * 3 + 2] = tmp.b;
  }
  sky.setAttribute('color', new BufferAttribute(vertexColors, 3));
  const skyMaterial = new MeshBasicMaterial({ vertexColors: true, side: BackSide });
  scene.add(new Mesh(sky, skyMaterial));

  const disposables: { dispose: () => void }[] = [sky, skyMaterial];
  const addLight = (direction: readonly [number, number, number], color: number, size: number, scale = 1) => {
    const geometry = new SphereGeometry(size, 12, 8);
    const material = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(scale) });
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(new Vector3(...direction).normalize().multiplyScalar(40));
    scene.add(mesh);
    disposables.push(geometry, material);
  };
  addLight(colors.sun, colors.sunColor, 3.2, 6);
  for (const panel of colors.panels ?? []) addLight(panel.direction, panel.color, panel.size, 2);

  const generator = new PMREMGenerator(gl);
  const target = generator.fromScene(scene, 0.02);
  generator.dispose();
  for (const item of disposables) item.dispose();
  return target;
};
