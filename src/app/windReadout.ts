import { Vector3, type Camera } from 'three';

const _forward = new Vector3();
const _right = new Vector3();

/**
 * The wind as the HUD shows it: an arrow angle relative to the view (0 points
 * up the screen, a tailwind; π is a headwind) and the speed in km/h.
 */
export const windReadout = (wind: Vector3, camera: Camera): { angle: number; kmh: number } => {
  _forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _forward.y = 0;
  _right.y = 0;
  _forward.normalize();
  _right.normalize();
  const x = wind.x * _right.x + wind.z * _right.z;
  const y = wind.x * _forward.x + wind.z * _forward.z;
  return { angle: Math.atan2(x, y), kmh: Math.round(Math.hypot(wind.x, wind.z) * 3.6) };
};
