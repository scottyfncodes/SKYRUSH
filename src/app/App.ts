import { createCircuit, type Circuit } from '../course/circuit';
import { Renderer, detectWebGL, isCoarsePointer } from '../render/Renderer';
import { GarageStage } from './GarageStage';
import { RaceStage } from './RaceStage';
import { InputManager } from '../controls/InputManager';
import { AudioEngine } from '../audio/AudioEngine';
import { Hud } from '../ui/Hud';
import { MainMenuScreen } from '../ui/MainMenuScreen';
import { GarageScreen } from '../ui/GarageScreen';
import { BriefingScreen } from '../ui/BriefingScreen';
import { PauseScreen } from '../ui/PauseScreen';
import { ResultsScreen } from '../ui/ResultsScreen';
import { createFatalScreen, createLoadingScreen, createRotatePrompt } from '../ui/Overlays';
import { loadProfile, resolveStorage, saveProfile, type StorageLike } from '../progression/save';
import {
  activeBuild,
  activeSetup,
  applyBuild,
  deleteSetup,
  installPart,
  markRevealed,
  purchasePart,
  saveSetup,
  selectAircraft,
  selectCircuit,
  setPaint,
  updateSettings,
  type PlayerProfile,
  type PlayerSettings,
  type PurchaseFailure,
} from '../progression/profile';
import { applyRaceOutcome } from '../progression/rewards';
import type { AircraftBuild } from '../aircraft/build';
import { AIRFRAMES, getAirframe, getItem, getPartIn, type PartCategory } from '../aircraft/parts';
import type { Paint } from '../aircraft/paint';
import { difficultyMultiplier } from '../ai/AiPilot';
import type { Standing } from '../race/RaceSimulation';
import { h } from '../ui/dom';
import type { StyleTracker } from '../style/StyleTracker';
import type { RunStyleStats } from '../progression/badges';

export type AppScreen =
  | 'loading'
  | 'menu'
  | 'garage'
  | 'briefing'
  | 'race'
  | 'paused'
  | 'results'
  | 'settings';

export interface TestHarness {
  getState: () => {
    screen: AppScreen;
    selectedCircuit: string;
    credits: number;
    build: AircraftBuild;
    paint: Paint;
    ownedParts: string[];
    race: null | {
      circuitId: string;
      phase: string;
      clock: number;
      nextGate: number;
      gatesPassed: number;
      position: number;
      finished: boolean;
      speed: number;
      altitude: number;
      boost: number;
      heat: number;
      paused: boolean;
      x: number;
      y: number;
      z: number;
      style: ReturnType<StyleTracker['snapshot']>;
    };
  };
  /** GPU resources currently allocated (geometries, textures), for leak checks. */
  getRenderInfo: () => { geometries: number; textures: number };
  setAutopilot: (enabled: boolean) => void;
  setTimeScale: (scale: number) => void;
  simulateToFinish: () => void;
  /** Puts the player on a straight approach to a bonus ring (`distance` m out). */
  approachRing: (index: number, distance?: number) => void;
}

declare global {
  interface Window {
    __skyrushTest?: TestHarness;
  }
}

/**
 * Top-level state machine: menu → garage → briefing → race → results → …
 * Owns the renderer, the persistent profile and every screen.
 */
export class App {
  private screen: AppScreen = 'loading';
  private profile: PlayerProfile;
  private readonly storage: StorageLike;
  private readonly circuits = new Map<string, Circuit>();
  private renderer!: Renderer;
  private garageStage!: GarageStage;
  private raceStage: RaceStage | null = null;
  private readonly input: InputManager;
  private readonly audio = new AudioEngine();
  private readonly hud: Hud;
  private readonly isTouch: boolean;
  private readonly ui: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly menu: MainMenuScreen;
  private readonly garage: GarageScreen;
  private readonly briefing: BriefingScreen;
  private readonly pause: PauseScreen;
  private readonly settings: PauseScreen;
  private readonly results: ResultsScreen;
  private loading: HTMLDivElement | null = null;
  private lastFrame = 0;
  private rafId = 0;
  private disposed = false;
  private readonly portraitQuery: MediaQueryList | null;

  constructor(
    private readonly root: HTMLElement,
    options: { enableTestHarness?: boolean } = {},
  ) {
    this.storage = resolveStorage();
    this.profile = loadProfile(this.storage).profile;
    this.isTouch = isCoarsePointer();

    this.canvas = h('canvas', { id: 'game-canvas', attrs: { 'aria-label': 'SKYRUSH game view' } });
    this.ui = h('div', { id: 'ui' });
    root.append(this.canvas, this.ui);
    this.loading = createLoadingScreen(this.ui);

    this.hud = new Hud(this.ui);
    this.input = new InputManager(this.ui, this.isTouch ? 'touch' : 'keyboard');
    this.input.options = {
      invertPitch: this.profile.settings.invertPitch,
      sensitivity: this.profile.settings.sensitivity,
    };

    this.menu = new MainMenuScreen({
      onRace: () => this.quickRace(),
      onSelectCourse: (courseId) => this.selectCourse(courseId),
      onGarage: () => this.goGarage(),
      onControls: () => this.goSettings(),
    });
    this.garage = new GarageScreen({
      onBack: () => this.goMenu(),
      onRace: () => this.goBriefing(),
      onInstall: (category, partId) => this.install(category, partId),
      onPurchase: (id) => this.purchase(id),
      onSelectAircraft: (id) => this.chooseAircraft(id),
      onPaint: (paint) => this.applyPaint(paint),
      onRevert: () => this.revert(),
      onApplyBuild: (build, paint) => this.applySetup(build, paint),
      onSaveSetup: (name) => this.saveCurrentSetup(name),
      onDeleteSetup: (id) => this.removeSetup(id),
      onPreview: (setup) => this.garageStage.setSetup(setup),
      onFocus: (focus) => this.garageStage.setFocus(focus),
      onRevealDone: () => this.garageStage.setFocus('overview'),
    });
    this.briefing = new BriefingScreen(
      {
        onStart: () => this.startRace(),
        onBack: () => this.goGarage(),
        onSettings: (patch) => this.changeSettings(patch),
        onSelectCourse: (courseId) => this.selectCourse(courseId),
      },
      this.isTouch,
    );
    this.pause = new PauseScreen(
      {
        onResume: () => this.resumeRace(),
        onRestart: () => this.restartRace(),
        onQuit: () => this.quitRace(),
        onSettings: (patch) => this.changeSettings(patch),
      },
      this.isTouch,
    );
    this.settings = new PauseScreen(
      {
        onResume: () => this.goMenu(),
        onRestart: () => undefined,
        onQuit: () => undefined,
        onSettings: (patch) => this.changeSettings(patch),
      },
      this.isTouch,
      'settings',
    );
    this.results = new ResultsScreen({
      onRaceAgain: () => this.raceAgain(),
      onGarage: () => this.goGarage(),
      onMenu: () => this.goMenu(),
    });
    this.ui.append(
      this.menu.element,
      this.garage.element,
      this.briefing.element,
      this.pause.element,
      this.settings.element,
      this.results.element,
    );
    createRotatePrompt(this.ui);

    this.input.onAction((action) => {
      if (action === 'pause') {
        if (this.screen === 'race') this.pauseRace();
        else if (this.screen === 'paused') this.resumeRace();
      } else if (action === 'restart' && (this.screen === 'race' || this.screen === 'paused')) {
        this.restartRace();
      } else if (action === 'recenter' && this.screen === 'race') {
        this.raceStage?.recenterCamera();
      } else if (action === 'mute' && (this.screen === 'race' || this.screen === 'paused')) {
        const audio = !this.profile.settings.audio;
        this.changeSettings({ audio });
        this.hud.showMessage(audio ? 'Sound on' : 'Sound off', 'neutral', 1.2);
      }
    });

    // Unlock audio on the first gesture anywhere.
    const unlock = () => {
      this.audio.unlock();
      this.audio.setEnabled(this.profile.settings.audio);
    };
    this.ui.addEventListener('pointerdown', unlock, { passive: true });
    this.ui.addEventListener('keydown', unlock);
    window.addEventListener('keydown', unlock, { once: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'race') this.pauseRace();
      // iOS suspends the AudioContext in the background; try to resume on return
      // (it may still need the next tap, which the pointerdown unlock handles).
      if (!document.hidden) this.audio.unlock();
    });
    this.portraitQuery =
      typeof window.matchMedia === 'function' ? window.matchMedia('(orientation: portrait)') : null;
    this.portraitQuery?.addEventListener('change', (event) => {
      if (event.matches && this.isTouch && this.screen === 'race') this.pauseRace();
    });

    if (options.enableTestHarness) this.installTestHarness();
  }

  /** Creates the renderer and enters the main menu. Returns false on WebGL failure. */
  start(): boolean {
    if (!detectWebGL()) {
      this.fail(
        'WebGL is not available',
        'SKYRUSH needs WebGL to render the race. Try a current version of Safari, Chrome, Edge or Firefox with hardware acceleration enabled.',
      );
      return false;
    }
    try {
      // ?quality=high|low overrides the automatic choice (low only without a GPU).
      const quality = new URLSearchParams(window.location.search).get('quality');
      this.renderer = new Renderer(this.canvas, quality === 'high' || quality === 'low' ? { quality } : {});
    } catch (error) {
      console.error(error);
      this.fail(
        'The 3D renderer could not start',
        'Your browser refused to create a WebGL context. Close other graphics-heavy tabs and reload.',
      );
      return false;
    }
    this.garageStage = new GarageStage(activeSetup(this.profile), this.renderer);
    this.loading?.remove();
    this.loading = null;
    this.goMenu();
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      this.tick(dt);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
    return true;
  }

  private fail(title: string, detail: string): void {
    this.loading?.remove();
    this.loading = null;
    createFatalScreen(this.ui, title, detail);
    this.screen = 'loading';
  }

  private tick(dt: number): void {
    switch (this.screen) {
      case 'menu':
      case 'garage':
      case 'briefing':
      case 'settings':
        this.garageStage.update(dt);
        this.garageStage.render();
        break;
      case 'race':
      case 'paused':
      case 'results':
        this.raceStage?.update(dt);
        break;
      default:
        break;
    }
  }

  private setScreen(screen: AppScreen): void {
    this.screen = screen;
    this.root.dataset.screen = screen;
    this.menu.hide();
    this.garage.hide();
    this.briefing.hide();
    this.pause.hide();
    this.settings.hide();
    this.results.hide();
    const inRace = screen === 'race';
    this.input.setEnabled(inRace);
    if (inRace) this.hud.show();
    else if (screen !== 'paused' && screen !== 'results') this.hud.hide();
    this.garageStage.interactive = screen === 'menu' || screen === 'garage';
  }

  /** The selected course (built once per course and cached). */
  private get circuit(): Circuit {
    const id = this.profile.selectedCircuit;
    let circuit = this.circuits.get(id);
    if (!circuit) {
      circuit = createCircuit(id);
      this.circuits.set(id, circuit);
    }
    return circuit;
  }

  private selectCourse(courseId: string): void {
    const next = selectCircuit(this.profile, courseId);
    if (next === this.profile) return;
    this.profile = next;
    this.persist();
    this.audio.uiClick();
    if (this.screen === 'menu') this.menu.update(this.profile);
    else if (this.screen === 'briefing') this.briefing.update(this.circuit, this.profile);
  }

  private persist(): void {
    saveProfile(this.storage, this.profile);
  }

  // --- Navigation -------------------------------------------------------------------

  goMenu(): void {
    this.disposeRace();
    this.garageStage.focusOffset = 0;
    this.garageStage.setSetup(activeSetup(this.profile));
    this.garageStage.setFocus('overview');
    this.setScreen('menu');
    this.menu.update(this.profile);
    this.menu.show();
  }

  goGarage(): void {
    this.disposeRace();
    this.garageStage.focusOffset = 0;
    this.garageStage.setSetup(activeSetup(this.profile));
    this.setScreen('garage');
    this.garage.open(this.profile);
    this.garage.show();
  }

  /** Returning players go straight to the grid; the briefing is for the first race. */
  quickRace(): void {
    if (this.profile.racesCompleted > 0) this.startRace();
    else this.goBriefing();
  }

  goBriefing(): void {
    this.disposeRace();
    this.garageStage.setSetup(activeSetup(this.profile));
    this.garageStage.setFocus('overview');
    this.setScreen('briefing');
    this.briefing.update(this.circuit, this.profile);
    this.briefing.show();
  }

  goSettings(): void {
    this.setScreen('settings');
    this.settings.update(this.profile.settings);
    this.settings.show();
  }

  // --- Garage actions ------------------------------------------------------------------

  /** Re-renders the hangar and its 3D aircraft from the saved profile. */
  private refreshGarage(): void {
    this.persist();
    this.garage.update(this.profile);
    this.garageStage.setSetup(this.garage.previewSetup());
  }

  private install(category: PartCategory, partId: string): void {
    const result = installPart(this.profile, category, partId);
    if (!result.ok) {
      this.garage.flash(`Could not fit that part (${result.reason.replace('-', ' ')})`, 'bad');
      return;
    }
    this.profile = result.profile;
    this.refreshGarage();
    this.audio.uiClick();
    const part = getPartIn(category, partId);
    const airframe = getAirframe(this.profile.activeAircraft);
    if (part && airframe) this.garage.flash(`${part.name} fitted to the ${airframe.name}`, 'good');
  }

  private purchase(id: string): void {
    const result = purchasePart(this.profile, id);
    if (!result.ok) {
      this.garage.flash(PURCHASE_FAILURES[result.reason], 'bad');
      return;
    }
    this.profile = result.profile;
    const item = getItem(id);
    if (item?.kind === 'airframe') {
      this.profile = markRevealed(selectAircraft(this.profile, id), id);
      this.refreshGarage();
      this.garageStage.playReveal();
      this.garage.showReveal(item);
      this.audio.personalBest();
      return;
    }
    // A freshly bought part goes straight onto the active aircraft.
    if (item?.kind === 'part') {
      const installed = installPart(this.profile, item.category, id);
      if (installed.ok) this.profile = installed.profile;
    }
    this.refreshGarage();
    this.audio.uiClick();
    const airframe = getAirframe(this.profile.activeAircraft);
    const firstUpgrade = boughtParts(this.profile).length === 1;
    if (item && airframe)
      this.garage.flash(
        firstUpgrade
          ? `First upgrade fitted. Take the ${airframe.name} up and feel the difference.`
          : `${item.name} bought and fitted to the ${airframe.name}`,
        'good',
      );
  }

  private chooseAircraft(id: string): void {
    const next = selectAircraft(this.profile, id);
    if (next === this.profile) return;
    this.profile = next;
    this.refreshGarage();
    this.audio.uiClick();
  }

  private applyPaint(paint: Paint): void {
    const next = setPaint(this.profile, paint);
    if (next === this.profile) {
      this.garage.flash('That colour is not unlocked yet', 'bad');
      return;
    }
    this.profile = next;
    this.refreshGarage();
  }

  private applySetup(build: AircraftBuild, paint?: Paint): void {
    const result = applyBuild(this.profile, build, paint);
    if (!result.ok) {
      this.garage.flash('Buy the missing parts before applying this setup', 'bad');
      return;
    }
    this.profile = result.profile;
    this.refreshGarage();
    this.audio.uiClick();
    this.garage.flash('Setup applied', 'good');
  }

  /** Restores the active aircraft to how it was when the hangar was opened. */
  private revert(): void {
    const before = this.garage.snapshotFor(this.profile.activeAircraft);
    if (!before) return;
    const result = applyBuild(this.profile, before.build, before.paint);
    if (!result.ok) return;
    this.profile = result.profile;
    this.refreshGarage();
    this.garage.flash('Reverted to how it was when you came in', 'neutral');
  }

  private saveCurrentSetup(name: string): void {
    const result = saveSetup(this.profile, name);
    if (!result.ok) {
      this.garage.flash(
        result.reason === 'full' ? 'All setup slots are in use' : 'Give the setup a name',
        'bad',
      );
      return;
    }
    this.profile = result.profile;
    this.refreshGarage();
    this.garage.flash(`Saved “${result.setup.name}”`, 'good');
  }

  private removeSetup(id: string): void {
    this.profile = deleteSetup(this.profile, id);
    this.refreshGarage();
  }

  private changeSettings(patch: Partial<PlayerSettings>): void {
    this.profile = updateSettings(this.profile, patch);
    this.persist();
    this.input.options = {
      invertPitch: this.profile.settings.invertPitch,
      sensitivity: this.profile.settings.sensitivity,
    };
    this.audio.setEnabled(this.profile.settings.audio);
    this.raceStage?.updateSettings(this.profile.settings);
  }

  // --- Race flow ------------------------------------------------------------------------

  private startRace(): void {
    this.disposeRace();
    this.raceStage = new RaceStage({
      circuit: this.circuit,
      renderer: this.renderer,
      input: this.input,
      hud: this.hud,
      audio: this.audio,
      setup: activeSetup(this.profile),
      settings: this.profile.settings,
      aiSkill: difficultyMultiplier(this.profile.wins),
      onPlayerFinished: (standings) => this.finishRace(standings),
    });
    this.audio.unlock();
    this.audio.startEngine();
    this.setScreen('race');
  }

  private pauseRace(): void {
    if (!this.raceStage || this.screen !== 'race') return;
    this.raceStage.paused = true;
    this.setScreen('paused');
    this.pause.update(this.profile.settings);
    this.pause.show();
    this.audio.updateEngine(0, 0, false, false);
  }

  private resumeRace(): void {
    if (!this.raceStage || this.screen !== 'paused') return;
    this.raceStage.paused = false;
    this.setScreen('race');
    this.lastFrame = performance.now();
  }

  private restartRace(): void {
    if (!this.raceStage) return;
    this.raceStage.restart();
    this.setScreen('race');
  }

  private raceAgain(): void {
    if (!this.raceStage) {
      this.startRace();
      return;
    }
    // Difficulty may have changed after a win; the restart picks up the new AI skill.
    this.raceStage.restart(difficultyMultiplier(this.profile.wins));
    this.audio.startEngine();
    this.setScreen('race');
  }

  private quitRace(): void {
    this.goGarage();
  }

  private finishRace(standings: Standing[]): void {
    const player = standings.find((s) => s.isPlayer);
    if (!player || !this.raceStage) return;
    // Score against the course actually raced, never whatever is selected now.
    const circuit = this.raceStage.sim.circuit;
    const tracker = this.raceStage.sim.style;
    const style: RunStyleStats = {
      score: tracker.score,
      bestMultiplier: tracker.bestMultiplier,
      perfectGates: tracker.perfectGates,
      nearMisses: tracker.nearMisses,
      rings: tracker.rings,
      ringTotal: circuit.rings.length,
      overtakes: tracker.overtakes,
    };
    const applied = applyRaceOutcome(this.profile, {
      circuitId: circuit.id,
      position: player.position,
      racerCount: standings.length,
      finishTime: player.finishTime,
      rawTime: player.rawTime,
      missedGates: player.missedGates,
      crashes: player.crashes,
      penaltySeconds: player.penaltySeconds,
      parTime: circuit.parTime,
      build: activeBuild(this.profile),
      style,
    });
    this.profile = applied.profile;
    this.persist();
    this.setScreen('results');
    this.results.update({
      standings,
      player,
      applied,
      credits: this.profile.credits,
      style,
      gateCount: circuit.gates.length,
    });
    this.results.show();
    if (applied.newBestTime || applied.badges.length > 0) this.audio.personalBest();
    this.audio.updateEngine(0.2, 0.2, false, false);
  }

  private disposeRace(): void {
    if (this.raceStage) {
      this.raceStage.dispose();
      this.raceStage = null;
      this.audio.stopEngine();
    }
    this.hud.hide();
  }

  // --- Test harness ----------------------------------------------------------------------

  private installTestHarness(): void {
    window.__skyrushTest = {
      getState: () => {
        const stage = this.raceStage;
        const player = stage?.player;
        return {
          screen: this.screen,
          selectedCircuit: this.profile.selectedCircuit,
          credits: this.profile.credits,
          build: { ...activeBuild(this.profile) },
          paint: { ...activeSetup(this.profile).paint },
          ownedParts: [...this.profile.ownedParts],
          race:
            stage && player
              ? {
                  circuitId: stage.sim.circuit.id,
                  phase: stage.sim.phase,
                  clock: stage.sim.clock,
                  nextGate: player.nextGate,
                  gatesPassed: player.gatesPassed,
                  position: player.position,
                  finished: player.finished,
                  speed: player.flight.speed,
                  altitude: player.flight.altitude,
                  boost: player.flight.boostEnergy,
                  heat: player.flight.heat,
                  paused: stage.paused,
                  x: player.flight.position.x,
                  y: player.flight.position.y,
                  z: player.flight.position.z,
                  style: stage.sim.style.snapshot(),
                }
              : null,
        };
      },
      getRenderInfo: () => ({
        geometries: this.renderer.gl.info.memory.geometries,
        textures: this.renderer.gl.info.memory.textures,
      }),
      setAutopilot: (enabled) => {
        if (this.raceStage) this.raceStage.autopilot = enabled;
      },
      setTimeScale: (scale) => {
        if (this.raceStage) this.raceStage.timeScale = Math.max(0.1, Math.min(20, scale));
      },
      approachRing: (index, distance = 120) => {
        if (this.raceStage && this.screen === 'race') this.raceStage.approachRing(index, distance);
      },
      simulateToFinish: () => {
        if (this.raceStage && this.screen === 'race') {
          this.raceStage.autopilot = true;
          this.raceStage.simulateToFinish();
        }
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.disposeRace();
    this.garageStage?.dispose();
    this.input.dispose();
    this.audio.dispose();
    this.renderer?.dispose();
  }
}

/** Parts the player bought on their own (not delivered with an aircraft they own). */
const boughtParts = (profile: PlayerProfile): string[] => {
  const delivered = new Set(
    AIRFRAMES.filter((airframe) => profile.ownedParts.includes(airframe.id)).flatMap((airframe) =>
      Object.values(airframe.defaults),
    ),
  );
  return profile.ownedParts.filter((id) => getItem(id)?.kind === 'part' && !delivered.has(id));
};

const PURCHASE_FAILURES: Record<PurchaseFailure, string> = {
  'unknown-part': 'That item is not in the catalogue',
  'already-owned': 'You already own that',
  locked: 'That is still locked',
  'insufficient-credits': 'Not enough credits',
};
