import { Quaternion, Vector3 } from 'three';
import type { AircraftBuild, AircraftSetup } from '../aircraft/build';
import { isValidBuild } from '../aircraft/build';
import { isValidPaint, type Paint } from '../aircraft/paint';
import type { Circuit } from '../course/circuit';
import { RaceSimulation } from '../race/RaceSimulation';
import { AI_PERSONALITIES, computeAiInput } from '../ai/AiPilot';
import { NEUTRAL_INPUT, type FlightInput, type FlightState } from '../flight/FlightModel';
import type { StorageLike } from '../progression/save';

/**
 * Ghosts for time trials: a lap recorded as position and orientation samples at
 * a fixed interval, replayed by interpolation. Your best lap is kept per course
 * in its own storage key (compact text, a few tens of kB), separate from the
 * profile so a ghost can never corrupt progression.
 */

export const GHOST_INTERVAL = 0.1;
export const GHOST_KEY_PREFIX = 'skyrush.ghost.v1.';
/** Longest lap a ghost keeps (s); anything slower is not worth chasing. */
const MAX_GHOST_SECONDS = 400;

export interface GhostTrack {
  /** Lap time this ghost finished in (s, after penalties). */
  time: number;
  /** Who flew it, for the HUD and the results. */
  label: string;
  setup: AircraftSetup | null;
  /** x, y, z, qx, qy, qz, qw per sample, one sample every GHOST_INTERVAL seconds from GO. */
  samples: number[];
}

export class GhostRecorder {
  private readonly samples: number[] = [];
  private next = 0;

  /** Records the aircraft whenever the race clock passes the next sample time. */
  record(clock: number, flight: FlightState): void {
    if (clock > MAX_GHOST_SECONDS) return;
    while (clock >= this.next * GHOST_INTERVAL - 1e-6) {
      const { position: p, orientation: q } = flight;
      this.samples.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w);
      this.next += 1;
    }
  }

  finish(time: number, label: string, setup: AircraftSetup | null): GhostTrack {
    return { time, label, setup, samples: [...this.samples] };
  }

  reset(): void {
    this.samples.length = 0;
    this.next = 0;
  }
}

const _qa = new Quaternion();
const _qb = new Quaternion();

/** Ghost pose at a race time. Returns false before the start and after the ghost's lap ends. */
export const sampleGhost = (
  track: GhostTrack,
  time: number,
  position: Vector3,
  orientation: Quaternion,
): boolean => {
  const count = track.samples.length / 7;
  if (count < 2 || time < 0) return false;
  const f = time / GHOST_INTERVAL;
  const i = Math.floor(f);
  if (i >= count - 1) return false;
  const t = f - i;
  const s = track.samples;
  const a = i * 7;
  const b = a + 7;
  position.set(
    s[a]! + (s[b]! - s[a]!) * t,
    s[a + 1]! + (s[b + 1]! - s[a + 1]!) * t,
    s[a + 2]! + (s[b + 2]! - s[a + 2]!) * t,
  );
  _qa.set(s[a + 3]!, s[a + 4]!, s[a + 5]!, s[a + 6]!);
  _qb.set(s[b + 3]!, s[b + 4]!, s[b + 5]!, s[b + 6]!);
  orientation.slerpQuaternions(_qa, _qb, t);
  return true;
};

// --- Compact text encoding -----------------------------------------------------------------------

/** Positions in decimetres and quaternions in thousandths, delta-encoded so most numbers are short. */
export const encodeGhost = (track: GhostTrack): string => {
  const ints: number[] = [];
  const previous = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < track.samples.length; i += 7) {
    for (let k = 0; k < 7; k += 1) {
      const value = Math.round(track.samples[i + k]! * (k < 3 ? 10 : 1000));
      ints.push(value - previous[k]!);
      previous[k] = value;
    }
  }
  return JSON.stringify({
    v: 1,
    time: track.time,
    label: track.label,
    setup: track.setup,
    d: ints.join(','),
  });
};

export const decodeGhost = (text: string): GhostTrack | null => {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    if (data.v !== 1 || typeof data.d !== 'string' || typeof data.time !== 'number' || !(data.time > 0))
      return null;
    const ints = data.d.split(',').map(Number);
    if (ints.length % 7 !== 0 || ints.some((n) => !Number.isFinite(n))) return null;
    const samples: number[] = [];
    const running = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < ints.length; i += 7) {
      for (let k = 0; k < 7; k += 1) {
        running[k] = running[k]! + ints[i + k]!;
        samples.push(running[k]! / (k < 3 ? 10 : 1000));
      }
    }
    const setupRaw = data.setup as { build?: unknown; paint?: unknown } | null;
    const setup =
      setupRaw && isValidBuild(setupRaw.build as AircraftBuild) && isValidPaint(setupRaw.paint as Paint)
        ? { build: setupRaw.build as AircraftBuild, paint: setupRaw.paint as Paint }
        : null;
    return {
      time: data.time,
      label: typeof data.label === 'string' ? data.label.slice(0, 40) : 'Ghost',
      setup,
      samples,
    };
  } catch {
    return null;
  }
};

export const loadGhost = (storage: StorageLike, courseId: string): GhostTrack | null => {
  try {
    const text = storage.getItem(GHOST_KEY_PREFIX + courseId);
    return text ? decodeGhost(text) : null;
  } catch {
    return null;
  }
};

export const saveGhost = (storage: StorageLike, courseId: string, track: GhostTrack): boolean => {
  try {
    storage.setItem(GHOST_KEY_PREFIX + courseId, encodeGhost(track));
    return true;
  } catch {
    return false;
  }
};

// --- The club ghost --------------------------------------------------------------------------------

/**
 * The pace to beat before you have a time of your own: ORBIT, the steadiest AI
 * pilot, flying the course alone in the given build. Deterministic, so the club
 * ghost is the same lap every time.
 */
export const recordClubGhost = (circuit: Circuit, build: AircraftBuild, skill = 0.94): GhostTrack => {
  const personality = { ...AI_PERSONALITIES[0]!, build, skill };
  const sim = new RaceSimulation(
    circuit,
    [{ id: 'player', name: 'Club', callsign: 'CLUB', isPlayer: true, build }],
    { countdownSeconds: 0, assist: { strength: 0.6 } },
  );
  sim.phase = 'racing';
  const recorder = new GhostRecorder();
  const input: FlightInput = { ...NEUTRAL_INPUT };
  const dt = 1 / 120;
  const player = sim.player;
  recorder.record(0, player.flight);
  while (!player.finished && sim.clock < MAX_GHOST_SECONDS) {
    computeAiInput(player.flight, player.params, circuit, player.nextGate, personality, input, 1);
    sim.step(dt, input);
    sim.drainEvents();
    recorder.record(sim.clock, player.flight);
  }
  return recorder.finish(player.finished ? player.finishTime : MAX_GHOST_SECONDS, 'Club pace', null);
};
