import { Quaternion, Vector3 } from 'three';
import { lookOrientation, type Circuit } from '../course/circuit';
import { DEFAULT_EXPOSURE, type Renderer } from '../render/Renderer';
import { createWorld, type WorldHandles } from '../render/World';
import { AircraftView } from '../render/AircraftView';
import { ChaseCamera } from '../camera/ChaseCamera';
import {
  RaceSimulation,
  type RaceEvent,
  type Racer,
  type RacerConfig,
  type Standing,
} from '../race/RaceSimulation';
import { FixedStepClock } from '../core/time';
import { NEUTRAL_INPUT, resetFlightState, type FlightInput } from '../flight/FlightModel';
import { resolveBuild, type AircraftSetup } from '../aircraft/build';
import { getTheme, trailColor } from '../aircraft/paint';
import { factoryPaint } from '../progression/profile';
import { createEnvironmentMap } from '../render/envMap';
import type { WebGLRenderTarget } from 'three';
import { AI_PERSONALITIES, computeAiInput, type AiPersonality } from '../ai/AiPilot';
import type { InputManager } from '../controls/InputManager';
import type { Hud, HudState } from '../ui/Hud';
import type { AudioEngine } from '../audio/AudioEngine';
import { CrashBurst } from '../render/Effects';
import { Contrails, EngineSmoke, SpeedLines } from '../render/FlightEffects';
import { pulse, prefersReducedMotion } from '../ui/haptics';
import { terrainWarning, type StyleAward } from '../style/StyleTracker';
import { formatCredits } from '../core/format';
import type { PlayerSettings } from '../progression/profile';
import { clamp, clamp01, smoothstep } from '../core/math';
import { CLEAR_CONDITIONS, WEATHER, gradeTheme, type Conditions } from '../activities/conditions';
import { GhostRecorder, sampleGhost, type GhostTrack } from '../activities/ghost';
import { testGateCrossing } from '../course/gates';
import { RainStreaks } from '../render/FlightEffects';
import { windReadout } from './windReadout';

export interface RaceStageOptions {
  circuit: Circuit;
  renderer: Renderer;
  input: InputManager;
  hud: Hud;
  audio: AudioEngine;
  setup: AircraftSetup;
  settings: PlayerSettings;
  aiSkill: number;
  /** Rival id for a one-on-one challenge race; otherwise the full field races. */
  challenge?: string;
  /** A rival's line shown over the countdown. */
  gridLine?: { callsign: string; text: string };
  /** `trial` and `precision` fly the course alone. Default `race`. */
  mode?: 'race' | 'trial' | 'precision';
  conditions?: Conditions;
  /** Time trials: the lap to chase. */
  ghost?: GhostTrack | null;
  /** Precision runs: the run fails if the last gate is not reached in time (s). */
  timeLimit?: number;
  onPlayerFinished: (standings: Standing[]) => void;
}

/** What a solo run (trial or precision) produced, for the results. */
export interface SoloRun {
  time: number;
  rawTime: number;
  failed: 'missed-gate' | 'crash' | 'time' | null;
  accuracy: number;
  gatesPassed: number;
  /** The lap as a ghost (trials that finished). */
  lap: GhostTrack | null;
}

const RESULTS_DELAY = 2.6;
const _projected = new Vector3();
const _toGate = new Vector3();

/**
 * Owns everything that exists only during a race: the world, the aircraft
 * views, the camera, the simulation and the HUD bindings.
 */
export class RaceStage {
  readonly world: WorldHandles;
  readonly camera: ChaseCamera;
  sim!: RaceSimulation;
  private readonly views = new Map<string, AircraftView>();
  private readonly clock = new FixedStepClock(1 / 120, 10);
  private readonly burst: CrashBurst;
  private readonly speedLines: SpeedLines | null;
  private readonly contrails: Contrails;
  private readonly smoke: EngineSmoke;
  private readonly reducedMotion: boolean;
  private readonly configs: RacerConfig[];
  private readonly missedGates = new Set<number>();
  private readonly playerInput: FlightInput = { ...NEUTRAL_INPUT };
  private resultsTimer = -1;
  private finishedNotified = false;
  private readonly hudState: HudState;
  private readonly autopilotPersonality: AiPersonality;
  private readonly environment: WebGLRenderTarget;
  private readonly mode: 'race' | 'trial' | 'precision';
  private readonly conditions: Conditions;
  private readonly ghostView: AircraftView | null = null;
  private readonly ghostPosition = new Vector3();
  private readonly ghostOrientation = new Quaternion();
  /** Race time at which the ghost crossed each gate (NaN where it missed). */
  private readonly ghostSplits: number[] = [];
  private readonly recorder = new GhostRecorder();
  private readonly rain: RainStreaks | null;
  private ghostDelta: number | null = null;
  paused = false;
  /** Test harness hooks (only reachable through the e2e interface). */
  autopilot = false;
  timeScale = 1;

  constructor(private readonly options: RaceStageOptions) {
    const { renderer, setup } = options;
    const build = setup.build;
    this.mode = options.mode ?? 'race';
    this.conditions = options.conditions ?? CLEAR_CONDITIONS;
    const circuit = { ...options.circuit, theme: gradeTheme(options.circuit.theme, this.conditions) };
    this.world = createWorld(circuit, {
      shadows: renderer.options.shadows,
      quality: renderer.options.quality,
      startLine: this.mode !== 'precision',
    });
    this.camera = new ChaseCamera(renderer.aspect);
    this.burst = new CrashBurst(this.world.scene);
    this.reducedMotion = prefersReducedMotion();
    this.camera.motionScale = this.reducedMotion ? 0 : 1;
    this.speedLines = this.reducedMotion ? null : new SpeedLines(this.world.scene);
    this.contrails = new Contrails(this.world.scene, trailColor(setup.paint));
    this.smoke = new EngineSmoke(this.world.scene);
    options.audio.setEngineSound(resolveBuild(build).engine.sound);
    const { theme } = circuit;
    this.environment = createEnvironmentMap(renderer.gl, {
      zenith: theme.sky.zenith,
      horizon: theme.sky.horizon,
      ground: theme.sky.ground,
      sun: theme.sun.direction,
      sunColor: theme.sun.color,
    });
    const solo = this.mode !== 'race';
    this.configs = [
      { id: 'player', name: 'You', callsign: 'YOU', isPlayer: true, build },
      ...AI_PERSONALITIES.filter((ai) => !solo && (!options.challenge || ai.id === options.challenge)).map(
        (ai) => ({
          id: ai.id,
          name: ai.name,
          callsign: ai.callsign,
          isPlayer: false,
          build: ai.build,
          ai,
        }),
      ),
    ];
    this.autopilotPersonality = { ...AI_PERSONALITIES[0]!, build, skill: 1 };
    this.hudState = {
      position: 1,
      racerCount: this.configs.length,
      speed: 0,
      time: 0,
      nextGate: 0,
      gateCount: circuit.gates.length,
      boost: 1,
      heat: 0,
      overheated: false,
      boosting: false,
      airbrake: false,
      stalled: false,
      gateDistance: 0,
      marker: null,
      penalties: 0,
      style: { score: 0, multiplier: 1, comboTime: 0, rings: 0, ringTotal: circuit.rings.length },
    };
    // Rivals fly as salvaged: their own colours on the cabin, donor paint on the rest.
    const aiPaints = new Map(
      AI_PERSONALITIES.map((ai) => [
        ai.id,
        { ...(getTheme(ai.livery)?.paint ?? factoryPaint(ai.build.airframe)), pattern: 'salvage' as const },
      ]),
    );
    for (const config of this.configs) {
      const view = new AircraftView(
        config.isPlayer
          ? setup
          : { build: config.build, paint: aiPaints.get(config.id) ?? factoryPaint(config.build.airframe) },
        this.environment.texture,
      );
      view.setGearDown(false);
      this.views.set(config.id, view);
      this.world.scene.add(view.root);
    }
    const ghost = options.ghost;
    if (this.mode === 'trial' && ghost) {
      this.ghostView = new AircraftView(ghost.setup ?? setup, this.environment.texture);
      this.ghostView.makeGhost();
      this.ghostView.setGearDown(false);
      this.ghostView.setVisible(false);
      this.world.scene.add(this.ghostView.root);
      this.ghostSplits = ghostGateTimes(ghost, options.circuit);
    }
    const weather = WEATHER[this.conditions.weather];
    this.rain =
      weather.rain > 0 && !this.reducedMotion ? new RainStreaks(this.world.scene, weather.rain) : null;
    options.audio.setRain(weather.rain);
    options.hud.setMode(this.mode);
    this.createSimulation();
  }

  /** The finished (or failed) solo run, for the results. */
  soloRun(): SoloRun {
    const player = this.sim.player;
    const finished = player.finished && player.failed === null;
    return {
      time: player.finishTime,
      rawTime: player.rawTime,
      failed: player.failed,
      accuracy: this.sim.playerAccuracy,
      gatesPassed: player.gatesPassed,
      lap:
        finished && this.mode === 'trial'
          ? this.recorder.finish(player.finishTime, 'Your best', this.options.setup)
          : null,
    };
  }

  private createSimulation(): void {
    this.sim = new RaceSimulation(this.options.circuit, this.configs, {
      assist: { strength: this.options.settings.assist },
      aiSkill: this.options.aiSkill,
      conditions: this.conditions.weather === 'clear' ? undefined : this.conditions,
      strict: this.mode === 'precision',
    });
    this.recorder.reset();
    this.ghostDelta = null;
    this.missedGates.clear();
    this.resultsTimer = -1;
    this.finishedNotified = false;
    this.clock.reset();
    for (const racer of this.sim.racers) {
      const view = this.views.get(racer.config.id);
      if (view) {
        view.syncPose(racer.flight);
        view.setVisible(true);
      }
    }
    this.world.setGateStates(0, this.missedGates);
    this.world.resetRings();
    this.contrails.reset();
    this.smoke.reset();
    this.options.hud.resetStyle();
    const next = this.options.circuit.gates[0]!.position;
    this.camera.snap(this.sim.player.flight, next);
    this.options.hud.clearMessage();
    const line = this.options.gridLine;
    if (line) this.options.hud.showMessage(`${line.callsign}: “${line.text}”`, 'neutral', 3.4);
    this.options.hud.setCountdown('3');
    this.options.input.reset();
  }

  restart(aiSkill?: number): void {
    if (aiSkill !== undefined) this.options.aiSkill = aiSkill;
    this.createSimulation();
    this.paused = false;
  }

  updateSettings(settings: PlayerSettings): void {
    this.options.settings = settings;
    this.sim.assist.strength = settings.assist;
    this.options.input.options = { invertPitch: settings.invertPitch, sensitivity: settings.sensitivity };
  }

  recenterCamera(): void {
    const gate =
      this.options.circuit.gates[Math.min(this.sim.player.nextGate, this.options.circuit.gates.length - 1)]!;
    this.camera.snap(this.sim.player.flight, gate.position);
  }

  get player(): Racer {
    return this.sim.player;
  }

  /** Advances the race by a real frame delta (seconds). */
  update(frameDt: number): void {
    if (this.paused) {
      this.render(0);
      return;
    }
    const scaled = frameDt * this.timeScale;
    const steps = this.clock.advance(scaled);
    const step = this.clock.step;
    for (let i = 0; i < steps; i += 1) {
      this.samplePlayerInput(step);
      this.sim.step(step, this.playerInput);
      this.afterStep();
      this.handleEvents();
    }
    if (this.sim.phase === 'finished' && !this.finishedNotified) {
      if (this.resultsTimer < 0) this.resultsTimer = RESULTS_DELAY;
      this.resultsTimer -= scaled;
      if (this.resultsTimer <= 0) {
        this.finishedNotified = true;
        this.options.onPlayerFinished(this.sim.projectFinalStandings());
      }
    }
    this.render(frameDt);
  }

  /** Test harness: places the player on a level approach to a bonus ring. */
  approachRing(index: number, distance: number): void {
    const ring = this.options.circuit.rings[index];
    if (!ring || this.sim.phase !== 'racing') return;
    const position = ring.position.clone().addScaledVector(ring.normal, -distance);
    const orientation = lookOrientation(position, ring.position, new Quaternion());
    const player = this.sim.player;
    resetFlightState(player.flight, position, orientation, 85);
    player.previousPosition.copy(position);
    this.sim.style.resetProximity();
    this.contrails.reset();
    this.camera.snap(player.flight, ring.position);
  }

  /** Test harness: runs the simulation synchronously until the player finishes. */
  simulateToFinish(maxSeconds = 400): void {
    const step = this.clock.step;
    let elapsed = 0;
    while (this.sim.phase !== 'finished' && elapsed < maxSeconds) {
      this.samplePlayerInput(step);
      this.sim.step(step, this.playerInput);
      this.afterStep();
      this.handleEvents();
      elapsed += step;
    }
    if (this.sim.phase === 'finished' && !this.finishedNotified) {
      this.finishedNotified = true;
      this.options.onPlayerFinished(this.sim.projectFinalStandings());
    }
  }

  /** Solo-run bookkeeping after each simulation step: the lap recording and the time limit. */
  private afterStep(): void {
    const player = this.sim.player;
    if (this.sim.phase === 'racing' && !player.finished) {
      if (this.mode === 'trial') this.recorder.record(this.sim.clock, player.flight);
      const limit = this.options.timeLimit;
      if (this.mode === 'precision' && limit !== undefined && this.sim.clock > limit)
        this.sim.failPlayer('time');
    }
  }

  private samplePlayerInput(step: number): void {
    const player = this.sim.player;
    if (this.autopilot && !player.finished) {
      computeAiInput(
        player.flight,
        player.params,
        this.options.circuit,
        player.nextGate,
        this.autopilotPersonality,
        this.playerInput,
        1,
      );
      return;
    }
    const sampled = this.options.input.sample(step);
    this.playerInput.pitch = sampled.pitch;
    this.playerInput.roll = sampled.roll;
    this.playerInput.yaw = sampled.yaw;
    this.playerInput.throttle = sampled.throttle;
    this.playerInput.boost = sampled.boost;
    this.playerInput.airbrake = sampled.airbrake;
  }

  private handleEvents(): void {
    const { hud, audio } = this.options;
    for (const event of this.sim.drainEvents()) {
      this.onEvent(event, hud, audio);
    }
  }

  private onEvent(event: RaceEvent, hud: Hud, audio: AudioEngine): void {
    switch (event.type) {
      case 'countdown':
        hud.setCountdown(String(event.value));
        audio.countdownBeep(false);
        break;
      case 'go':
        hud.setCountdown('GO');
        audio.countdownBeep(true);
        window.setTimeout(() => hud.clearCountdown(), 900);
        break;
      case 'style':
        this.onStyle(event.award, event.ring, event.gate);
        break;
      case 'combo-break':
        // Losing a one-move chain is not worth interrupting the player for.
        if (event.combo.chain >= 2) {
          audio.comboBreak();
          hud.showToast(`COMBO LOST  ×${formatMultiplierShort(event.combo.multiplier)}`, 'break', 1.1);
        }
        break;
      case 'gate':
        if (event.isPlayer) {
          audio.gatePass();
          this.world.setGateStates(this.sim.player.nextGate, this.missedGates);
          const split = this.ghostSplits[event.gate];
          if (split !== undefined && Number.isFinite(split)) {
            this.ghostDelta = this.sim.clock + this.sim.player.penaltySeconds - split;
          }
          if (event.gate === this.sim.gateCount - 1) hud.showMessage('FINISH', 'good', 3);
        }
        break;
      case 'missed':
        if (event.isPlayer) {
          audio.gateMissed();
          this.missedGates.add(event.gate);
          this.world.setGateStates(this.sim.player.nextGate, this.missedGates);
          hud.showMessage(
            this.mode === 'precision'
              ? `GATE ${event.gate + 1} MISSED: run over`
              : `GATE ${event.gate + 1} MISSED  +${event.penalty}s`,
            'bad',
            2.5,
          );
        }
        break;
      case 'wrong-way':
        if (event.isPlayer) hud.showMessage('WRONG WAY: turn around', 'bad', 2);
        break;
      case 'crash': {
        const racer = this.sim.racers.find((r) => r.config.id === event.racerId);
        if (racer) {
          this.burst.trigger(racer.flight.position);
          this.views.get(event.racerId)?.setVisible(false);
        }
        if (event.isPlayer) {
          audio.crash();
          this.camera.impulse(0.8);
          pulse(this.options.settings.haptics, 60);
          hud.showMessage(
            this.mode === 'precision' ? 'CRASHED: run over' : `CRASHED  +${event.penalty}s`,
            'bad',
            2.5,
          );
        }
        break;
      }
      case 'respawn': {
        const racer = this.sim.racers.find((r) => r.config.id === event.racerId);
        const view = this.views.get(event.racerId);
        if (racer && view) {
          view.syncPose(racer.flight);
          view.setVisible(true);
        }
        if (event.isPlayer) {
          this.recenterCamera();
          this.contrails.reset();
          this.options.input.reset();
        }
        break;
      }
      case 'out-of-bounds':
        if (event.isPlayer) hud.showMessage('OUT OF BOUNDS: returning to course', 'bad', 2.5);
        break;
      case 'overheat': {
        // A blowout: smoke for everyone to see, and a limp home for whoever pushed too hard.
        const racer = this.sim.racers.find((r) => r.config.id === event.racerId);
        if (racer) this.smoke.burst(racer.flight.position, racer.flight.orientation, racer.flight.velocity);
        if (event.isPlayer) {
          audio.overheat();
          audio.blowout();
          this.camera.impulse(0.45);
          pulse(this.options.settings.haptics, [30, 40, 30]);
          hud.showMessage('ENGINE BLOWN: limp on until it cools', 'bad', 2.8);
        }
        break;
      }
      case 'scrape':
        if (event.isPlayer) {
          this.camera.impulse(0.35);
          pulse(this.options.settings.haptics, 25);
        }
        break;
      case 'finish':
        if (event.isPlayer) audio.finish();
        break;
    }
  }

  private onStyle(award: StyleAward, ring: number | undefined, gate: number | undefined): void {
    const { hud, audio, settings } = this.options;
    const points = `+${formatCredits(award.points)}`;
    const tier = award.tierUp ? `  ×${formatMultiplierShort(award.multiplier)}` : '';
    const tone = award.tierUp ? 'tier' : 'skill';
    switch (award.kind) {
      case 'gate':
        // Ordinary gates already chime; the score ticking up is enough.
        return;
      case 'perfect-gate':
        audio.perfectGate(award.multiplier);
        if (gate !== undefined) this.world.flashGate(gate);
        hud.showToast(this.mode === 'precision' ? 'BULLSEYE' : `PERFECT GATE ${points}${tier}`, tone);
        pulse(settings.haptics, 12);
        break;
      case 'near-miss':
        audio.nearMiss(award.multiplier);
        this.camera.impulse(0.12);
        hud.showToast(`NEAR MISS ${points}${tier}`, tone);
        pulse(settings.haptics, 18);
        break;
      case 'ring':
        audio.ring(award.multiplier);
        if (ring !== undefined) this.world.collectRing(ring);
        hud.showToast(
          `RING ${this.sim.style.rings}/${this.options.circuit.rings.length} ${points} · BOOST${tier}`,
          award.tierUp ? 'tier' : 'ring',
        );
        pulse(settings.haptics, [12, 40, 12]);
        break;
      case 'overtake':
        audio.overtake(award.multiplier);
        hud.showToast(`OVERTAKE ${points}${tier}`, tone);
        break;
    }
    if (award.tierUp) audio.comboUp(award.multiplier);
  }

  private render(frameDt: number): void {
    const { renderer, hud, audio, circuit } = this.options;
    const player = this.sim.player;
    for (const racer of this.sim.racers) {
      const view = this.views.get(racer.config.id);
      if (!view) continue;
      if (racer.respawnTimer <= 0) {
        view.syncPose(racer.flight);
        view.animate(racer.flight, racer.input, frameDt);
      }
    }
    this.burst.update(frameDt);
    if (frameDt > 0) {
      for (const racer of this.sim.racers) {
        if (racer.respawnTimer > 0) continue;
        const flight = racer.flight;
        this.smoke.trail(flight.position, flight.orientation, flight.velocity, flight.heat, frameDt);
      }
      this.smoke.update(frameDt);
    }

    const nextIndex = Math.min(player.nextGate, circuit.gates.length - 1);
    const nextGate = circuit.gates[nextIndex]!;
    if (frameDt > 0 && player.respawnTimer <= 0)
      this.camera.update(player.flight, frameDt, nextGate.position);

    // Speed sensation: streaks near top speed and while boosting; trails in fast, hard turns.
    const flight = player.flight;
    const speedRatio = flight.speed / player.params.maxSpeed;
    const racing = this.sim.phase !== 'countdown';
    if (frameDt > 0) {
      const streaks = racing ? smoothstep(0.72, 1.02, speedRatio) * 0.75 + (flight.boosting ? 0.45 : 0) : 0;
      this.speedLines?.update(this.camera.camera, clamp01(streaks), flight.speed, frameDt);
      if (player.respawnTimer <= 0) {
        const fast = smoothstep(0.55, 0.95, speedRatio);
        const turning = Math.abs(Math.sin(flight.bank)) * smoothstep(0.35, 0.75, speedRatio);
        const trail = racing ? clamp01(fast * 0.35 + turning * 0.75 + (flight.boosting ? 0.25 : 0)) : 0;
        const view = this.views.get(player.config.id);
        if (view)
          this.contrails.update(
            flight.position,
            flight.orientation,
            view.handles.wingtips,
            trail,
            this.camera.camera.position,
          );
      }
    }
    if (this.ghostView) {
      const visible =
        this.sim.phase !== 'countdown' &&
        sampleGhost(this.options.ghost!, this.sim.clock, this.ghostPosition, this.ghostOrientation);
      this.ghostView.setVisible(visible);
      if (visible) {
        this.ghostView.root.position.copy(this.ghostPosition);
        this.ghostView.root.quaternion.copy(this.ghostOrientation);
      }
    }
    if (this.rain && frameDt > 0)
      this.rain.update(this.camera.camera, flight.velocity, this.sim.windVector, frameDt);
    this.camera.setAspect(renderer.aspect);
    this.world.update(frameDt, player.flight.position);

    // HUD
    const state = this.hudState;
    state.position = player.position;
    state.speed = player.flight.speed;
    state.time =
      this.sim.phase === 'countdown'
        ? 0
        : player.finished
          ? player.finishTime
          : this.sim.clock + player.penaltySeconds;
    state.nextGate = player.nextGate;
    state.boost = player.flight.boostEnergy;
    state.heat = player.flight.heat;
    state.overheated = player.flight.overheated;
    state.boosting = player.flight.boosting;
    state.airbrake = player.flight.airbrake;
    state.stalled = player.flight.stalled && this.sim.phase === 'racing';
    state.penalties = player.penaltySeconds;
    const style = this.sim.style;
    state.style.score = style.score;
    state.style.multiplier = style.multiplier;
    state.style.comboTime = style.comboFraction;
    state.style.rings = style.rings;
    _toGate.subVectors(nextGate.position, player.flight.position);
    state.gateDistance = _toGate.length();
    state.marker = player.finished ? null : this.projectMarker(nextGate.position);
    state.wind = this.sim.conditions ? windReadout(this.sim.windVector, this.camera.camera) : null;
    state.note =
      this.sim.phase === 'racing' && !player.finished && terrainWarning(flight.altitude, flight.velocity.y)
        ? 'PULL UP'
        : null;
    if (this.mode === 'trial') {
      const delta = this.ghostDelta;
      state.lead = this.options.ghost
        ? {
            value: delta === null ? '±0.00' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}`,
            detail: `vs ${this.options.ghost.label.toLowerCase()} · gate ${Math.min(player.nextGate + 1, state.gateCount)}/${state.gateCount}`,
            tone: delta === null ? null : delta > 0 ? 'bad' : 'good',
          }
        : {
            value: 'Solo',
            detail: `Gate ${Math.min(player.nextGate + 1, state.gateCount)}/${state.gateCount}`,
            tone: null,
          };
    } else if (this.mode === 'precision') {
      const limit = this.options.timeLimit ?? 0;
      const left = limit - this.sim.clock;
      state.lead = {
        value: player.gateOffsets.length > 0 ? `${Math.round(this.sim.playerAccuracy)}%` : '–',
        detail: `Accuracy · gate ${Math.min(player.nextGate + 1, state.gateCount)}/${state.gateCount}`,
        tone: null,
      };
      if (!state.note && this.sim.phase === 'racing' && left < 15 && left > 0)
        state.note = `${Math.ceil(left)} s LEFT`;
    }
    hud.update(state);

    audio.updateEngine(
      player.flight.throttle,
      clamp(player.flight.speed / 150, 0, 1),
      player.flight.boosting,
      player.flight.overheated,
    );

    renderer.gl.toneMappingExposure = this.world.exposure;
    renderer.render(this.world.scene, this.camera.camera);
  }

  private projectMarker(target: Vector3): HudState['marker'] {
    const { renderer } = this.options;
    _projected.copy(target).project(this.camera.camera);
    const behind = _projected.z > 1;
    const x = _projected.x;
    const y = -_projected.y;
    const onScreen = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.85;
    if (onScreen) {
      return {
        x: ((x + 1) / 2) * renderer.width,
        y: ((y + 1) / 2) * renderer.height,
        onScreen: true,
        angle: 0,
      };
    }
    // Off screen: clamp to an ellipse near the edge and point the arrow outward.
    let dx = behind ? -x : x;
    let dy = behind ? -y : y;
    if (behind && Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) dy = 1;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    const angle = Math.atan2(dy, dx) + Math.PI / 2;
    const px = (0.5 + dx * 0.42) * renderer.width;
    const py = (0.5 + dy * 0.38) * renderer.height;
    return { x: px, y: py, onScreen: false, angle };
  }

  dispose(): void {
    for (const view of this.views.values()) {
      view.root.removeFromParent();
      view.dispose();
    }
    this.views.clear();
    this.ghostView?.root.removeFromParent();
    this.ghostView?.dispose();
    this.rain?.dispose();
    this.options.audio.setRain(0);
    this.burst.dispose();
    this.speedLines?.dispose();
    this.contrails.dispose();
    this.smoke.dispose();
    this.world.dispose();
    this.environment.dispose();
    this.options.renderer.gl.toneMappingExposure = DEFAULT_EXPOSURE;
  }
}

const formatMultiplierShort = (multiplier: number): string =>
  Number.isInteger(multiplier) ? String(multiplier) : multiplier.toFixed(1);

/** When the ghost crossed each gate plane (NaN where it never did), for live splits. */
const ghostGateTimes = (ghost: GhostTrack, circuit: Circuit): number[] => {
  const times: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const qa = new Quaternion();
  let gate = 0;
  const samples = ghost.samples.length / 7;
  for (let i = 1; i < samples && gate < circuit.gates.length; i += 1) {
    sampleGhost(ghost, (i - 1) * 0.1 + 1e-6, a, qa);
    sampleGhost(ghost, i * 0.1 - 1e-6, b, qa);
    const crossing = testGateCrossing(circuit.gates[gate]!, a, b, 30);
    if (crossing === 'passed' || crossing === 'missed') {
      times[gate] = crossing === 'passed' ? i * 0.1 : Number.NaN;
      gate += 1;
    }
  }
  return times;
};
