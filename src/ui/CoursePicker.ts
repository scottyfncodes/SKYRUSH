import { h } from './dom';
import { COURSES, type CourseSpec } from '../course/courses';
import { createCircuit } from '../course/circuit';
/** m:ss, enough precision for a card. */
const formatShortTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds - minutes * 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
};

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

const mix = (a: number, b: number, t: number): string => {
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
};

const thumbnails = new Map<string, string>();

/**
 * A small SVG postcard of a course: its sky, sun and clouds, and two ridgelines
 * sampled from the course's real terrain (plus the sea where it has one).
 */
export const courseThumbnail = (course: CourseSpec): string => {
  const cached = thumbnails.get(course.id);
  if (cached) return cached;
  const circuit = createCircuit(course.id);
  const { theme } = course;
  const width = 320;
  const height = 140;
  const horizonY = 92;
  const samples = 64;
  const profile = (distance: number): number[] => {
    const values: number[] = [];
    for (let i = 0; i <= samples; i += 1) {
      const x = circuit.center.x - 2600 + (i / samples) * 5200;
      values.push(circuit.terrain.groundAt(x, circuit.center.z + distance));
    }
    return values;
  };
  const far = profile(2200);
  const near = profile(700);
  const top = Math.max(320, ...far, ...near);
  const seaLevel = circuit.seaLevel;
  const base = seaLevel ?? Math.min(...far, ...near);
  const toY = (value: number, lift: number) =>
    horizonY + lift - ((value - base) / (top - base)) * (horizonY - 18);
  const ridge = (values: number[], lift: number) =>
    `M0 ${height} ` +
    values
      .map((value, i) => `L${((i / samples) * width).toFixed(1)} ${toY(value, lift).toFixed(1)}`)
      .join(' ') +
    ` L${width} ${height} Z`;

  const [sx, sy, sz] = theme.sun.direction;
  const azimuth = Math.atan2(sx, sz);
  const sunX = Math.min(0.88, Math.max(0.12, 0.5 - azimuth / Math.PI)) * width;
  const elevation = Math.atan2(sy, Math.hypot(sx, sz));
  const sunY = horizonY - Math.min(1, elevation / 1.2) * 70;

  const clouds: string[] = [];
  const cloudCount = Math.round(theme.sky.clouds * 8);
  for (let i = 0; i < cloudCount; i += 1) {
    const cx = ((i * 97 + 31) % 300) + 10;
    const cy = 16 + ((i * 53) % 40);
    const rx = 22 + ((i * 37) % 26);
    clouds.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${(rx * 0.28).toFixed(1)}" fill="${hex(theme.sky.cloudLit)}" opacity="0.7"/>`,
    );
  }

  const water =
    seaLevel !== null && theme.water
      ? `<rect x="0" y="${horizonY + 6}" width="${width}" height="${height}" fill="url(#sea-${course.id})"/>`
      : '';
  const svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="sky-${course.id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${hex(theme.sky.zenith)}"/>
        <stop offset="0.75" stop-color="${hex(theme.sky.horizon)}"/>
      </linearGradient>
      <radialGradient id="glow-${course.id}">
        <stop offset="0" stop-color="${hex(theme.sun.glow)}" stop-opacity="0.85"/>
        <stop offset="1" stop-color="${hex(theme.sun.glow)}" stop-opacity="0"/>
      </radialGradient>
      ${
        theme.water
          ? `<linearGradient id="sea-${course.id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${hex(theme.water.deep)}"/>
        <stop offset="1" stop-color="${hex(theme.water.shallow)}"/>
      </linearGradient>`
          : ''
      }
    </defs>
    <rect width="${width}" height="${height}" fill="url(#sky-${course.id})"/>
    <circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="46" fill="url(#glow-${course.id})"/>
    <circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="7" fill="${hex(theme.sun.color)}"/>
    ${clouds.join('')}
    <path d="${ridge(far, 0)}" fill="${
      Math.max(...far) > theme.terrain.peakAltitude[0]
        ? mix(theme.terrain.peak, theme.fog.color, 0.25)
        : mix(theme.terrain.rock, theme.fog.color, 0.55)
    }"/>
    <path d="${ridge(near, 14)}" fill="${mix(theme.terrain.cliff, theme.terrain.vegetation, 0.45)}"/>
    ${water}
    <rect x="0" y="${height - 10}" width="${width}" height="10" fill="${mix(theme.terrain.floor, theme.terrain.cliff, 0.35)}" opacity="${seaLevel !== null ? 0 : 1}"/>
  </svg>`;
  thumbnails.set(course.id, svg);
  return svg;
};

export interface CourseCardInfo {
  selectedId: string;
  bestTimes: Record<string, number>;
  onSelect: (courseId: string) => void;
}

const courseMeta = (course: CourseSpec, bestTimes: Record<string, number>): string => {
  const best = bestTimes[course.id];
  return `${course.character} · Par ${formatShortTime(course.parTime)} · Best ${
    best === undefined ? '—' : formatShortTime(best)
  }`;
};

const courseCard = (course: CourseSpec, info: CourseCardInfo, testId: string): HTMLButtonElement => {
  const selected = course.id === info.selectedId;
  return h(
    'button',
    {
      className: `course-card${selected ? ' is-selected' : ''}`,
      attrs: {
        type: 'button',
        'aria-pressed': String(selected),
        'aria-label': `${course.name}: ${course.theme.mood}`,
      },
      dataset: { testid: testId, course: course.id },
      on: { click: () => info.onSelect(course.id) },
    },
    h('span', { className: 'course-card__thumb', html: courseThumbnail(course) }),
    h(
      'span',
      { className: 'course-card__body' },
      h('span', { className: 'course-card__name', text: course.name }),
      h('span', { className: 'course-card__mood', text: course.theme.mood }),
      h('span', { className: 'course-card__meta', text: courseMeta(course, info.bestTimes) }),
    ),
  );
};

/** Every course as a card, for the briefing. */
export const createCourseGrid = (info: CourseCardInfo): HTMLElement =>
  h(
    'div',
    { className: 'course-grid', dataset: { testid: 'course-grid' } },
    ...COURSES.map((course) => courseCard(course, info, `course-${course.id}`)),
  );

/** Compact selector for the main menu: the current course with previous / next arrows. */
export const createCourseSelector = (info: CourseCardInfo): HTMLElement => {
  const index = Math.max(
    0,
    COURSES.findIndex((course) => course.id === info.selectedId),
  );
  const step = (delta: number) => () =>
    info.onSelect(COURSES[(index + delta + COURSES.length) % COURSES.length]!.id);
  const arrow = (label: string, glyph: string, delta: number, testId: string) =>
    h('button', {
      className: 'course-select__arrow',
      text: glyph,
      attrs: { type: 'button', 'aria-label': label },
      dataset: { testid: testId },
      on: { click: step(delta) },
    });
  return h(
    'div',
    { className: 'course-select', dataset: { testid: 'course-select' } },
    arrow('Previous course', '‹', -1, 'course-prev'),
    courseCard(COURSES[index]!, { ...info, onSelect: () => step(1)() }, 'course-current'),
    arrow('Next course', '›', 1, 'course-next'),
    h(
      'div',
      { className: 'course-select__dots', attrs: { 'aria-hidden': 'true' } },
      ...COURSES.map((_, i) =>
        h('span', { className: `course-select__dot${i === index ? ' is-active' : ''}` }),
      ),
    ),
  );
};
