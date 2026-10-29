// Renders the game's own aircraft model on a transparent canvas for the app icon.
// Loaded by build-aircraft.mjs through the Vite dev server; query parameters
// (yaw, pitch, bank, distance, fov, theme) let the composition be adjusted.
import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Euler,
  HemisphereLight,
  PerspectiveCamera,
  Quaternion,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { DEFAULT_BUILD } from '../../src/aircraft/build';
import { getTheme } from '../../src/aircraft/paint';
import { AircraftView } from '../../src/render/AircraftView';
import { createEnvironmentMap } from '../../src/render/envMap';
import { NEUTRAL_INPUT, createFlightState } from '../../src/flight/FlightModel';

declare global {
  interface Window {
    __shot?: string;
  }
}

const query = new URLSearchParams(window.location.search);
const num = (key: string, fallback: number) => Number(query.get(key) ?? fallback);
const deg = Math.PI / 180;

const canvas = document.getElementById('shot') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1024, 1024, false);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exposure', 1.1);

const scene = new Scene();
const environment = createEnvironmentMap(renderer, {
  zenith: 0x1d3358,
  horizon: 0xf0d9b0,
  ground: 0x3a3a46,
  sun: [0.6, 0.7, 0.4],
  sunColor: 0xfff0d0,
});
scene.add(new HemisphereLight(0xdfe8ff, 0x3a3040, 1.0));
scene.add(new AmbientLight(0xffffff, 0.12));
const sun = new DirectionalLight(0xfff0d6, 3.2);
sun.position.set(6, 9, 4);
scene.add(sun);
const rim = new DirectionalLight(0xffc27a, 1.6);
rim.position.set(-6, 3, -8);
scene.add(rim);

const paint = { ...getTheme(query.get('theme') ?? 'livery-racer')!.paint };
const view = new AircraftView({ build: { ...DEFAULT_BUILD }, paint }, environment.texture);
scene.add(view.root);

// Spin the propeller up so the blades read as a blurred disc with painted tips.
const state = createFlightState(new Vector3(), new Quaternion(), 90);
state.altitude = 200;
state.throttle = num('throttle', 0.75);
for (let i = 0; i < 240; i += 1) view.animate(state, { ...NEUTRAL_INPUT, roll: num('roll', 0.4) }, 1 / 60);

// Pose: nose along +Z, banked into a turn.
view.root.quaternion.setFromEuler(
  new Euler(num('pitch', -10) * deg, num('yaw', 0) * deg, num('bank', -32) * deg, 'YXZ'),
);

const camera = new PerspectiveCamera(num('fov', 28), 1, 0.1, 200);
const distance = num('distance', 26);
const azimuth = num('azimuth', 38) * deg;
const elevation = num('elevation', 12) * deg;
camera.position.set(
  Math.sin(azimuth) * Math.cos(elevation) * distance,
  Math.sin(elevation) * distance,
  Math.cos(azimuth) * Math.cos(elevation) * distance,
);
camera.lookAt(new Vector3(num('lookX', 0), num('lookY', 0), num('lookZ', 0)));
camera.updateProjectionMatrix();

renderer.render(scene, camera);
window.__shot = canvas.toDataURL('image/png');
