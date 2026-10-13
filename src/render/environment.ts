import type { Vector3 } from 'three';
import {
  BackSide,
  BufferAttribute,
  Color,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
} from 'three';
import type { CourseTheme, TerrainPalette } from '../course/themes';
import type { Terrain } from '../course/terrain';
import { hash2 } from '../core/rng';
import { clamp01, smoothstep } from '../core/math';

/** Shared GLSL value noise (2D) for the sky clouds. */
const noiseGlsl = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * vnoise(p);
      p = p * 2.03 + vec2(17.1, 9.2);
      amplitude *= 0.5;
    }
    return value;
  }
`;

const skyVertex = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 zenithColor;
  uniform vec3 horizonColor;
  uniform vec3 groundColor;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform vec3 glowColor;
  uniform vec3 cloudLit;
  uniform vec3 cloudShade;
  uniform float cloudCover;
  uniform float time;
  varying vec3 vDirection;
  ${noiseGlsl}
  void main() {
    vec3 dir = normalize(vDirection);
    float y = dir.y;
    float up = clamp(y, 0.0, 1.0);
    vec3 color = mix(horizonColor, zenithColor, pow(up, 0.5));
    color = mix(color, groundColor, smoothstep(0.0, -0.1, y));

    float sunDot = max(dot(dir, sunDirection), 0.0);
    // Warm haze toward the sun, strongest at the horizon.
    color += glowColor * pow(sunDot, 5.0) * 0.32 * (1.0 - up);
    color += glowColor * pow(sunDot, 48.0) * 0.45;

    if (y > 0.0 && cloudCover > 0.0) {
      vec2 uv = dir.xz / (y + 0.14) * 1.4 + vec2(time * 0.006, time * 0.0025);
      float n = fbm(uv);
      float density = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + 0.3, n);
      // Cheap self-shadowing: sample again toward the sun.
      float toward = fbm(uv + sunDirection.xz * 0.12);
      float light = clamp(0.55 + (n - toward) * 3.5 + pow(sunDot, 4.0) * 0.35, 0.0, 1.0);
      vec3 cloud = mix(cloudShade, cloudLit, light);
      density *= smoothstep(0.0, 0.2, y);
      color = mix(color, cloud, density * 0.9);
    }

    color += sunColor * smoothstep(0.99925, 0.9997, sunDot) * 3.0;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface SkyHandles {
  mesh: Mesh;
  material: ShaderMaterial;
  update: (time: number, focus: Vector3) => void;
}

export const createSky = (theme: CourseTheme, sunDirection: Vector3): SkyHandles => {
  const material = new ShaderMaterial({
    uniforms: {
      zenithColor: { value: new Color(theme.sky.zenith) },
      horizonColor: { value: new Color(theme.sky.horizon) },
      groundColor: { value: new Color(theme.sky.ground) },
      sunDirection: { value: sunDirection.clone().normalize() },
      sunColor: { value: new Color(theme.sun.color) },
      glowColor: { value: new Color(theme.sun.glow) },
      cloudLit: { value: new Color(theme.sky.cloudLit) },
      cloudShade: { value: new Color(theme.sky.cloudShade) },
      cloudCover: { value: theme.sky.clouds },
      time: { value: 0 },
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new Mesh(new SphereGeometry(6000, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return {
    mesh,
    material,
    update: (time, focus) => {
      material.uniforms.time!.value = time;
      mesh.position.copy(focus);
    },
  };
};

// --- Terrain palette -------------------------------------------------------------------

const _floor = new Color();
const _vegetation = new Color();
const _rock = new Color();
const _cliff = new Color();
const _peak = new Color();
const _band = new Color();
const _beach = new Color();

/**
 * Ground colour from altitude, slope (0 flat .. 1 vertical) and position.
 * Layers: floor → vegetation patches → rock with height and slope → sedimentary
 * strata on cliffs → dark cliff faces → snow/peak → beach at the waterline.
 */
export const terrainColor = (
  palette: TerrainPalette,
  height: number,
  slope: number,
  x: number,
  z: number,
  seaLevel: number | null,
  target: Color,
): Color => {
  _floor.setHex(palette.floor);
  _vegetation.setHex(palette.vegetation);
  _rock.setHex(palette.rock);
  _cliff.setHex(palette.cliff);
  _peak.setHex(palette.peak);

  const grain = hash2(Math.floor(x / 23), Math.floor(z / 23)) * 0.1 - 0.05;
  const patch = hash2(Math.floor(x / 90), Math.floor(z / 90));
  const broad = hash2(Math.floor(x / 400), Math.floor(z / 400));

  target.copy(_floor);
  const [vegLow, vegHigh] = palette.vegetationAltitude;
  const vegBand =
    smoothstep(vegLow - 10, vegLow + 10, height) * (1 - smoothstep(vegHigh - 40, vegHigh, height));
  const [vegSlopeLow, vegSlopeHigh] = palette.vegetationSlope ?? [0.35, 0.65];
  // Full cover (amount 1) carpets suitable ground; lower amounts leave patches.
  const cover = palette.vegetationAmount >= 1 ? 1 : smoothstep(0.35, 0.8, patch * 0.6 + broad * 0.5);
  const vegetation =
    cover * palette.vegetationAmount * vegBand * (1 - smoothstep(vegSlopeLow, vegSlopeHigh, slope));
  target.lerp(_vegetation, clamp01(vegetation));

  const [rockLow, rockHigh] = palette.rockAltitude;
  const [rockSlopeLow, rockSlopeHigh] = palette.rockSlope ?? [0.22, 0.55];
  const rockMix =
    smoothstep(rockLow, rockHigh, height) * 0.7 + smoothstep(rockSlopeLow, rockSlopeHigh, slope) * 0.75;
  target.lerp(_rock, clamp01(rockMix));

  if (palette.strata) {
    const { colors, spacing, strength } = palette.strata;
    // Slightly wavy layers so the bands read as rock, not contour lines.
    const warp = Math.sin(x * 0.004 + z * 0.002) * spacing * 0.6 + grain * spacing * 2;
    const index = Math.floor((height + warp) / spacing);
    const color = colors[((index % colors.length) + colors.length) % colors.length]!;
    _band.setHex(color);
    target.lerp(_band, strength * smoothstep(0.18, 0.5, slope));
  }

  target.lerp(_cliff, smoothstep(0.55, 0.95, slope) * 0.6);
  const [peakLow, peakHigh] = palette.peakAltitude;
  target.lerp(_peak, smoothstep(peakLow, peakHigh, height) * (1 - smoothstep(0.5, 0.85, slope)));

  if (palette.beach && seaLevel !== null) {
    _beach.setHex(palette.beach.color);
    const above = height - seaLevel;
    const beach = 1 - smoothstep(palette.beach.height * 0.5, palette.beach.height * 1.6, above);
    target.lerp(_beach, clamp01(beach) * (1 - smoothstep(0.35, 0.7, slope)));
  }

  target.offsetHSL(0, 0, grain + (broad - 0.5) * 0.05);
  return target;
};

// --- Water ---------------------------------------------------------------------------------

const waterVertex = /* glsl */ `
  attribute float depth;
  varying float vDepth;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vDepth = depth;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const waterFragment = /* glsl */ `
  uniform vec3 shallowColor;
  uniform vec3 deepColor;
  uniform vec3 foamColor;
  uniform vec3 skyColor;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform float time;
  varying float vDepth;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  void main() {
    vec2 p = vWorld.xz;
    // Analytic wave normal from a few travelling sines, calmed with distance to avoid moiré.
    vec2 k1 = vec2(0.031, 0.011); vec2 k2 = vec2(-0.017, 0.043); vec2 k3 = vec2(0.067, -0.052);
    vec2 k4 = vec2(-0.11, -0.083);
    vec2 grad = k1 * cos(dot(k1, p) * 6.2831 + time * 1.1) * 0.9
              + k2 * cos(dot(k2, p) * 6.2831 - time * 0.9) * 0.8
              + k3 * cos(dot(k3, p) * 6.2831 + time * 1.7) * 0.4
              + k4 * cos(dot(k4, p) * 6.2831 - time * 2.3) * 0.25;
    float calm = 1.0 / (1.0 + distance(cameraPosition.xz, p) / 350.0);
    vec3 normal = normalize(vec3(-grad.x * 1.8 * calm, 1.0, -grad.y * 1.8 * calm));
    vec3 view = normalize(cameraPosition - vWorld);

    float d = clamp(vDepth / 22.0, 0.0, 1.0);
    vec3 color = mix(shallowColor, deepColor, sqrt(d));
    float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 4.0);
    color = mix(color, skyColor, fresnel * 0.55);
    float spec = pow(max(dot(reflect(-sunDirection, normal), view), 0.0), 140.0);
    color += sunColor * spec * 1.6;
    float foam = (1.0 - smoothstep(0.0, 1.6, vDepth)) * (0.65 + 0.35 * sin(time * 2.0 + p.x * 0.35 + p.y * 0.2));
    color = mix(color, foamColor, foam * 0.85);

    float alpha = mix(0.62, 0.97, d) + foam * 0.3 + fresnel * 0.2;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export interface WaterHandles {
  meshes: Mesh[];
  material: ShaderMaterial;
  update: (time: number) => void;
}

/**
 * Water: a fine grid over the course carrying the depth to the seabed (for shallow
 * turquoise, foam lines and see-through shallows) plus a coarse plane to the horizon.
 */
export const createWater = (
  theme: CourseTheme,
  terrain: Terrain,
  seaLevel: number,
  center: { x: number; z: number },
  size: number,
  sunDirection: Vector3,
): WaterHandles | null => {
  if (!theme.water) return null;
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        shallowColor: { value: new Color(theme.water.shallow) },
        deepColor: { value: new Color(theme.water.deep) },
        foamColor: { value: new Color(theme.water.foam) },
        skyColor: { value: new Color(theme.sky.horizon) },
        sunDirection: { value: sunDirection.clone().normalize() },
        sunColor: { value: new Color(theme.sun.color) },
        time: { value: 0 },
      },
    ]),
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
    transparent: true,
    depthWrite: false,
    fog: true,
  });

  const segments = 200;
  const near = new PlaneGeometry(size, size, segments, segments);
  near.rotateX(-Math.PI / 2);
  const positions = near.attributes.position as BufferAttribute;
  const depth = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i) + center.x;
    const z = positions.getZ(i) + center.z;
    positions.setXYZ(i, x, seaLevel, z);
    depth[i] = seaLevel - terrain.groundAt(x, z);
  }
  near.setAttribute('depth', new BufferAttribute(depth, 1));
  near.computeBoundingSphere();

  // Open sea beyond the terrain: four deep-water planes framing the course square.
  const outer = 40000;
  const band = (outer - size) / 2;
  const meshes: Mesh[] = [];
  const frame: [number, number, number, number][] = [
    [outer, band, 0, (size + band) / 2],
    [outer, band, 0, -(size + band) / 2],
    [band, size, (size + band) / 2, 0],
    [band, size, -(size + band) / 2, 0],
  ];
  for (const [width, height, dx, dz] of frame) {
    const plane = new PlaneGeometry(width, height, 1, 1);
    plane.rotateX(-Math.PI / 2);
    plane.translate(center.x + dx, seaLevel, center.z + dz);
    plane.setAttribute(
      'depth',
      new BufferAttribute(new Float32Array(plane.attributes.position!.count).fill(80), 1),
    );
    meshes.push(new Mesh(plane, material));
  }
  meshes.push(new Mesh(near, material));
  return {
    meshes,
    material,
    update: (time) => {
      material.uniforms.time!.value = time;
    },
  };
};
