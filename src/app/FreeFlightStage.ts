import { Vector3, type WebGLRenderTarget } from 'three';
import type { Circuit } from '../course/circuit';
import { DEFAULT_EXPOSURE, type Renderer } from '../render/Renderer';
import { createWorld, type WorldHandles } from '../render/World';
import { AircraftView } from '../render/AircraftView';
import { ChaseCamera } from '../camera/ChaseCamera';
import { FixedStepClock } from '../core/time';
import { NEUTRAL_INPUT, type FlightInput } from '../flight/FlightModel';
import { resolveBuild, type AircraftSetup } from '../aircraft/build';
import { trailColor } from '../aircraft/paint';
import { createEnvironmentMap } from '../render/envMap';
import type { InputManager } from '../controls/InputManager';
import type { Hud, HudState } from '../ui/Hud';
import type { AudioEngine } from '../audio/AudioEngine';
import { CrashBurst } from '../render/Effects';
import { Contrails, EngineSmoke, RainStreaks, SpeedLines } from '../render/FlightEffects';
import { pulse, prefersReducedMotion } from '../ui/haptics';
import { formatCredits } from '../core/format';
import type { PlayerSettings } from '../progression/profile';
import { clamp, clamp01, smoothstep } from '../core/math';
import { WEATHER, gradeTheme } from '../activities/conditions';
import {
  FreeFlightSimulation,
  type FreeFlightActivity,
  type FreeFlightEvent,
  type FreeFlightResult,
} from '../activities/FreeFlightSimulation';
import { showFloor } from '../activities/places';
import { getDiscovery } from '../activities/catalog';
import { TRICK_NAMES } from '../activities/tricks';
import { terrainWarning } from '../style/StyleTracker';
import { DeliveryAutopilot, showPilot } from '../activities/autopilot';
import {
  createDeliveryStops,
  createDiscoveryProps,
  createShowBox,
  type DiscoveryProps,
  type StopProps,
} from '../render/activityProps';
import { windReadout } from './windReadout';

export interface FreeFlightStageOptions {
  activity: FreeFlightActivity;
  circuit: Circuit;
  renderer: Renderer;
  input: InputManager;
  hud: Hud;
  audio: AudioEngine;
  setup: AircraftSetup;
  settings: PlayerSettings;
  /** Discoveries already in the log. */
  discovered: ReadonlySet<string>;
  onFinished: (result: FreeFlightResult) => void;
}

const RESULTS_DELAY = 2.4;
const _projected = new Vector3();
const _target = new Vector3();

/**
 * Everything that exists while flying an air show, a delivery or free flight:
 * the world with the activity's props, the aircraft, the camera, the
 * simulation and the HUD bindings. The counterpart of RaceStage for flights
 * without gates.
 */
export class FreeFlightStage {
  readonly world: WorldHandles;
  readonly camera: ChaseCamera;
  sim!: FreeFlightSimulation;
  private readonly view: AircraftView;
  private readonly clock = new FixedStepClock(1 / 120, 10);
  private readonly burst: CrashBurst;
  private readonly speedLines: SpeedLines | null;
  private readonly contrails: Contrails;
  private readonly smoke: EngineSmoke;
  private readonly rain: RainStreaks | null;
  private readonly environment: WebGLRenderTarget;
  private readonly discoveryProps: DiscoveryProps;
  private readonly stopProps: StopProps | null = null;
  private readonly showBox: { dispose: () => void } | null = null;
  private readonly reducedMotion: boolean;
  private readonly playerInput: FlightInput = { ...NEUTRAL_INPUT };
  private readonly hudState: HudState;
  private readonly circuit: Circuit;
  private resultsTimer = -1;
  private finishedNotified = false;
  private time = 0;
  private deliveryPilot: DeliveryAutopilot | null = null;
  paused = false;
  /** Test harness hooks (only reachable through the e2e interface). */
  autopilot = false;
  timeScale = 1;

  constructor(private readonly options: FreeFlightStageOptions) {
    const { renderer, setup, activity } = options;
    this.circuit = options.circuit;
    const conditions = activity.conditions;
    const graded = { ...this.circuit, theme: gradeTheme(this.circuit.theme, conditions) };
    this.world = createWorld(graded, {
      shadows: renderer.options.shadows,
      quality: renderer.options.quality,
      gates: false,
    });
    this.camera = new ChaseCamera(renderer.aspect);
    this.burst = new CrashBurst(this.world.scene);
    this.reducedMotion = prefersReducedMotion();
    this.camera.motionScale = this.reducedMotion ? 0 : 1;
    this.speedLines = this.reducedMotion ? null : new SpeedLines(this.world.scene);
    // An air show trails display smoke in white; everything else leaves ordinary vapour.
    this.contrails = new Contrails(
      this.world.scene,
      activity.kind === 'show' ? 0xffffff : trailColor(setup.paint),
    );
    this.smoke = new EngineSmoke(this.world.scene);
    const weather = WEATHER[conditions.weather];
    this.rain =
      weather.rain > 0 && !this.reducedMotion ? new RainStreaks(this.world.scene, weather.rain) : null;
    options.audio.setRain(weather.rain);
    options.audio.setEngineSound(resolveBuild(setup.build).engine.sound);
    const { theme } = graded;
    this.environment = createEnvironmentMap(renderer.gl, {
      zenith: theme.sky.zenith,
      horizon: theme.sky.horizon,
      ground: theme.sky.ground,
      sun: theme.sun.direction,
      sunColor: theme.sun.color,
    });
    this.view = new AircraftView(setup, this.environment.texture);
    this.view.setGearDown(false);
    this.world.scene.add(this.view.root);
    this.hudState = {
      position: 1,
      racerCount: 1,
      speed: 0,
      time: 0,
      nextGate: 0,
      gateCount: 0,
      boost: 1,
      heat: 0,
      overheated: false,
      boosting: false,
      airbrake: false,
      stalled: false,
      gateDistance: 0,
      marker: null,
      penalties: 0,
      style: { score: 0, multiplier: 1, comboTime: 0, rings: 0, ringTotal: 0 },
    };
    this.createSimulation();
    this.discoveryProps = createDiscoveryProps(
      this.sim.discoveries.filter((d) => d.rings.length === 0 || !options.discovered.has(d.spec.id)),
    );
    this.world.scene.add(this.discoveryProps.group);
    if (activity.kind === 'show') {
      const box = createShowBox(activity, showFloor(this.circuit, activity));
      this.world.scene.add(box.group);
      this.showBox = box;
    }
    if (activity.kind === 'delivery') {
      this.stopProps = createDeliveryStops(this.sim.stops);
      this.world.scene.add(this.stopProps.group);
    }
    options.hud.setMode(activity.kind);
  }

  private createSimulation(): void {
    const { activity, settings } = this.options;
    this.sim = new FreeFlightSimulation(this.circuit, activity, this.options.setup.build, {
      // Air shows use aerobatic control: full loops and rolls, with the assistance
      // setting deciding how firmly the aircraft settles when the stick is centred.
      assist:
        activity.kind === 'show'
          ? { strength: Math.max(0.3, settings.assist), aerobatic: true }
          : { strength: settings.assist },
      conditions: activity.conditions,
      discovered: this.options.discovered,
    });
    this.deliveryPilot =
      activity.kind === 'delivery' ? new DeliveryAutopilot(activity.stops, activity.hookSpeedKmh) : null;
    this.resultsTimer = -1;
    this.finishedNotified = false;
    this.clock.reset();
    this.view.syncPose(this.sim.flight);
    this.view.setVisible(true);
    this.contrails.reset();
    this.smoke.reset();
    this.stopProps?.setNext(0);
    const { hud } = this.options;
    hud.resetStyle();
    hud.clearMessage();
    this.camera.snap(this.sim.flight, this.objectiveTarget() ?? undefined);
    if (this.sim.phase === 'countdown') hud.setCountdown('3');
    else hud.clearCountdown();
    hud.showMessage(this.options.activity.name.toUpperCase(), 'neutral', 2.4);
    this.options.input.reset();
  }

  restart(): void {
    this.createSimulation();
    this.paused = false;
  }

  updateSettings(settings: PlayerSettings): void {
    this.options.settings = settings;
    this.options.input.options = { invertPitch: settings.invertPitch, sensitivity: settings.sensitivity };
    const assist = this.sim.assist;
    assist.strength =
      this.options.activity.kind === 'show' ? Math.max(0.3, settings.assist) : settings.assist;
  }

  recenterCamera(): void {
    this.camera.snap(this.sim.flight, this.objectiveTarget() ?? undefined);
  }

  /** Ends a free flight now (from the pause menu) and reports it. */
  endFlight(): void {
    this.sim.endFlight();
    this.sim.drainEvents();
    if (!this.finishedNotified) {
      this.finishedNotified = true;
      this.options.onFinished(this.sim.result());
    }
  }

  /** Test harness: flies the activity to its end synchronously (scripted show, delivery autopilot). */
  simulateToFinish(maxSeconds = 400): void {
    const step = this.clock.step;
    let elapsed = 0;
    if (this.options.activity.kind === 'explore') {
      this.endFlight();
      return;
    }
    while (this.sim.phase !== 'finished' && elapsed < maxSeconds) {
      this.sampleInput(step, true);
      this.sim.step(step, this.playerInput);
      this.handleEvents();
      elapsed += step;
    }
    if (this.sim.phase === 'finished' && !this.finishedNotified) {
      this.finishedNotified = true;
      this.options.onFinished(this.sim.result());
    }
  }

  /** Test harness: puts the aircraft over the middle of the show box at a safe height. */
  placeInShowBox(): void {
    const activity = this.options.activity;
    if (activity.kind !== 'show') return;
    const flight = this.sim.flight;
    flight.position.set(activity.box.x, showFloor(this.circuit, activity) + 260, activity.box.z - 200);
    this.sim.previousPosition.copy(flight.position);
    this.camera.snap(flight);
  }

  update(frameDt: number): void {
    if (this.paused) {
      this.render(0);
      return;
    }
    const scaled = frameDt * this.timeScale;
    const steps = this.clock.advance(scaled);
    const step = this.clock.step;
    for (let i = 0; i < steps; i += 1) {
      this.sampleInput(step, this.autopilot);
      this.sim.step(step, this.playerInput);
      this.handleEvents();
    }
    if (this.sim.phase === 'finished' && !this.finishedNotified) {
      if (this.resultsTimer < 0) this.resultsTimer = RESULTS_DELAY;
      this.resultsTimer -= scaled;
      if (this.resultsTimer <= 0) {
        this.finishedNotified = true;
        this.options.onFinished(this.sim.result());
      }
    }
    this.render(frameDt);
  }

  private sampleInput(step: number, auto: boolean): void {
    if (auto && this.sim.phase === 'flying') {
      if (this.deliveryPilot) this.deliveryPilot.steer(this.sim, this.playerInput);
      else showPilot(this.sim.clock, this.playerInput);
      return;
    }
    const sampled = this.options.input.sample(step);
    Object.assign(this.playerInput, sampled);
  }

  private handleEvents(): void {
    for (const event of this.sim.drainEvents()) this.onEvent(event);
  }

  private onEvent(event: FreeFlightEvent): void {
    const { hud, audio, settings } = this.options;
    switch (event.type) {
      case 'countdown':
        hud.setCountdown(String(event.value));
        audio.countdownBeep(false);
        break;
      case 'go':
        hud.setCountdown('GO');
        audio.countdownBeep(true);
        window.setTimeout(() => hud.clearCountdown(), 900);
        if (this.options.activity.kind === 'show')
          hud.showMessage('AEROBATIC CONTROLS: hold back to loop, hold over to roll', 'neutral', 3.6);
        break;
      case 'crash':
        this.burst.trigger(this.sim.flight.position);
        this.view.setVisible(false);
        audio.crash();
        this.camera.impulse(0.8);
        pulse(settings.haptics, 60);
        hud.showMessage(this.sim.carrying ? 'CRASHED: the cargo took a beating' : 'CRASHED', 'bad', 2.5);
        break;
      case 'respawn':
        this.view.syncPose(this.sim.flight);
        this.view.setVisible(true);
        this.recenterCamera();
        this.contrails.reset();
        this.options.input.reset();
        break;
      case 'scrape':
        this.camera.impulse(0.35);
        pulse(settings.haptics, 25);
        if (this.sim.carrying)
          hud.showMessage(`SCRAPE: cargo ${Math.round(this.sim.condition)}%`, 'bad', 1.6);
        break;
      case 'splash':
        break;
      case 'overheat':
        this.smoke.burst(this.sim.flight.position, this.sim.flight.orientation, this.sim.flight.velocity);
        audio.overheat();
        audio.blowout();
        this.camera.impulse(0.45);
        hud.showMessage('ENGINE BLOWN: limp on until it cools', 'bad', 2.8);
        break;
      case 'out-of-bounds':
        hud.showMessage('OUT OF BOUNDS: turning you back', 'bad', 2.5);
        break;
      case 'box':
        if (!event.inside && this.sim.phase === 'flying')
          hud.showMessage('OUTSIDE THE SHOW BOX: figures here do not count', 'bad', 2.2);
        else if (event.inside) hud.clearMessage();
        break;
      case 'trick': {
        const award = event.award;
        audio.trick(award.multiplier, award.low);
        if (award.tierUp) audio.comboUp(award.multiplier);
        const tags = [award.low ? 'LOW' : null, award.repeat ? 'REPEAT' : null].filter(Boolean).join(' · ');
        const mult = award.multiplier > 1 ? `  ×${formatMultiplier(award.multiplier)}` : '';
        hud.showToast(
          `${award.name.toUpperCase()} +${formatCredits(award.points)}${mult}${tags ? `  ${tags}` : ''}`,
          award.tierUp ? 'tier' : 'skill',
          1.5,
        );
        pulse(settings.haptics, 14);
        break;
      }
      case 'outside-box':
        hud.showToast(`${TRICK_NAMES[event.kind].toUpperCase()}: OUTSIDE THE BOX`, 'break', 1.3);
        break;
      case 'chain-lost':
        audio.comboBreak();
        hud.showToast(`CHAIN LOST  ×${formatMultiplier(event.multiplier)}`, 'break', 1.1);
        break;
      case 'hook':
        audio.hook();
        pulse(settings.haptics, [20, 30, 20]);
        this.stopProps?.setNext(this.sim.nextStop);
        hud.showMessage(
          event.kind === 'pickup'
            ? `HOOKED at ${event.name.toUpperCase()}`
            : `DELIVERED to ${event.name.toUpperCase()}`,
          'good',
          2.4,
        );
        break;
      case 'hook-miss':
        audio.hookMiss();
        hud.showMessage(
          event.reason === 'fast'
            ? `TOO FAST: ${event.value} km/h. Hook under ${this.hookSpeed()} km/h`
            : `TOO HIGH: ${event.value} m. Hook under ${this.hookHeight()} m`,
          'bad',
          2.4,
        );
        break;
      case 'strain':
        hud.showToast(`CARGO ${event.condition}%: EASE THE BANK`, 'break', 0.9);
        break;
      case 'cargo-lost':
        audio.crash();
        hud.showMessage('CARGO LOST', 'bad', 3);
        break;
      case 'discovery': {
        const spec = getDiscovery(event.id);
        audio.discovery();
        pulse(settings.haptics, [15, 60, 15]);
        hud.showMessage(`DISCOVERED: ${spec?.name.toUpperCase() ?? 'SOMETHING'}`, 'good', 3.4);
        break;
      }
      case 'trail-ring':
        audio.ring(1 + event.collected * 0.5);
        this.discoveryProps.collectTrailRing(event.id, this.trailRingIndex(event.id));
        hud.showToast(`RING ${event.collected}/${event.total}`, 'ring', 1.2);
        break;
      case 'time-up':
        audio.finish();
        hud.showMessage('DISPLAY COMPLETE', 'good', 3);
        break;
      case 'complete':
        audio.finish();
        if (this.options.activity.kind === 'delivery') hud.showMessage('ALL DELIVERED', 'good', 3);
        break;
    }
  }

  private trailRingIndex(id: string): number {
    const progress = this.sim.trailProgress.get(id);
    return progress ? ([...progress].pop() ?? 0) : 0;
  }

  private hookSpeed(): number {
    const activity = this.options.activity;
    return activity.kind === 'delivery' ? activity.hookSpeedKmh : 0;
  }

  private hookHeight(): number {
    const activity = this.options.activity;
    return activity.kind === 'delivery' ? activity.hookHeight : 0;
  }

  /** Where the camera leans and the marker points: the next stop, the show box, or the nearest signal. */
  private objectiveTarget(): Vector3 | null {
    const activity = this.options.activity;
    if (activity.kind === 'delivery') {
      const stop = this.sim.currentStop;
      if (!stop) return null;
      return _target.copy(stop.position).setY(stop.position.y + 20);
    }
    if (activity.kind === 'show') {
      const floor = showFloor(this.circuit, activity);
      return _target.set(activity.box.x, floor + 120, activity.box.z);
    }
    const signal = this.sim.signal;
    if (signal && signal.distance < 300)
      return _target.copy(signal.discovery.position).setY(signal.discovery.position.y + 30);
    return null;
  }

  private render(frameDt: number): void {
    const { renderer, hud, audio, activity } = this.options;
    const sim = this.sim;
    const flight = sim.flight;
    this.time += frameDt;
    if (sim.respawnTimer <= 0) {
      this.view.syncPose(flight);
      this.view.animate(flight, sim.input, frameDt);
    }
    this.burst.update(frameDt);
    const target = this.objectiveTarget();
    if (frameDt > 0) {
      if (sim.respawnTimer <= 0) {
        this.smoke.trail(flight.position, flight.orientation, flight.velocity, flight.heat, frameDt);
        this.camera.update(flight, frameDt, target ?? undefined);
      }
      this.smoke.update(frameDt);
      const speedRatio = flight.speed / sim.params.maxSpeed;
      const flying = sim.phase !== 'countdown';
      const streaks = flying ? smoothstep(0.72, 1.02, speedRatio) * 0.75 + (flight.boosting ? 0.45 : 0) : 0;
      this.speedLines?.update(this.camera.camera, clamp01(streaks), flight.speed, frameDt);
      if (sim.respawnTimer <= 0) {
        let trail: number;
        if (activity.kind === 'show') {
          // Display smoke inside the box while the show runs.
          trail = flying && sim.inBox && sim.phase === 'flying' ? 0.85 : 0;
        } else {
          const fast = smoothstep(0.55, 0.95, speedRatio);
          const turning = Math.abs(Math.sin(flight.bank)) * smoothstep(0.35, 0.75, speedRatio);
          trail = flying ? clamp01(fast * 0.35 + turning * 0.75 + (flight.boosting ? 0.25 : 0)) : 0;
        }
        this.contrails.update(
          flight.position,
          flight.orientation,
          this.view.handles.wingtips,
          trail,
          this.camera.camera.position,
        );
      }
      this.rain?.update(this.camera.camera, flight.velocity, sim.windVector, frameDt);
    }
    this.discoveryProps.update(this.time, flight.position);
    this.stopProps?.update(this.time);
    this.camera.setAspect(renderer.aspect);
    this.world.update(frameDt, flight.position);
    this.updateHud(target);
    hud.update(this.hudState);
    audio.updateEngine(flight.throttle, clamp(flight.speed / 150, 0, 1), flight.boosting, flight.overheated);
    renderer.gl.toneMappingExposure = this.world.exposure;
    renderer.render(this.world.scene, this.camera.camera);
  }

  private updateHud(target: Vector3 | null): void {
    const sim = this.sim;
    const flight = sim.flight;
    const activity = this.options.activity;
    const state = this.hudState;
    state.speed = flight.speed;
    state.boost = flight.boostEnergy;
    state.heat = flight.heat;
    state.overheated = flight.overheated;
    state.boosting = flight.boosting;
    state.airbrake = flight.airbrake;
    state.stalled = flight.stalled && sim.phase === 'flying';
    state.time = activity.kind === 'show' ? sim.timeLeft : sim.clock;
    state.wind = windReadout(sim.windVector, this.camera.camera);
    state.note =
      terrainWarning(flight.altitude, flight.velocity.y) && sim.phase === 'flying' ? 'PULL UP' : null;
    state.extraMeter = null;
    state.marker = target ? this.projectMarker(target) : null;
    state.gateDistance = target ? Math.hypot(target.x - flight.position.x, target.z - flight.position.z) : 0;
    switch (activity.kind) {
      case 'show': {
        const tricks = sim.tricks!;
        state.style.score = tricks.score;
        state.style.multiplier = tricks.multiplier;
        state.style.comboTime = tricks.chainFraction;
        state.lead = {
          value: String(tricks.figures),
          detail: `Figures · ${tricks.variety} kinds`,
          tone: null,
        };
        state.objective = sim.inBox ? 'In the box' : 'Show box';
        const hold = tricks.holding;
        if (hold)
          state.note = `${hold.kind === 'inverted' ? 'INVERTED' : 'KNIFE EDGE'} ${hold.seconds.toFixed(1)} s`;
        if (sim.inBox) state.marker = null;
        break;
      }
      case 'delivery': {
        const stop = sim.currentStop;
        state.lead = {
          value: `${Math.round(sim.condition)}%`,
          detail: `Cargo · stop ${Math.min(sim.nextStop + 1, sim.stops.length)}/${sim.stops.length}`,
          tone: sim.condition < 50 ? 'bad' : null,
        };
        state.objective = stop
          ? `${stop.kind === 'pickup' ? 'Pick up' : 'Drop'} · ${stop.name}`
          : 'Delivered';
        if (sim.carrying)
          state.extraMeter = { label: 'Cargo', value: sim.condition / 100, warn: sim.condition < 50 };
        if (stop && state.gateDistance < 800 && !state.note)
          state.note = `HOOK BELOW ${this.hookHeight()} m AND ${this.hookSpeed()} km/h`;
        break;
      }
      case 'explore': {
        const found = sim.discoveries.filter((d) => sim.found.has(d.spec.id)).length;
        const signal = sim.signal;
        state.lead = { value: `${found}/${sim.discoveries.length}`, detail: 'Discoveries', tone: null };
        state.objective = signal ? 'Signal' : 'Free flight';
        state.gateDistance = signal ? signal.distance : 0;
        break;
      }
    }
  }

  private projectMarker(target: Vector3): HudState['marker'] {
    const { renderer } = this.options;
    _projected.copy(target).project(this.camera.camera);
    const behind = _projected.z > 1;
    const x = _projected.x;
    const y = -_projected.y;
    if (!behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.85) {
      return {
        x: ((x + 1) / 2) * renderer.width,
        y: ((y + 1) / 2) * renderer.height,
        onScreen: true,
        angle: 0,
      };
    }
    let dx = behind ? -x : x;
    let dy = behind ? -y : y;
    if (behind && Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) dy = 1;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    return {
      x: (0.5 + dx * 0.42) * renderer.width,
      y: (0.5 + dy * 0.38) * renderer.height,
      onScreen: false,
      angle: Math.atan2(dy, dx) + Math.PI / 2,
    };
  }

  dispose(): void {
    this.view.root.removeFromParent();
    this.view.dispose();
    this.discoveryProps.dispose();
    this.stopProps?.dispose();
    this.showBox?.dispose();
    this.burst.dispose();
    this.speedLines?.dispose();
    this.contrails.dispose();
    this.smoke.dispose();
    this.rain?.dispose();
    this.options.audio.setRain(0);
    this.world.dispose();
    this.environment.dispose();
    this.options.renderer.gl.toneMappingExposure = DEFAULT_EXPOSURE;
  }
}

const formatMultiplier = (multiplier: number): string =>
  Number.isInteger(multiplier) ? String(multiplier) : multiplier.toFixed(1);
