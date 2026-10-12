import { Vector3 } from 'three';
import type { Circuit } from '../course/circuit';
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
import { NEUTRAL_INPUT, type FlightInput } from '../flight/FlightModel';
import { resolveBuild, type AircraftBuild } from '../aircraft/build';
import { AI_PERSONALITIES, computeAiInput, type AiPersonality } from '../ai/AiPilot';
import type { InputManager } from '../controls/InputManager';
import type { Hud, HudState } from '../ui/Hud';
import type { AudioEngine } from '../audio/AudioEngine';
import { CrashBurst } from '../render/Effects';
import type { PlayerSettings } from '../progression/profile';
import { clamp } from '../core/math';

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
        break;
      case 'finish':
        if (event.isPlayer) audio.finish();
        break;
    }
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
    this.world.dispose();
  }
}
