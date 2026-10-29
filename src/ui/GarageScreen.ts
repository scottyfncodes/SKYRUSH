import { Screen, button, clear, h } from './dom';
import {
  AIRFRAMES,
  CATEGORY_LABELS,
  PART_CATEGORIES,
  airframesAccepting,
  describeUnlock,
  getAirframe,
  getItem,
  getPartIn,
  partsForCategory,
  type Airframe,
  type PartCategory,
  type ShopItem,
} from '../aircraft/parts';
import {
  INSIGNIA,
  PAINT_SLOTS,
  PATTERNS,
  SWATCHES,
  THEMES,
  isSwatchUnlocked,
  isThemeUnlocked,
  matchingTheme,
  type Paint,
  type PaintSlot,
} from '../aircraft/paint';
import {
  MAX_SETUPS,
  SETUP_NAME_LENGTH,
  activeEntry,
  entriesEqual,
  factoryPaint,
  isAvailable,
  missingParts,
  partStatus,
  type HangarEntry,
  type PartStatus,
  type PlayerProfile,
} from '../progression/profile';
import { getBadge } from '../progression/badges';
import {
  buildCharacter,
  performanceForBuild,
  type PerformanceSummary,
  type RatingKey,
  type Specialty,
} from '../aircraft/performance';
import {
  defaultBuildFor,
  isValidBuild,
  withPart,
  type AircraftBuild,
  type AircraftSetup,
} from '../aircraft/build';
import { factorySetupsFor } from '../aircraft/setups';
import { COURSES } from '../course/courses';
import { formatCredits } from '../core/format';
import { airframeSilhouette } from './silhouette';
import type { HangarFocus } from '../app/GarageStage';

export type GarageSection = 'aircraft' | 'parts' | 'paint' | 'setups';

export interface GarageCallbacks {
  onBack: () => void;
  onRace: () => void;
  onInstall: (category: PartCategory, partId: string) => void;
  /** Buys an aircraft or part; parts are fitted to the active aircraft, aircraft become active. */
  onPurchase: (id: string) => void;
  onSelectAircraft: (airframeId: string) => void;
  onPaint: (paint: Paint) => void;
  onRevert: () => void;
  onApplyBuild: (build: AircraftBuild, paint?: Paint) => void;
  onSaveSetup: (name: string) => void;
  onDeleteSetup: (setupId: string) => void;
  /** The 3D preview should show this setup. */
  onPreview: (setup: AircraftSetup) => void;
  onFocus: (focus: HangarFocus) => void;
  onRevealDone: () => void;
}

const SECTIONS: { id: GarageSection; label: string }[] = [
  { id: 'aircraft', label: 'Aircraft' },
  { id: 'parts', label: 'Parts' },
  { id: 'paint', label: 'Paint' },
  { id: 'setups', label: 'Setups' },
];

interface StatRow {
  key: RatingKey;
  label: string;
  hint: string;
  value: (s: PerformanceSummary) => string;
}

const STAT_GROUPS: { title: string; rows: StatRow[] }[] = [
  {
    title: 'Speed',
    rows: [
      {
        key: 'topSpeed',
        label: 'Top speed',
        hint: 'Maximum level-flight speed',
        value: (s) => `${s.topSpeedKmh} km/h`,
      },
      {
        key: 'acceleration',
        label: 'Acceleration',
        hint: '0 to 250 km/h in level flight',
        value: (s) => `${s.accelerationSeconds.toFixed(1)} s`,
      },
      {
        key: 'climb',
        label: 'Climb',
        hint: 'Steady climb gradient at 200 km/h',
        value: (s) => `${s.climbPercent}%`,
      },
      {
        key: 'retention',
        label: 'Holds speed',
        hint: 'How slowly drag bleeds speed when coasting at 320 km/h',
        value: (s) => `−${s.coastDecel.toFixed(1)} m/s²`,
      },
    ],
  },
  {
    title: 'Handling',
    rows: [
      {
        key: 'agility',
        label: 'Agility',
        hint: 'Roll rate and how quickly the controls bite',
        value: (s) => `${s.rollDegPerSec}°/s`,
      },
      {
        key: 'turning',
        label: 'Turning',
        hint: 'Pitch authority and how tightly the flight path follows the nose',
        value: (s) => `${s.turning}`,
      },
      {
        key: 'stability',
        label: 'Stability',
        hint: 'Self-levelling strength and damping',
        value: (s) => `${s.stability}`,
      },
      {
        key: 'lowSpeed',
        label: 'Low speed',
        hint: 'Stall speed: lower holds control in slow corners',
        value: (s) => `${s.stallSpeedKmh} km/h`,
      },
    ],
  },
  {
    title: 'Engine & frame',
    rows: [
      {
        key: 'heat',
        label: 'Heat',
        hint: 'Boost time before overheating and how fast it cools',
        value: (s) => `${s.heatManagement}`,
      },
      {
        key: 'boost',
        label: 'Boost',
        hint: 'Seconds of continuous boost from a full reserve',
        value: (s) => `${s.boostEndurance.toFixed(1)} s`,
      },
      {
        key: 'toughness',
        label: 'Toughness',
        hint: 'Highest descent rate that is a scrape rather than a crash',
        value: (s) => `${s.scrapeTolerance.toFixed(1)} m/s`,
      },
    ],
  },
];

/** Which course each specialty suits, by the course's character. */
const SPECIALTY_COURSE: Record<Specialty, string> = {
  Speed: 'Fast',
  Agility: 'Technical',
  Climb: 'Climbing',
  Stability: 'Climbing',
  Endurance: 'Balanced',
};

const ROLE_SPECIALTY: Record<string, Specialty> = {
  Speed: 'Speed',
  Racing: 'Speed',
  Boost: 'Speed',
  Agility: 'Agility',
  Performance: 'Agility',
  Refined: 'Agility',
  Climb: 'Climb',
  'Low speed': 'Stability',
  Stability: 'Stability',
  Toughness: 'Stability',
  Endurance: 'Endurance',
};

export const courseForSpecialty = (specialty: Specialty): string | undefined =>
  COURSES.find((course) => course.character === SPECIALTY_COURSE[specialty])?.name;

const FOCUS_FOR: Record<PartCategory, HangarFocus> = {
  frame: 'frame',
  engine: 'engine',
  prop: 'prop',
  wings: 'wings',
  tail: 'tail',
  gear: 'gear',
};

const swatchCss = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

export class GarageScreen extends Screen {
  private section: GarageSection = 'parts';
  private slot: PartCategory = 'engine';
  private selectedId: string | null = null;
  private paintSlot: PaintSlot = 'primary';
  private profile: PlayerProfile | null = null;
  /** How each aircraft looked when the hangar was opened, for Revert. */
  private snapshot: Record<string, HangarEntry> = {};
  private readonly sections: HTMLDivElement;
  private readonly slots: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private readonly credits: HTMLSpanElement;
  private readonly nameplate: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly reveal: HTMLDivElement;
  private toastTimer = 0;
  private setupName = '';

  constructor(private readonly callbacks: GarageCallbacks) {
    super('screen--garage', 'garage');
    this.sections = h('div', { className: 'garage-sections', attrs: { role: 'tablist' } });
    this.slots = h('div', { className: 'slot-grid' });
    this.list = h('div', { className: 'garage-list' });
    this.detail = h('div', { className: 'garage-detail', dataset: { testid: 'garage-detail' } });
    this.stats = h('div', { className: 'garage-stats' });
    this.credits = h('span', { className: 'topbar__credits', dataset: { testid: 'garage-credits' } });
    this.nameplate = h('div', { className: 'nameplate', dataset: { testid: 'garage-nameplate' } });
    this.toast = h('div', { className: 'garage-toast', attrs: { role: 'status', 'aria-live': 'polite' } });
    this.reveal = h('div', { className: 'reveal', dataset: { testid: 'reveal' } });
    this.reveal.hidden = true;

    const topbar = h(
      'div',
      { className: 'topbar' },
      button('Back', callbacks.onBack, { variant: 'ghost', testId: 'garage-back' }),
      h('div', { className: 'topbar__title', text: 'Hangar' }),
      h(
        'div',
        { className: 'topbar__right' },
        h('span', { className: 'topbar__label', text: 'Credits' }),
        this.credits,
      ),
    );
    const left = h('aside', { className: 'garage-left' }, this.sections, this.slots, this.list);
    const right = h(
      'aside',
      { className: 'garage-right' },
      h('h2', { className: 'panel-title', text: 'Flight card' }),
      this.stats,
      button('Race', callbacks.onRace, {
        variant: 'primary',
        testId: 'garage-race',
        className: 'btn--block',
      }),
    );
    this.element.append(topbar, left, this.nameplate, right, this.detail, this.toast, this.reveal);
  }

  /** Called when the hangar opens: remembers every aircraft's state for Revert. */
  open(profile: PlayerProfile): void {
    this.snapshot = structuredClone(profile.hangar);
    this.selectedId = null;
    this.update(profile);
    this.callbacks.onFocus(this.section === 'parts' ? FOCUS_FOR[this.slot] : 'overview');
  }

  /** The screen area (CSS px) left free for the aircraft: between the panels, below the nameplate. */
  freeArea(): { left: number; top: number; right: number; bottom: number } | null {
    if (!this.visible) return null;
    const left = this.element.querySelector('.garage-left')?.getBoundingClientRect();
    const right = this.element.querySelector('.garage-right')?.getBoundingClientRect();
    if (!left || !right || left.width === 0) return null;
    const plate = this.nameplate.getBoundingClientRect();
    const detail = this.detail.getBoundingClientRect();
    const top = plate.height > 0 ? plate.bottom : left.top;
    const bottom = detail.height > 0 ? detail.top : right.bottom;
    return { left: left.right, top, right: right.left, bottom: Math.max(top + 60, bottom) };
  }

  snapshotFor(airframeId: string): HangarEntry | undefined {
    return this.snapshot[airframeId];
  }

  update(profile: PlayerProfile): void {
    this.profile = profile;
    this.credits.textContent = formatCredits(profile.credits);
    if (this.selectedId === null) this.selectedId = this.defaultSelection();
    this.renderSections();
    this.renderSlots();
    this.renderList();
    this.renderDetail();
    this.renderStats();
    this.renderNameplate();
  }

  /** Short confirmation or failure message over the hangar. */
  flash(message: string, tone: 'good' | 'bad' | 'neutral' = 'neutral'): void {
    this.toast.textContent = message;
    this.toast.dataset.tone = tone;
    this.toast.classList.add('is-visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('is-visible'), 2600);
  }

  /** The first look at a newly bought aircraft. */
  showReveal(airframe: Airframe): void {
    clear(this.reveal);
    this.reveal.append(
      h(
        'div',
        { className: 'reveal__card' },
        h('span', { className: 'eyebrow', text: 'New in the hangar' }),
        h('h2', { className: 'reveal__name', text: airframe.name }),
        h('span', { className: 'reveal__type', text: `${airframe.archetype} · ${airframe.designation}` }),
        h('p', { className: 'reveal__line', text: airframe.tagline }),
        h(
          'div',
          { className: 'reveal__actions' },
          button(
            'Take it up',
            () => {
              this.hideReveal();
              this.callbacks.onRace();
            },
            { variant: 'primary', testId: 'reveal-race' },
          ),
          button('Into the hangar', () => this.hideReveal(), { variant: 'ghost', testId: 'reveal-close' }),
        ),
      ),
    );
    this.reveal.hidden = false;
  }

  private hideReveal(): void {
    if (this.reveal.hidden) return;
    this.reveal.hidden = true;
    this.callbacks.onRevealDone();
  }

  private defaultSelection(): string | null {
    const profile = this.profile;
    if (!profile) return null;
    switch (this.section) {
      case 'aircraft':
        return profile.activeAircraft;
      case 'parts':
        return activeEntry(profile).build[this.slot];
      default:
        return null;
    }
  }

  private setSection(section: GarageSection): void {
    this.section = section;
    this.selectedId = null;
    this.callbacks.onFocus(
      section === 'parts' ? FOCUS_FOR[this.slot] : section === 'paint' ? 'paint' : 'overview',
    );
    this.refresh();
  }

  private setSlot(slot: PartCategory): void {
    this.slot = slot;
    this.selectedId = null;
    this.callbacks.onFocus(FOCUS_FOR[slot]);
    this.refresh();
  }

  private select(id: string): void {
    this.selectedId = id;
    this.refresh();
  }

  private refresh(): void {
    if (!this.profile) return;
    this.update(this.profile);
    this.callbacks.onPreview(this.previewSetup());
  }

  /** What the 3D preview and comparison show: the active aircraft with the highlighted change. */
  previewSetup(): AircraftSetup {
    const profile = this.profile;
    if (!profile) throw new Error('Hangar not initialised');
    const entry = activeEntry(profile);
    const base: AircraftSetup = { build: { ...entry.build }, paint: { ...entry.paint }, marks: profile.wins };
    const id = this.selectedId;
    if (!id) return base;
    switch (this.section) {
      case 'aircraft': {
        const airframe = getAirframe(id);
        if (!airframe || airframe.id === profile.activeAircraft) return base;
        const owned = profile.hangar[airframe.id];
        return owned
          ? { build: { ...owned.build }, paint: { ...owned.paint }, marks: profile.wins }
          : { build: defaultBuildFor(airframe), paint: factoryPaint(airframe.id), marks: profile.wins };
      }
      case 'parts': {
        const next = withPart(entry.build, this.slot, id);
        return isValidBuild(next) ? { ...base, build: next } : base;
      }
      case 'setups': {
        const setup = this.findSetup(id);
        return setup
          ? { build: { ...setup.build }, paint: { ...(setup.paint ?? entry.paint) }, marks: profile.wins }
          : base;
      }
      default:
        return base;
    }
  }

  private findSetup(
    id: string,
  ): { name: string; note?: string; build: AircraftBuild; paint?: Paint; saved: boolean } | null {
    const profile = this.profile;
    if (!profile) return null;
    const saved = profile.setups.find((setup) => setup.id === id);
    if (saved) return { ...saved, saved: true };
    const factory = factorySetupsFor(profile.activeAircraft).find((setup) => setup.id === id);
    return factory ? { ...factory, saved: false } : null;
  }

  // --- Rendering -------------------------------------------------------------------------------

  private renderSections(): void {
    clear(this.sections);
    for (const section of SECTIONS) {
      this.sections.append(
        h('button', {
          className: `section-tab${section.id === this.section ? ' is-active' : ''}`,
          text: section.label,
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(section.id === this.section) },
          dataset: { testid: `garage-tab-${section.id}` },
          on: { click: () => this.setSection(section.id) },
        }),
      );
    }
  }

  private renderSlots(): void {
    clear(this.slots);
    const profile = this.profile;
    this.slots.hidden = this.section !== 'parts';
    if (!profile || this.section !== 'parts') return;
    const entry = activeEntry(profile);
    for (const category of PART_CATEGORIES) {
      const fitted = getPartIn(category, entry.build[category]);
      this.slots.append(
        h(
          'button',
          {
            className: `slot-chip${category === this.slot ? ' is-active' : ''}`,
            attrs: { type: 'button', 'aria-pressed': String(category === this.slot) },
            dataset: { testid: `garage-tab-${category}` },
            on: { click: () => this.setSlot(category) },
          },
          h('span', { className: 'slot-chip__label', text: CATEGORY_LABELS[category] }),
          h('span', { className: 'slot-chip__part', text: fitted?.name ?? '' }),
        ),
      );
    }
  }

  private statusMeta(status: PartStatus, item: ShopItem): string {
    switch (status) {
      case 'installed':
        return item.kind === 'airframe' ? 'Flying' : 'Fitted';
      case 'owned':
        return 'Owned';
      case 'locked':
        return 'Locked';
      case 'incompatible':
        return 'Won’t fit';
      default:
        return `${formatCredits(item.price)} cr`;
    }
  }

  private card(item: ShopItem, status: PartStatus, extra: Node | null = null): HTMLButtonElement {
    return h(
      'button',
      {
        className: `part-card part-card--${status}${this.selectedId === item.id ? ' is-selected' : ''}`,
        attrs: { type: 'button', 'aria-pressed': String(this.selectedId === item.id) },
        dataset: { testid: `part-${item.id}`, status },
        on: { click: () => this.select(item.id) },
      },
      extra,
      h(
        'span',
        { className: 'part-card__body' },
        h('span', { className: 'part-card__name', text: item.name }),
        h(
          'span',
          { className: 'part-card__meta' },
          h('span', {
            className: 'part-card__role',
            text: item.kind === 'airframe' ? item.archetype : item.role,
          }),
          h('span', { className: 'part-card__status', text: this.statusMeta(status, item) }),
        ),
      ),
    );
  }

  private renderList(): void {
    clear(this.list);
    const profile = this.profile;
    if (!profile) return;
    this.list.dataset.section = this.section;
    switch (this.section) {
      case 'aircraft':
        for (const airframe of AIRFRAMES) {
          this.list.append(
            this.card(
              airframe,
              partStatus(profile, airframe),
              h('span', { className: 'part-card__art' }, airframeSilhouette(airframe.id)),
            ),
          );
        }
        return;
      case 'parts': {
        const parts = partsForCategory(this.slot);
        const fits = parts.filter((part) => partStatus(profile, part) !== 'incompatible');
        const others = parts.filter((part) => partStatus(profile, part) === 'incompatible');
        for (const part of fits)
          this.list.append(this.card(part, partStatus(profile, part), this.tierMark(part)));
        if (others.length) {
          this.list.append(
            h('div', {
              className: 'list-divider',
              text: `Not for the ${getAirframe(profile.activeAircraft)?.name ?? 'this aircraft'}`,
            }),
          );
          for (const part of others) this.list.append(this.card(part, 'incompatible', this.tierMark(part)));
        }
        return;
      }
      case 'paint':
        this.renderPaint(profile);
        return;
      case 'setups':
        this.renderSetups(profile);
        return;
    }
  }

  /** A small mark for parts that are upgrades of another part. */
  private tierMark(item: ShopItem): HTMLSpanElement {
    let depth = 0;
    let current: ShopItem | undefined = item;
    while (current?.requires && depth < 3) {
      depth += 1;
      current = getItem(current.requires);
    }
    return h('span', {
      className: `part-card__tier part-card__tier--${depth}`,
      attrs: { 'aria-hidden': 'true' },
    });
  }

  private renderPaint(profile: PlayerProfile): void {
    const paint = activeEntry(profile).paint;
    const apply = (patch: Partial<Paint>) => this.callbacks.onPaint({ ...paint, ...patch });
    const current = matchingTheme(paint);

    const themes = h('div', { className: 'paint-themes' });
    for (const theme of THEMES) {
      const unlocked = isThemeUnlocked(theme, profile.badges);
      const badge = theme.badge ? getBadge(theme.badge) : undefined;
      themes.append(
        h(
          'button',
          {
            className: `theme-card${current?.id === theme.id ? ' is-selected' : ''}${unlocked ? '' : ' is-locked'}`,
            attrs: {
              type: 'button',
              'aria-pressed': String(current?.id === theme.id),
              title: unlocked ? theme.note : `Earn the ${badge?.name ?? ''} badge: ${badge?.goal ?? ''}`,
            },
            dataset: { testid: `part-${theme.id}`, status: unlocked ? 'available' : 'locked' },
            on: {
              click: () =>
                unlocked ? apply(theme.paint) : this.flash(`Locked: ${badge?.goal ?? 'earn its badge'}`),
            },
          },
          h(
            'span',
            { className: 'theme-card__strip' },
            ...(['primary', 'secondary', 'accent'] as const).map((slot) =>
              h('span', {
                style: { background: swatchCss(SWATCHES.find((s) => s.id === theme.paint[slot])!.color) },
              }),
            ),
          ),
          h('span', { className: 'theme-card__name', text: theme.name }),
          h('span', {
            className: 'theme-card__note',
            text: unlocked ? theme.note : `Locked · ${badge?.name ?? ''}`,
          }),
        ),
      );
    }

    const slotRow = h('div', { className: 'paint-slots', attrs: { role: 'tablist' } });
    for (const slot of PAINT_SLOTS) {
      const swatch = SWATCHES.find((s) => s.id === paint[slot.id]);
      slotRow.append(
        h(
          'button',
          {
            className: `paint-slot${slot.id === this.paintSlot ? ' is-active' : ''}`,
            attrs: { type: 'button', role: 'tab', 'aria-selected': String(slot.id === this.paintSlot) },
            dataset: { testid: `paint-slot-${slot.id}` },
            on: {
              click: () => {
                this.paintSlot = slot.id;
                this.refresh();
              },
            },
          },
          h('span', { className: 'paint-slot__dot', style: { background: swatchCss(swatch?.color ?? 0) } }),
          h('span', { text: slot.label }),
        ),
      );
    }
    const swatches = h('div', { className: 'swatch-grid' });
    for (const swatch of SWATCHES) {
      const unlocked = isSwatchUnlocked(swatch, profile.badges);
      const active = paint[this.paintSlot] === swatch.id;
      const badge = swatch.badge ? getBadge(swatch.badge) : undefined;
      swatches.append(
        h('button', {
          className: `swatch${active ? ' is-active' : ''}${unlocked ? '' : ' is-locked'}`,
          style: { background: swatchCss(swatch.color) },
          attrs: {
            type: 'button',
            'aria-label': `${swatch.name}${unlocked ? '' : ' (locked)'}`,
            'aria-pressed': String(active),
            title: unlocked ? swatch.name : `${swatch.name}: earn the ${badge?.name ?? ''} badge`,
          },
          dataset: { testid: `swatch-${swatch.id}` },
          on: {
            click: () =>
              unlocked
                ? apply({ [this.paintSlot]: swatch.id } as Partial<Paint>)
                : this.flash(`${swatch.name} is earned with the ${badge?.name ?? ''} badge`),
          },
        }),
      );
    }

    const patterns = h('div', { className: 'chip-row' });
    for (const pattern of PATTERNS) {
      patterns.append(
        h('button', {
          className: `chip-button${paint.pattern === pattern.id ? ' is-active' : ''}`,
          text: pattern.name,
          attrs: {
            type: 'button',
            title: pattern.hint,
            'aria-pressed': String(paint.pattern === pattern.id),
          },
          dataset: { testid: `pattern-${pattern.id}` },
          on: { click: () => apply({ pattern: pattern.id }) },
        }),
      );
    }
    const insignia = h('div', { className: 'chip-row' });
    for (const mark of INSIGNIA) {
      insignia.append(
        h('button', {
          className: `chip-button${paint.insignia === mark.id ? ' is-active' : ''}`,
          text: mark.name,
          attrs: { type: 'button', 'aria-pressed': String(paint.insignia === mark.id) },
          dataset: { testid: `insignia-${mark.id}` },
          on: { click: () => apply({ insignia: mark.id }) },
        }),
      );
    }
    const number = h(
      'div',
      { className: 'number-stepper' },
      h('button', {
        className: 'stepper__btn',
        text: '−',
        attrs: { type: 'button', 'aria-label': 'Lower race number' },
        dataset: { testid: 'number-down' },
        on: { click: () => apply({ number: (paint.number + 99) % 100 }) },
      }),
      h('span', {
        className: 'stepper__value',
        text: String(paint.number).padStart(2, '0'),
        dataset: { testid: 'paint-number' },
      }),
      h('button', {
        className: 'stepper__btn',
        text: '+',
        attrs: { type: 'button', 'aria-label': 'Raise race number' },
        dataset: { testid: 'number-up' },
        on: { click: () => apply({ number: (paint.number + 1) % 100 }) },
      }),
    );

    this.list.append(
      h('h3', { className: 'list-heading', text: 'Themes' }),
      themes,
      h('h3', { className: 'list-heading', text: 'Colours' }),
      slotRow,
      swatches,
      h('h3', { className: 'list-heading', text: 'Pattern' }),
      patterns,
      h('h3', { className: 'list-heading', text: 'Insignia' }),
      insignia,
      h('h3', { className: 'list-heading', text: 'Race number' }),
      number,
    );
  }

  private renderSetups(profile: PlayerProfile): void {
    const airframe = getAirframe(profile.activeAircraft);
    this.list.append(
      h('h3', { className: 'list-heading', text: `Factory setups · ${airframe?.name ?? ''}` }),
    );
    for (const setup of factorySetupsFor(profile.activeAircraft)) {
      const missing = missingParts(profile, setup.build).length;
      this.list.append(
        this.setupCard(
          setup.id,
          setup.name,
          missing === 0 ? 'Ready' : `Needs ${missing} part${missing === 1 ? '' : 's'}`,
          setup.build,
        ),
      );
    }
    this.list.append(
      h('h3', { className: 'list-heading', text: `Your setups · ${profile.setups.length}/${MAX_SETUPS}` }),
    );
    if (profile.setups.length === 0)
      this.list.append(
        h('p', { className: 'list-empty', text: 'Save a configuration to switch back to it in one tap.' }),
      );
    for (const setup of profile.setups) {
      const owner = getAirframe(setup.build.airframe);
      this.list.append(this.setupCard(setup.id, setup.name, owner?.name ?? '', setup.build));
    }
    const input = h('input', {
      className: 'setup-name',
      attrs: {
        type: 'text',
        maxlength: String(SETUP_NAME_LENGTH),
        placeholder: `${airframe?.name ?? 'Aircraft'} setup ${profile.setups.length + 1}`,
        'aria-label': 'Setup name',
        enterkeyhint: 'done',
      },
      dataset: { testid: 'setup-name' },
      on: {
        input: (event) => {
          this.setupName = (event.target as HTMLInputElement).value;
        },
        keydown: (event) => event.stopPropagation(),
      },
    });
    input.value = this.setupName;
    const full = profile.setups.length >= MAX_SETUPS;
    this.list.append(
      h(
        'div',
        { className: 'setup-save' },
        input,
        button(
          full ? 'Slots full' : 'Save current',
          () => {
            const name = this.setupName.trim() || input.placeholder;
            this.setupName = '';
            this.callbacks.onSaveSetup(name);
          },
          { testId: 'setup-save', disabled: full },
        ),
      ),
    );
  }

  private setupCard(id: string, name: string, meta: string, build: AircraftBuild): HTMLButtonElement {
    const character = buildCharacter(performanceForBuild(build)).label;
    return h(
      'button',
      {
        className: `part-card part-card--setup${this.selectedId === id ? ' is-selected' : ''}`,
        attrs: { type: 'button', 'aria-pressed': String(this.selectedId === id) },
        dataset: { testid: `setup-${id}` },
        on: { click: () => this.select(id) },
      },
      h(
        'span',
        { className: 'part-card__body' },
        h('span', { className: 'part-card__name', text: name }),
        h(
          'span',
          { className: 'part-card__meta' },
          h('span', { className: 'part-card__role', text: character }),
          h('span', { className: 'part-card__status', text: meta }),
        ),
      ),
    );
  }

  private renderNameplate(): void {
    clear(this.nameplate);
    const profile = this.profile;
    if (!profile) return;
    const preview = this.previewSetup();
    const airframe = getAirframe(preview.build.airframe);
    if (!airframe) return;
    const character = buildCharacter(performanceForBuild(preview.build));
    const course = character.leading[0] ? courseForSpecialty(character.leading[0]) : undefined;
    this.nameplate.append(
      h('span', { className: 'nameplate__type', text: `${airframe.archetype} · ${airframe.designation}` }),
      h('h2', { className: 'nameplate__name', text: airframe.name, dataset: { testid: 'nameplate-name' } }),
      h(
        'span',
        { className: 'nameplate__character', dataset: { testid: 'nameplate-character' } },
        h('span', { text: character.label }),
        course ? h('span', { className: 'nameplate__suits', text: ` · suits ${course}` }) : null,
      ),
    );
  }

  private revertButton(): HTMLButtonElement | null {
    const profile = this.profile;
    if (!profile) return null;
    const before = this.snapshot[profile.activeAircraft];
    if (!before || entriesEqual(before, activeEntry(profile))) return null;
    return button('Revert', () => this.callbacks.onRevert(), { variant: 'ghost', testId: 'garage-revert' });
  }

  /** Builds the rows of facts under an item description. */
  private facts(rows: [string, string | null][]): HTMLDListElement {
    const list = h('dl', { className: 'detail__facts' });
    for (const [label, value] of rows) {
      if (!value) continue;
      list.append(h('dt', { text: label }), h('dd', { text: value }));
    }
    return list;
  }

  private renderDetail(): void {
    clear(this.detail);
    const profile = this.profile;
    if (!profile) return;
    const revert = this.revertButton();
    if (this.section === 'paint') {
      const paint = activeEntry(profile).paint;
      const theme = matchingTheme(paint);
      this.detail.append(
        h(
          'div',
          { className: 'detail__text' },
          h('span', { className: 'detail__tagline', text: 'Paint shop' }),
          h('h3', { className: 'detail__name', text: theme ? theme.name : 'Custom livery' }),
          h('p', {
            className: 'detail__desc detail__desc--keep',
            text: 'Paint is free, applies at once and never changes how the aircraft flies. Earned colours come from skill badges.',
          }),
        ),
        h('div', { className: 'detail__actions' }, revert),
      );
      return;
    }
    if (this.section === 'setups') {
      const setup = this.selectedId ? this.findSetup(this.selectedId) : null;
      if (!setup) {
        this.detail.append(
          h(
            'div',
            { className: 'detail__text' },
            h('span', { className: 'detail__tagline', text: 'Setups' }),
            h('h3', { className: 'detail__name', text: 'Builds you can switch between' }),
            h('p', {
              className: 'detail__desc detail__desc--keep',
              text: 'Factory setups show what each aircraft can become. Your own setups keep parts and paint together.',
            }),
          ),
          h('div', { className: 'detail__actions' }, revert),
        );
        return;
      }
      const missing = missingParts(profile, setup.build);
      const missingNames = missing.map((id) => getItem(id)?.name ?? id);
      const character = buildCharacter(performanceForBuild(setup.build)).label;
      const apply = button(
        missing.length ? 'Missing parts' : 'Apply setup',
        () => this.callbacks.onApplyBuild(setup.build, setup.saved ? setup.paint : undefined),
        { variant: 'primary', testId: 'garage-action', disabled: missing.length > 0 },
      );
      this.detail.append(
        h(
          'div',
          { className: 'detail__text' },
          h('span', { className: 'detail__tagline', text: setup.saved ? 'Your setup' : 'Factory setup' }),
          h('h3', { className: 'detail__name', text: setup.name }),
          setup.note ? h('p', { className: 'detail__desc', text: setup.note }) : null,
          this.facts([
            ['Character', character],
            [
              'Parts',
              PART_CATEGORIES.map((category) => getPartIn(category, setup.build[category])?.name ?? '').join(
                ', ',
              ),
            ],
            ['Still to buy', missingNames.length ? missingNames.join(', ') : null],
          ]),
        ),
        h(
          'div',
          { className: 'detail__actions' },
          apply,
          setup.saved && this.selectedId
            ? button('Delete', () => this.callbacks.onDeleteSetup(this.selectedId!), {
                variant: 'ghost',
                testId: 'setup-delete',
              })
            : null,
          revert,
        ),
      );
      return;
    }

    const item = this.selectedId ? getItem(this.selectedId) : undefined;
    if (!item) return;
    const status = partStatus(profile, item);
    const activeName = getAirframe(profile.activeAircraft)?.name ?? '';
    let action: HTMLButtonElement;
    let note = '';
    const price = `${formatCredits(item.price)} cr`;
    switch (status) {
      case 'installed':
        action = button(item.kind === 'airframe' ? 'Flying' : 'Fitted', () => undefined, {
          variant: 'primary',
          testId: 'garage-action',
          disabled: true,
        });
        break;
      case 'owned':
        action =
          item.kind === 'airframe'
            ? button(`Fly the ${item.name}`, () => this.callbacks.onSelectAircraft(item.id), {
                variant: 'primary',
                testId: 'garage-action',
              })
            : button(`Fit to ${activeName}`, () => this.callbacks.onInstall(item.category, item.id), {
                variant: 'primary',
                testId: 'garage-action',
              });
        break;
      case 'available':
        action = button(
          item.kind === 'airframe' ? `Buy · ${price}` : `Buy & fit · ${price}`,
          () => this.callbacks.onPurchase(item.id),
          {
            variant: 'primary',
            testId: 'garage-action',
          },
        );
        break;
      case 'unaffordable':
        action = button(
          item.kind === 'airframe' ? `Buy · ${price}` : `Buy & fit · ${price}`,
          () => undefined,
          {
            variant: 'primary',
            testId: 'garage-action',
            disabled: true,
          },
        );
        note = `Need ${formatCredits(item.price - profile.credits)} more credits. Race to earn more.`;
        break;
      case 'locked': {
        action = button('Locked', () => undefined, {
          variant: 'primary',
          testId: 'garage-action',
          disabled: true,
        });
        const prerequisite = item.requires ? getItem(item.requires) : undefined;
        const needs: string[] = [];
        if (prerequisite && !profile.ownedParts.includes(prerequisite.id))
          needs.push(`Own the ${prerequisite.name} first`);
        if (!isAvailable(profile, { ...item, requires: undefined })) needs.push(describeUnlock(item.unlock));
        note = needs.join('. ');
        break;
      }
      case 'incompatible': {
        action = button('Won’t fit', () => undefined, {
          variant: 'primary',
          testId: 'garage-action',
          disabled: true,
        });
        const fits =
          item.kind === 'part'
            ? airframesAccepting(item)
                .map((airframe) => airframe.name)
                .join(', ')
            : '';
        note = `The ${activeName} can’t take this part. Fits: ${fits}.`;
        break;
      }
    }

    const specialty = ROLE_SPECIALTY[item.kind === 'airframe' ? '' : item.role];
    const suits = specialty ? courseForSpecialty(specialty) : undefined;
    const upgradeOf = item.requires ? getItem(item.requires)?.name : undefined;
    const fitted =
      item.kind === 'part' ? getPartIn(item.category, activeEntry(profile).build[item.category]) : undefined;
    this.detail.append(
      h(
        'div',
        { className: 'detail__text' },
        h('span', {
          className: 'detail__tagline',
          text: item.kind === 'airframe' ? `${item.archetype} · ${item.designation}` : item.tagline,
        }),
        h('h3', { className: 'detail__name', text: item.name }),
        h('p', {
          className: 'detail__desc',
          text: item.kind === 'airframe' ? item.tagline : item.description,
        }),
        this.facts([
          ['Best at', item.strength],
          ['Trade-off', item.tradeoff],
          ['On the aircraft', item.kind === 'part' ? item.look : item.role],
          [
            'Replaces',
            status === 'owned' || status === 'available' || status === 'unaffordable'
              ? (fitted?.name ?? null)
              : null,
          ],
          ['Upgrade of', upgradeOf ?? null],
          ['Suits', suits ?? null],
        ]),
      ),
      h(
        'div',
        { className: 'detail__actions' },
        action,
        note
          ? h('span', { className: 'detail__note', text: note, dataset: { testid: 'garage-note' } })
          : null,
        revert,
      ),
    );
  }

  private renderStats(): void {
    clear(this.stats);
    const profile = this.profile;
    if (!profile) return;
    const current = performanceForBuild(activeEntry(profile).build);
    const previewSetup = this.previewSetup();
    const preview = performanceForBuild(previewSetup.build);
    const comparing =
      previewSetup.build !== undefined &&
      JSON.stringify(previewSetup.build) !== JSON.stringify(activeEntry(profile).build);
    for (const group of STAT_GROUPS) {
      const block = h(
        'div',
        { className: 'stat-group' },
        h('h3', { className: 'stat-group__title', text: group.title }),
      );
      for (const row of group.rows) {
        const before = current.ratings[row.key];
        const after = preview.ratings[row.key];
        const delta = after - before;
        const deltaClass = delta > 0 ? 'is-better' : delta < 0 ? 'is-worse' : '';
        block.append(
          h(
            'div',
            { className: 'stat-row', title: row.hint, dataset: { testid: `stat-${row.key}` } },
            h('span', { className: 'stat-row__label', text: row.label }),
            h('span', {
              className: `stat-row__value ${comparing ? deltaClass : ''}`,
              text: comparing ? row.value(preview) : row.value(current),
              dataset: { testid: `stat-${row.key}-value` },
            }),
            h(
              'div',
              { className: 'stat-bar' },
              h('div', { className: 'stat-bar__fill', style: { width: `${Math.min(before, after)}%` } }),
              comparing && delta !== 0
                ? h('div', {
                    className: `stat-bar__preview ${deltaClass}`,
                    style: { left: `${Math.min(before, after)}%`, width: `${Math.abs(delta)}%` },
                  })
                : null,
            ),
            h('span', {
              className: `stat-row__delta ${deltaClass}`,
              text: comparing && delta !== 0 ? `${delta > 0 ? '+' : '−'}${Math.abs(delta)}` : '',
            }),
          ),
        );
      }
      this.stats.append(block);
    }
    this.stats.append(
      h(
        'div',
        { className: 'build-line' },
        h('span', { text: 'Mass' }),
        h('span', {
          text: `${Math.round(comparing ? preview.mass : current.mass)} kg`,
          dataset: { testid: 'stat-mass' },
        }),
      ),
    );
    if (comparing)
      this.stats.append(
        h('div', { className: 'build-line build-line--hint', text: 'Preview against what is fitted now' }),
      );
  }
}
