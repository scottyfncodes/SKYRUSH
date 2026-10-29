import { getAirframe } from '../aircraft/parts';
import { shapeForBuild } from '../render/aircraft/airframes';
import { defaultBuildFor, type AircraftBuild } from '../aircraft/build';
import { sampleBody } from '../render/aircraft/geometry';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Side-view silhouette of an airframe, drawn from the same shape data as the
 * 3D model so the hangar's cards show each aircraft's real profile.
 */
export const airframeSilhouette = (airframeId: string, build?: AircraftBuild): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'silhouette');
  svg.setAttribute('aria-hidden', 'true');
  const airframe = getAirframe(airframeId);
  if (!airframe) return svg;
  const fitted = build ?? defaultBuildFor(airframe);
  const shape = shapeForBuild(fitted);
  const stations = shape.stations;
  const tailZ = stations[stations.length - 1]!.z;
  const noseZ =
    stations[0]!.z +
    (fitted.engine === 'engine-twin' || fitted.engine === 'engine-pod' || shape.pylon ? shape.noseCap : 1.5);
  // Side view: x = −z (nose to the right), y = −height (SVG y grows downward).
  const top: string[] = [];
  const bottom: string[] = [];
  const steps = 24;
  const body = [
    ...(fitted.engine === 'engine-twin' || fitted.engine === 'engine-pod' || shape.pylon
      ? [{ z: stations[0]!.z + shape.noseCap, w: 0.03, top: 0.03, bottom: 0.03, y: stations[0]!.y ?? 0 }]
      : [
          {
            z: noseZ,
            w: 0.08,
            top: stations[0]!.top * 0.3,
            bottom: stations[0]!.bottom * 0.3,
            y: stations[0]!.y ?? 0,
          },
          {
            z: noseZ - 0.4,
            w: 0.4,
            top: stations[0]!.top * 0.85,
            bottom: stations[0]!.bottom * 0.85,
            y: stations[0]!.y ?? 0,
          },
        ]),
    ...stations,
  ];
  for (let i = 0; i <= steps; i += 1) {
    const z = noseZ - ((noseZ - tailZ) * i) / steps;
    const s = sampleBody(body, z);
    top.push(`${(-z).toFixed(2)},${(-(s.y + s.top)).toFixed(2)}`);
    bottom.push(`${(-z).toFixed(2)},${(-(s.y - s.bottom)).toFixed(2)}`);
  }
  const fuselage = `M${top.join(' L')} L${bottom.reverse().join(' L')} Z`;
  const finBase = shape.tail.finY;
  const le = shape.tail.le;
  const fs = shape.tail.scale;
  const fin =
    fitted.tail === 'tail-vee'
      ? `M${-(le + 0.3)},${-finBase} L${-(le - 0.5 * fs)},${-(finBase + 0.75 * fs)} L${-(le - 1.0 * fs)},${-(finBase + 0.7 * fs)} L${-(le - 0.9 * fs)},${-finBase} Z`
      : `M${-(le + 0.55 * fs)},${-finBase} Q${-(le - 0.2 * fs)},${-(finBase + 1.35 * fs)} ${-(le - 0.6 * fs)},${-(finBase + 1.2 * fs)} L${-(le - 0.9 * fs)},${-finBase} Z`;
  // Wing as a thick chord line at its mounting height.
  const wingY = -shape.wing.y;
  const chord = 1.9 * airframe.wingScale;
  const wing = `M${-shape.wing.le},${wingY - 0.08} L${-(shape.wing.le - chord)},${wingY - 0.02} L${-(shape.wing.le - chord)},${wingY + 0.05} L${-shape.wing.le},${wingY + 0.08} Z`;
  const parts = [fuselage, fin, wing];
  // Gear or floats.
  const g = shape.gear;
  if (fitted.gear === 'gear-floats') {
    const y = -(g.ground + 0.3);
    const front = g.z + 3.4;
    parts.push(
      `M${-front},${y - 0.15} Q${-(front - 0.6)},${y + 0.3} ${-(front - 1.4)},${y + 0.3} L${-(front - 6.4)},${y + 0.2} L${-(front - 6.6)},${y - 0.1} Z`,
    );
  } else if (fitted.gear !== 'gear-retract') {
    const wheelY = -(g.ground + 0.3);
    parts.push(
      `M${-g.z - 0.3},${wheelY} a0.3,0.3 0 1,0 0.6,0 a0.3,0.3 0 1,0 -0.6,0 Z`,
      `M${-g.z - 0.05},${-g.attachY} L${-g.z + 0.05},${-g.attachY} L${-g.z + 0.05},${wheelY} L${-g.z - 0.05},${wheelY} Z`,
    );
  }
  if (shape.pylon) {
    const y = -shape.pylon.y;
    parts.push(
      `M${-(shape.pylon.z + 1.2)},${y} Q${-(shape.pylon.z + 1.2)},${y - 0.45} ${-shape.pylon.z},${y - 0.42} L${-(shape.pylon.z - 1.8)},${y} Q${-shape.pylon.z},${y + 0.42} ${-(shape.pylon.z + 1.2)},${y} Z`,
    );
  }
  for (const d of parts) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  const minX = -noseZ - 0.4;
  const width = noseZ - tailZ + 0.8;
  svg.setAttribute('viewBox', `${minX.toFixed(2)} -2.5 ${width.toFixed(2)} 4.6`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return svg;
};
