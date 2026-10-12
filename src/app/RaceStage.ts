import { Quaternion, Vector3 } from 'three';
import { lookOrientation, type Circuit } from '../course/circuit';
import type { Renderer } from '../render/Renderer';
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
import { resolveBuild, type AircraftBuild } from '../aircraft/build';
import { AI_PERSONALITIES, computeAiInput, type AiPersonality } from '../ai/AiPilot';
import type { InputManager } from '../controls/InputManager';
import type { Hud, HudState } from '../ui/Hud';
import type { AudioEngine } from '../audio/AudioEngine';
import { CrashBurst } from '../render/Effects';
import { Contrails, SpeedLines } from '../render/FlightEffects';
import { pulse, prefersReducedMotion } from '../ui/haptics';
import type { StyleAward } from '../style/StyleTracker';
import { formatCredits } from '../core/format';
import type { PlayerSettings } from '../progression/profile';
import { clamp, clamp01, smoothstep } from '../core/math';

export interface RaceStageOptions {
  circuit: Circuit;
  renderer: Renderer;
  input: InputManager;
  hud: Hud;
  audio: AudioEngine;
  build: AircraftBuild;
  settings: PlayerSettings;
  aiSkill: number;
  onPlayerFinished: (standings: Standing[]) => void;
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
  private readonly reducedMotion: boolean;
  private readonly configs: RacerConfig[];
  private readonly missedGates = new Set<number>();
  private readonly playerInput: FlightInput = { ...NEUTRAL_INPUT };
  private resultsTimer = -1;
  private finishedNotified = false;
  private readonly hudState: HudState;
  private readonly autopilotPersonality: AiPersonality;
  paused = false;
  /** Test harness hooks (only reachable through the e2e interface). */
  autopilot = false;
  timeScale = 1;

  constructor(private readonly options: RaceStageOptions) {
    const { circuit, renderer, build } = options;
    this.world = createWorld(circuit, { shadows: renderer.options.shadows });
    this.camera = new ChaseCamera(renderer.aspect);
    this.burst = new CrashBurst(this.world.scene);
    this.reducedMotion = prefersReducedMotion();
    this.camera.motionScale = this.reducedMotion ? 0 : 1;
    this.speedLines = this.reducedMotion ? null : new SpeedLines(this.world.scene);
    const livery = resolveBuild(build).livery;
    this.contrails = new Contrails(this.world.scene, livery.trail ?? 0xf4f1ea);
    this.configs = [
      { id: 'player', name: 'You', callsign: 'YOU', isPlayer: true, build },
      ...AI_PERSONALITIES.map((ai) => ({
        id: ai.id,
        name: ai.name,
        callsign: ai.callsign,
        isPlayer: false,
        build: ai.build,
        ai,
      })),
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
    for (const config of this.configs) {
      const view = new AircraftView(resolveBuild(config.build));
      this.views.set(config.id, view);
      this.world.scene.add(view.root);
    }
    this.createSimulation();
  }

  private createSimulation(): void {
    this.sim = new RaceSimulation(this.options.circuit, this.configs, {
      assist: { strength: this.options.settings.assist },
      aiSkill: this.options.aiSkill,
    });
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
    this.options.hud.resetStyle();
    const next = this.options.circuit.gates[0]!.position;
    this.camera.snap(this.sim.player.flight, next);
    this.options.hud.clearMessage();
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
      this.handleEvents();
      elapsed += step;
    }
    if (this.sim.phase === 'finished' && !this.finishedNotified) {
      this.finishedNotified = true;
      this.options.onPlayerFinished(this.sim.projectFinalStandings());
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
          if (event.gate === this.sim.gateCount - 1) hud.showMessage('FINISH', 'good', 3);
        }
        break;
      case 'missed':
        if (event.isPlayer) {
          audio.gateMissed();
          this.missedGates.add(event.gate);
          this.world.setGateStates(this.sim.player.nextGate, this.missedGates);
          hud.showMessage(`GATE ${event.gate + 1} MISSED  +${event.penalty}s`, 'bad', 2.5);
        }
        break;
      case 'wrong-way':
        if (event.isPlayer) hud.showMessage('WRONG WAY — turn around', 'bad', 2);
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
          hud.showMessage(`CRASHED  +${event.penalty}s`, 'bad', 2.5);
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
        if (event.isPlayer) hud.showMessage('OUT OF BOUNDS — returning to course', 'bad', 2.5);
        break;
      case 'overheat':
        if (event.isPlayer) {
          audio.overheat();
          hud.showMessage('OVERHEATED — boost disabled', 'bad', 2.5);
        }
        break;
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
        hud.showToast(`PERFECT GATE ${points}${tier}`, tone);
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
    hud.update(state);

    audio.updateEngine(
      player.flight.throttle,
      clamp(player.flight.speed / 150, 0, 1),
      player.flight.boosting,
      player.flight.overheated,
    );

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
    this.burst.dispose();
    this.speedLines?.dispose();
    this.contrails.dispose();
    this.world.dispose();
  }
}

const formatMultiplierShort = (multiplier: number): string =>
  Number.isInteger(multiplier) ? String(multiplier) : multiplier.toFixed(1);
