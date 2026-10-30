import type { Vector3 } from 'three';
import type { CourseTheme } from '../course/themes';
import { clamp01 } from '../core/math';

/**
 * Flying conditions: the light (time of day) and the weather. Conditions grade a
 * course's authored theme (sky, sun, fog) and set the wind the flight model
 * flies through. Pure data and functions: the renderer and the simulations both
 * read from here, and nothing in this file touches three.js scenes or the DOM.
 */

/** `authored` keeps the region's own light (each region already has a time of day). */
export type TimeOfDay = 'authored' | 'dawn' | 'dusk';
export type Weather = 'clear' | 'breezy' | 'gusty' | 'fog' | 'rain';

export interface Conditions {
  time: TimeOfDay;
  weather: Weather;
  /** Direction the wind blows toward, as a compass heading in radians (0 = +Z, π/2 = +X). */
  windHeading: number;
}

export const CLEAR_CONDITIONS: Conditions = { time: 'authored', weather: 'clear', windHeading: 0 };

export interface WeatherSpec {
  label: string;
  /** Steady wind speed (m/s). */
  wind: number;
  /** Gust amplitude on top of the steady wind (m/s). */
  gust: number;
  /** Vertical bumps and roll disturbances, 0..1. */
  turbulence: number;
  /** Rain streaks around the camera, 0..1. */
  rain: number;
  /** Fog distance multiplier (smaller is thicker). */
  fog: number;
  /** Extra cloud cover, 0..1. */
  overcast: number;
}

export const WEATHER: Record<Weather, WeatherSpec> = {
  clear: { label: 'Clear', wind: 0, gust: 0, turbulence: 0, rain: 0, fog: 1, overcast: 0 },
  breezy: { label: 'Breezy', wind: 6, gust: 2, turbulence: 0.15, rain: 0, fog: 1, overcast: 0.15 },
  gusty: { label: 'Gusty', wind: 8, gust: 6, turbulence: 0.6, rain: 0, fog: 0.85, overcast: 0.45 },
  fog: { label: 'Fog', wind: 1.5, gust: 0.5, turbulence: 0, rain: 0, fog: 0.22, overcast: 0.7 },
  rain: { label: 'Rain', wind: 5, gust: 3, turbulence: 0.3, rain: 1, fog: 0.45, overcast: 1 },
};

export const TIME_LABELS: Record<TimeOfDay, string> = {
  authored: 'Region light',
  dawn: 'Dawn',
  dusk: 'Dusk',
};

/** Short description such as "Dawn · Gusty, 29 km/h" for cards and briefings. */
export const describeConditions = (conditions: Conditions, authoredMood?: string): string => {
  const weather = WEATHER[conditions.weather];
  const time =
    conditions.time === 'authored'
      ? (authoredMood?.split('·').pop()?.trim() ?? 'Day')
      : TIME_LABELS[conditions.time];
  const wind = weather.wind > 0 ? `, ${Math.round(weather.wind * 3.6)} km/h wind` : '';
  return `${capitalise(time)} · ${weather.label}${wind}`;
};

const capitalise = (text: string): string => (text ? text[0]!.toUpperCase() + text.slice(1) : text);

// --- Wind field ------------------------------------------------------------------------------

/**
 * Deterministic wind at a time and place: the steady wind along its heading, a
 * slow gust swell, and (in turbulent weather) short vertical bumps. Writes into
 * `out` and returns the roll disturbance (rad/s) for the flight model.
 */
export const sampleWind = (
  conditions: Conditions,
  time: number,
  x: number,
  z: number,
  out: Vector3,
): number => {
  const spec = WEATHER[conditions.weather];
  if (spec.wind === 0 && spec.gust === 0) {
    out.set(0, 0, 0);
    return 0;
  }
  const swell = Math.sin(time * 0.37 + x * 0.0021) * 0.6 + Math.sin(time * 0.91 + z * 0.0017 + 1.3) * 0.4;
  const speed = spec.wind + spec.gust * swell;
  const hx = Math.sin(conditions.windHeading);
  const hz = Math.cos(conditions.windHeading);
  // The gusts veer a little too, so the drift is never perfectly predictable.
  const veer = Math.sin(time * 0.23 + 0.7) * 0.25 * clamp01(spec.gust / 4);
  const cx = hx * Math.cos(veer) + hz * Math.sin(veer);
  const cz = hz * Math.cos(veer) - hx * Math.sin(veer);
  const bump =
    spec.turbulence * (Math.sin(time * 2.7 + x * 0.013) * 0.6 + Math.sin(time * 5.3 + z * 0.011 + 2.1) * 0.4);
  out.set(cx * speed, bump * 3.2, cz * speed);
  return spec.turbulence * Math.sin(time * 3.1 + x * 0.007 + z * 0.005) * 0.32;
};

/** Steady wind speed in km/h, for the HUD and briefings. */
export const windKmh = (conditions: Conditions): number => Math.round(WEATHER[conditions.weather].wind * 3.6);

// --- Theme grading -----------------------------------------------------------------------------

/** Linear blend of two 0xRRGGBB colours. */
export const mixColor = (a: number, b: number, t: number): number => {
  const k = clamp01(t);
  const r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k);
  const g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k);
  const bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
  return (r << 16) | (g << 8) | bl;
};

interface LightGrade {
  zenith: number;
  horizon: number;
  sunColor: number;
  glow: number;
  /** Sun elevation (y of the direction before normalising). */
  elevation: number;
  /** Rotation of the sun's azimuth relative to the authored one (rad). */
  azimuth: number;
  intensity: number;
  fog: number;
  hemisphereSky: number;
  exposure: number;
  /** How strongly the grade replaces the authored palette. */
  weight: number;
}

const DAWN: LightGrade = {
  zenith: 0x4a6a9e,
  horizon: 0xf6c9b4,
  sunColor: 0xffd2b0,
  glow: 0xffa98a,
  elevation: 0.22,
  azimuth: Math.PI * 0.6,
  intensity: 2.1,
  fog: 0xe9cdbf,
  hemisphereSky: 0xc8d4f0,
  exposure: 1.05,
  weight: 0.72,
};

const DUSK: LightGrade = {
  zenith: 0x2a2f62,
  horizon: 0xf09a5c,
  sunColor: 0xffb37a,
  glow: 0xff7d45,
  elevation: 0.14,
  azimuth: -Math.PI * 0.55,
  intensity: 2.0,
  fog: 0xc98a6a,
  hemisphereSky: 0x9fa4d6,
  exposure: 1.0,
  weight: 0.75,
};

const STORM_GREY = 0x8d97a3;

/**
 * Grades a region's authored theme for the conditions: dawn and dusk move the
 * sun low and warm the palette; fog and rain pull the haze in, grey the sky and
 * soften the sun. Returns the authored theme unchanged in clear authored light.
 */
export const gradeTheme = (theme: CourseTheme, conditions: Conditions): CourseTheme => {
  if (conditions.time === 'authored' && conditions.weather === 'clear') return theme;
  const sky = { ...theme.sky };
  const sun = { ...theme.sun };
  const hemisphere = { ...theme.hemisphere };
  const fog = { ...theme.fog };
  let exposure = theme.exposure;

  const grade = conditions.time === 'dawn' ? DAWN : conditions.time === 'dusk' ? DUSK : null;
  if (grade) {
    const w = grade.weight;
    sky.zenith = mixColor(sky.zenith, grade.zenith, w);
    sky.horizon = mixColor(sky.horizon, grade.horizon, w);
    sky.ground = mixColor(sky.ground, grade.fog, w * 0.6);
    sky.cloudLit = mixColor(sky.cloudLit, grade.glow, 0.45);
    sky.cloudShade = mixColor(sky.cloudShade, grade.zenith, 0.4);
    sun.color = mixColor(sun.color, grade.sunColor, w);
    sun.glow = mixColor(sun.glow, grade.glow, w);
    const [dx, , dz] = sun.direction;
    const cos = Math.cos(grade.azimuth);
    const sin = Math.sin(grade.azimuth);
    const length = Math.hypot(dx, dz) || 1;
    sun.direction = [
      ((dx * cos - dz * sin) / length) * 0.9,
      grade.elevation,
      ((dx * sin + dz * cos) / length) * 0.9,
    ];
    sun.intensity = sun.intensity * (1 - w) + grade.intensity * w;
    hemisphere.sky = mixColor(hemisphere.sky, grade.hemisphereSky, w);
    fog.color = mixColor(fog.color, grade.fog, w);
    exposure = exposure * (1 - w) + grade.exposure * w;
  }

  const weather = WEATHER[conditions.weather];
  if (weather.overcast > 0) {
    const o = weather.overcast;
    sky.clouds = Math.min(1, sky.clouds + o * 0.7);
    sky.zenith = mixColor(sky.zenith, STORM_GREY, o * 0.55);
    sky.horizon = mixColor(sky.horizon, mixColor(STORM_GREY, 0xd8dde2, 0.5), o * 0.5);
    sky.cloudLit = mixColor(sky.cloudLit, 0xdfe3e8, o * 0.5);
    sky.cloudShade = mixColor(sky.cloudShade, 0x6d7782, o * 0.6);
    sun.intensity *= 1 - o * 0.55;
    sun.glow = mixColor(sun.glow, 0xd8dde2, o * 0.6);
    hemisphere.intensity *= 1 + o * 0.25;
    fog.color = mixColor(fog.color, 0xb7bfc8, o * 0.6);
  }
  if (weather.fog < 1) {
    fog.near *= weather.fog * 0.6;
    fog.far *= weather.fog;
    fog.color = mixColor(fog.color, 0xd5dadf, 0.55);
    sky.horizon = mixColor(sky.horizon, fog.color, 0.7);
  }
  if (weather.rain > 0) exposure *= 0.94;

  return {
    ...theme,
    mood: describeConditions(conditions, theme.mood),
    sky,
    sun,
    hemisphere,
    fog,
    exposure,
  };
};
