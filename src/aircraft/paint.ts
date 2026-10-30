/**
 * Paint and markings. Purely cosmetic: nothing here is read by the
 * performance model, so a livery can never change how an aircraft flies.
 */

export interface Swatch {
  id: string;
  name: string;
  color: number;
  /** Earned swatches are unlocked by a skill badge. */
  badge?: string;
  /** Contrail tint when this swatch is the accent colour. */
  trail?: number;
}

/**
 * The curated paint shop: warm ivories, deep inks, vermilion, sun-faded yellow,
 * sea-glass and a handful of supporting colours. Earned swatches come last.
 */
export const SWATCHES: readonly Swatch[] = [
  { id: 'ivory', name: 'Ivory', color: 0xf1e8d4 },
  { id: 'bone', name: 'Bone', color: 0xd8cdb6 },
  { id: 'ink', name: 'Ink Blue', color: 0x17233b },
  { id: 'navy', name: 'Harbour Navy', color: 0x23395b },
  { id: 'vermilion', name: 'Vermilion', color: 0xe0442a },
  { id: 'cherry', name: 'Cherry', color: 0xa8262a },
  { id: 'sunfade', name: 'Sun-Faded Yellow', color: 0xe8b84a },
  { id: 'ochre', name: 'Ochre', color: 0xc48a2c },
  { id: 'seaglass', name: 'Sea Glass', color: 0x7cc5b4 },
  { id: 'teal', name: 'Deep Teal', color: 0x1f6f6b },
  { id: 'sky', name: 'Survey Blue', color: 0x5d8fc4 },
  { id: 'sand', name: 'Sand', color: 0xc9a77a },
  { id: 'terracotta', name: 'Terracotta', color: 0xb8603e },
  { id: 'olive', name: 'Olive Drab', color: 0x5f6542 },
  { id: 'silver', name: 'Bare Metal', color: 0xb7bcc2 },
  { id: 'graphite', name: 'Graphite', color: 0x2c3036 },
  { id: 'aurora', name: 'Aurora Mint', color: 0x3cf0c4, badge: 'ring-runner', trail: 0x8ff7de },
  { id: 'solar', name: 'Solar Gold', color: 0xffb21f, badge: 'bullseye', trail: 0xffd98a },
  { id: 'dune', name: 'Dune Copper', color: 0xc98a4b, badge: 'canyon-skimmer', trail: 0xf6d7a8 },
  { id: 'neon', name: 'Neon Rose', color: 0xff3f8e, badge: 'combo-king', trail: 0xff9ac4 },
  { id: 'display', name: 'Display Crimson', color: 0xd3203f, badge: 'display-team', trail: 0xffffff },
  { id: 'postal', name: 'Air Mail Blue', color: 0x2c63c9, badge: 'air-mail', trail: 0xbcd3ff },
  { id: 'jade', name: 'Threader Jade', color: 0x14a776, badge: 'threader', trail: 0x9ff0cf },
  { id: 'signal', name: 'Signal Orange', color: 0xff7417, badge: 'pathfinder', trail: 0xffc08a },
];

export type PatternId = 'plain' | 'split' | 'cheatline' | 'checker' | 'bands' | 'scallop' | 'salvage';
export type InsigniaId = 'none' | 'roundel' | 'chevron' | 'bolt' | 'swallow';

export const PATTERNS: readonly { id: PatternId; name: string; hint: string }[] = [
  { id: 'plain', name: 'Plain', hint: 'One colour, belly in secondary' },
  { id: 'split', name: 'Two-Tone', hint: 'Secondary underside with an accent line' },
  { id: 'cheatline', name: 'Cheatline', hint: 'An accent stripe nose to tail' },
  { id: 'checker', name: 'Checker Nose', hint: 'A chequered band behind the cowl' },
  { id: 'bands', name: 'Rescue Bands', hint: 'Broad accent bands round the fuselage' },
  { id: 'scallop', name: 'Scallops', hint: 'Racing scallops sweeping back from the nose' },
  {
    id: 'salvage',
    name: 'As Salvaged',
    hint: 'Your colours on the cabin. Other sections keep the paint they came with',
  },
];

export const INSIGNIA: readonly { id: InsigniaId; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'roundel', name: 'Roundel' },
  { id: 'chevron', name: 'Chevron' },
  { id: 'bolt', name: 'Bolt' },
  { id: 'swallow', name: 'Swallow' },
];

export interface Paint {
  primary: string;
  secondary: string;
  accent: string;
  /** Wingtips and fin tip. */
  tips: string;
  /** Cowl ring and spinner. */
  nose: string;
  pattern: PatternId;
  insignia: InsigniaId;
  /** Race number, 0..99. */
  number: number;
}

export type PaintSlot = 'primary' | 'secondary' | 'accent' | 'tips' | 'nose';

export const PAINT_SLOTS: readonly { id: PaintSlot; label: string }[] = [
  { id: 'primary', label: 'Primary' },
  { id: 'secondary', label: 'Secondary' },
  { id: 'accent', label: 'Accent' },
  { id: 'tips', label: 'Tips' },
  { id: 'nose', label: 'Nose' },
];

export interface PaintTheme {
  id: string;
  name: string;
  /** Short line for the theme card. */
  note: string;
  paint: Paint;
  /** Badge that unlocks the theme (it uses that badge's swatch). */
  badge?: string;
}

/**
 * Livery themes. The first nine keep the ids of the original liveries so
 * older saves keep their paint.
 */
export const THEMES: readonly PaintTheme[] = [
  {
    id: 'livery-racer',
    name: 'Vintage Air-Racer',
    note: 'Ivory and vermilion, chequered nose',
    paint: {
      primary: 'ivory',
      secondary: 'ink',
      accent: 'vermilion',
      tips: 'vermilion',
      nose: 'vermilion',
      pattern: 'checker',
      insignia: 'roundel',
      number: 7,
    },
  },
  {
    id: 'livery-rescue',
    name: 'Coastal Rescue',
    note: 'High-visibility bands for open water',
    paint: {
      primary: 'ivory',
      secondary: 'navy',
      accent: 'vermilion',
      tips: 'sunfade',
      nose: 'navy',
      pattern: 'bands',
      insignia: 'chevron',
      number: 21,
    },
  },
  {
    id: 'livery-survey',
    name: 'Alpine Survey',
    note: 'Survey blue and signal orange',
    paint: {
      primary: 'sky',
      secondary: 'ivory',
      accent: 'vermilion',
      tips: 'vermilion',
      nose: 'ivory',
      pattern: 'split',
      insignia: 'roundel',
      number: 14,
    },
  },
  {
    id: 'livery-courier',
    name: 'Desert Courier',
    note: 'Sand and ink with sun-faded scallops',
    paint: {
      primary: 'sand',
      secondary: 'ink',
      accent: 'sunfade',
      tips: 'ink',
      nose: 'ink',
      pattern: 'scallop',
      insignia: 'swallow',
      number: 3,
    },
  },
  {
    id: 'livery-modern',
    name: 'Clean Modern Sport',
    note: 'Bone, ink and a sea-glass line',
    paint: {
      primary: 'bone',
      secondary: 'ink',
      accent: 'seaglass',
      tips: 'ink',
      nose: 'ink',
      pattern: 'cheatline',
      insignia: 'none',
      number: 42,
    },
  },
  {
    id: 'livery-ember',
    name: 'Graphite Ember',
    note: 'Graphite with a sun-faded flash',
    paint: {
      primary: 'graphite',
      secondary: 'ivory',
      accent: 'sunfade',
      tips: 'sunfade',
      nose: 'sunfade',
      pattern: 'cheatline',
      insignia: 'bolt',
      number: 9,
    },
  },
  {
    id: 'livery-glacier',
    name: 'Glacier',
    note: 'Ivory over ink with sea-glass trim',
    paint: {
      primary: 'ivory',
      secondary: 'ink',
      accent: 'seaglass',
      tips: 'seaglass',
      nose: 'ink',
      pattern: 'split',
      insignia: 'roundel',
      number: 1,
    },
  },
  {
    id: 'livery-midnight',
    name: 'Midnight Mail',
    note: 'Ink blue with a vermilion cheatline',
    paint: {
      primary: 'ink',
      secondary: 'silver',
      accent: 'vermilion',
      tips: 'vermilion',
      nose: 'silver',
      pattern: 'cheatline',
      insignia: 'chevron',
      number: 88,
    },
  },
  {
    id: 'livery-signal',
    name: 'Signal',
    note: 'Ivory with cherry bands',
    paint: {
      primary: 'ivory',
      secondary: 'graphite',
      accent: 'cherry',
      tips: 'cherry',
      nose: 'cherry',
      pattern: 'bands',
      insignia: 'none',
      number: 11,
    },
  },
  {
    id: 'livery-teal',
    name: 'Harbour Pilot',
    note: 'Deep teal and bare metal',
    paint: {
      primary: 'teal',
      secondary: 'silver',
      accent: 'ivory',
      tips: 'ivory',
      nose: 'silver',
      pattern: 'split',
      insignia: 'swallow',
      number: 5,
    },
  },
  {
    id: 'livery-salvage',
    name: 'Scrapyard',
    note: 'Primer patches and the donors’ old paint',
    paint: {
      primary: 'bone',
      secondary: 'olive',
      accent: 'vermilion',
      tips: 'sunfade',
      nose: 'graphite',
      pattern: 'salvage',
      insignia: 'none',
      number: 13,
    },
  },
  {
    id: 'livery-barnstormer',
    name: 'Barnstormer',
    note: 'Sun-faded yellow with cherry scallops',
    paint: {
      primary: 'sunfade',
      secondary: 'cherry',
      accent: 'ink',
      tips: 'cherry',
      nose: 'cherry',
      pattern: 'scallop',
      insignia: 'bolt',
      number: 8,
    },
  },
  // Earned themes: each uses a badge swatch (see progression/badges.ts).
  {
    id: 'livery-aurora',
    name: 'Aurora Ring',
    note: 'Earned: Ring Runner',
    badge: 'ring-runner',
    paint: {
      primary: 'ink',
      secondary: 'navy',
      accent: 'aurora',
      tips: 'aurora',
      nose: 'aurora',
      pattern: 'cheatline',
      insignia: 'roundel',
      number: 6,
    },
  },
  {
    id: 'livery-solar',
    name: 'Solar Bullseye',
    note: 'Earned: Bullseye',
    badge: 'bullseye',
    paint: {
      primary: 'ivory',
      secondary: 'cherry',
      accent: 'solar',
      tips: 'solar',
      nose: 'cherry',
      pattern: 'scallop',
      insignia: 'roundel',
      number: 10,
    },
  },
  {
    id: 'livery-dune',
    name: 'Canyon Skimmer',
    note: 'Earned: Canyon Skimmer',
    badge: 'canyon-skimmer',
    paint: {
      primary: 'dune',
      secondary: 'ink',
      accent: 'ivory',
      tips: 'ink',
      nose: 'ink',
      pattern: 'split',
      insignia: 'bolt',
      number: 66,
    },
  },
  {
    id: 'livery-neon',
    name: 'Neon Rush',
    note: 'Earned: Combo King',
    badge: 'combo-king',
    paint: {
      primary: 'ink',
      secondary: 'graphite',
      accent: 'neon',
      tips: 'neon',
      nose: 'neon',
      pattern: 'bands',
      insignia: 'bolt',
      number: 4,
    },
  },
  {
    id: 'livery-display',
    name: 'Display Team',
    note: 'Earned: gold at an air show',
    badge: 'display-team',
    paint: {
      primary: 'display',
      secondary: 'ivory',
      accent: 'ivory',
      tips: 'ivory',
      nose: 'ivory',
      pattern: 'scallop',
      insignia: 'swallow',
      number: 1,
    },
  },
  {
    id: 'livery-airmail',
    name: 'Air Mail',
    note: 'Earned: gold on a delivery',
    badge: 'air-mail',
    paint: {
      primary: 'postal',
      secondary: 'ivory',
      accent: 'cherry',
      tips: 'cherry',
      nose: 'ivory',
      pattern: 'cheatline',
      insignia: 'chevron',
      number: 31,
    },
  },
  {
    id: 'livery-threader',
    name: 'Needle Point',
    note: 'Earned: gold on a precision run',
    badge: 'threader',
    paint: {
      primary: 'ivory',
      secondary: 'graphite',
      accent: 'jade',
      tips: 'jade',
      nose: 'jade',
      pattern: 'split',
      insignia: 'bolt',
      number: 12,
    },
  },
  {
    id: 'livery-expedition',
    name: 'Expedition',
    note: 'Earned: ten discoveries',
    badge: 'pathfinder',
    paint: {
      primary: 'signal',
      secondary: 'ivory',
      accent: 'ink',
      tips: 'ink',
      nose: 'ivory',
      pattern: 'bands',
      insignia: 'roundel',
      number: 10,
    },
  },
];

const swatchIndex = new Map(SWATCHES.map((swatch) => [swatch.id, swatch]));
const themeIndex = new Map(THEMES.map((theme) => [theme.id, theme]));
const patternIds = new Set<string>(PATTERNS.map((pattern) => pattern.id));
const insigniaIds = new Set<string>(INSIGNIA.map((insignia) => insignia.id));

export const getSwatch = (id: string): Swatch | undefined => swatchIndex.get(id);
export const getTheme = (id: string): PaintTheme | undefined => themeIndex.get(id);

export const DEFAULT_THEME_ID = 'livery-racer';
export const DEFAULT_PAINT: Readonly<Paint> = Object.freeze({ ...getTheme(DEFAULT_THEME_ID)!.paint });

/** Paint each aircraft rolls out of the factory in. */
export const FACTORY_THEMES: Record<string, string> = {
  'airframe-sport': 'livery-racer',
  'airframe-scout': 'livery-survey',
  'airframe-racer': 'livery-midnight',
  'airframe-bush': 'livery-courier',
  'airframe-seaplane': 'livery-rescue',
  'airframe-cruiser': 'livery-glacier',
  'airframe-stunt': 'livery-barnstormer',
  'airframe-custom': 'livery-salvage',
};

export const factoryPaint = (airframeId: string): Paint => ({
  ...(getTheme(FACTORY_THEMES[airframeId] ?? '')?.paint ?? DEFAULT_PAINT),
});

/** Colour of a swatch id; unknown ids fall back to ivory. */
export const swatchColor = (id: string): number => swatchIndex.get(id)?.color ?? 0xf1e8d4;

export const isSwatchUnlocked = (swatch: Swatch, badges: readonly string[]): boolean =>
  !swatch.badge || badges.includes(swatch.badge);

export const isThemeUnlocked = (theme: PaintTheme, badges: readonly string[]): boolean =>
  !theme.badge || badges.includes(theme.badge);

const PAINT_SLOT_IDS: readonly PaintSlot[] = ['primary', 'secondary', 'accent', 'tips', 'nose'];

/** Structural check: known swatches, pattern and insignia, and a whole race number. */
export const isValidPaint = (value: unknown): value is Paint => {
  if (typeof value !== 'object' || value === null) return false;
  const paint = value as Record<string, unknown>;
  for (const slot of PAINT_SLOT_IDS) {
    if (typeof paint[slot] !== 'string' || !swatchIndex.has(paint[slot])) return false;
  }
  return (
    typeof paint.pattern === 'string' &&
    patternIds.has(paint.pattern) &&
    typeof paint.insignia === 'string' &&
    insigniaIds.has(paint.insignia) &&
    typeof paint.number === 'number' &&
    Number.isInteger(paint.number) &&
    paint.number >= 0 &&
    paint.number <= 99
  );
};

/** Whether every swatch in the paint is available with these badges. */
export const isPaintUnlocked = (paint: Paint, badges: readonly string[]): boolean =>
  PAINT_SLOT_IDS.every((slot) => {
    const swatch = swatchIndex.get(paint[slot]);
    return swatch !== undefined && isSwatchUnlocked(swatch, badges);
  });

/**
 * Repairs untrusted paint: unknown or locked swatches fall back to the default
 * paint slot by slot, so one bad field never discards the rest.
 */
export const sanitisePaint = (value: unknown, badges: readonly string[]): Paint => {
  const base: Paint = { ...DEFAULT_PAINT };
  if (typeof value !== 'object' || value === null) return base;
  const raw = value as Record<string, unknown>;
  const result: Paint = { ...base };
  for (const slot of PAINT_SLOT_IDS) {
    const id = raw[slot];
    const swatch = typeof id === 'string' ? swatchIndex.get(id) : undefined;
    if (swatch && isSwatchUnlocked(swatch, badges)) result[slot] = swatch.id;
  }
  if (typeof raw.pattern === 'string' && patternIds.has(raw.pattern))
    result.pattern = raw.pattern as PatternId;
  if (typeof raw.insignia === 'string' && insigniaIds.has(raw.insignia))
    result.insignia = raw.insignia as InsigniaId;
  if (typeof raw.number === 'number' && Number.isFinite(raw.number))
    result.number = Math.max(0, Math.min(99, Math.round(raw.number)));
  return result;
};

/** Contrail tint: earned accent swatches carry their own, everything else trails warm white. */
export const trailColor = (paint: Paint): number => swatchIndex.get(paint.accent)?.trail ?? 0xf4f1ea;

export const paintsEqual = (a: Paint, b: Paint): boolean =>
  a.primary === b.primary &&
  a.secondary === b.secondary &&
  a.accent === b.accent &&
  a.tips === b.tips &&
  a.nose === b.nose &&
  a.pattern === b.pattern &&
  a.insignia === b.insignia &&
  a.number === b.number;

/** The theme a paint matches exactly, if any (for highlighting in the paint shop). */
export const matchingTheme = (paint: Paint): PaintTheme | undefined =>
  THEMES.find((theme) => paintsEqual(theme.paint, paint));
