import { clamp01 } from '../core/math';
import type { EngineSound } from '../aircraft/parts';

const DEFAULT_SOUND: EngineSound = {
  base: 58,
  range: 95,
  wave: 'sawtooth',
  ratio: 2.01,
  wave2: 'square',
  lumpRate: 0,
  lumpDepth: 0,
};

/**
 * Procedural WebAudio sound: no external files, nothing licensed, and the game
 * runs silently if the AudioContext is unavailable or blocked.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private windNoise: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private boostGain: GainNode | null = null;
  private lumpOsc: OscillatorNode | null = null;
  private lumpNode: GainNode | null = null;
  private sound: EngineSound = DEFAULT_SOUND;
  private enabled = true;
  private engineRunning = false;
  private noise: AudioBuffer | null = null;

  get available(): boolean {
    return this.context !== null;
  }

  /** Must be called from a user gesture (click/touch) on iOS Safari. */
  unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
      return;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = this.enabled ? 0.6 : 0;
      this.master.connect(this.context.destination);
      if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
    } catch {
      this.context = null;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(enabled ? 0.6 : 0, this.context.currentTime, 0.05);
    }
  }

  private noiseBuffer(): AudioBuffer | null {
    if (!this.context) return null;
    if (this.noise) return this.noise;
    const length = this.context.sampleRate * 2;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    this.noise = buffer;
    return buffer;
  }

  /** Sets the character of the engine note (each engine part has its own); applies on the next start. */
  setEngineSound(sound: EngineSound): void {
    this.sound = sound;
  }

  startEngine(): void {
    if (!this.context || !this.master || this.engineRunning) return;
    const sound = this.sound;
    const ctx = this.context;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = sound.wave;
    this.engineOsc.frequency.value = sound.base;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = sound.wave2;
    this.engineOsc2.frequency.value = sound.base * sound.ratio;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.25;
    // Amplitude lope: radials and the pulse drive thump, twins beat, inlines stay smooth.
    this.lumpNode = ctx.createGain();
    this.lumpNode.gain.value = 1 - sound.lumpDepth * 0.5;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(osc2Gain).connect(this.engineFilter);
    this.engineFilter.connect(this.lumpNode).connect(this.engineGain).connect(this.master);
    if (sound.lumpRate > 0 && sound.lumpDepth > 0) {
      this.lumpOsc = ctx.createOscillator();
      this.lumpOsc.type = 'sine';
      this.lumpOsc.frequency.value = sound.lumpRate;
      const depth = ctx.createGain();
      depth.gain.value = sound.lumpDepth * 0.5;
      this.lumpOsc.connect(depth).connect(this.lumpNode.gain);
      this.lumpOsc.start();
    }
    this.engineOsc.start();
    this.engineOsc2.start();

    const buffer = this.noiseBuffer();
    if (buffer) {
      this.windNoise = ctx.createBufferSource();
      this.windNoise.buffer = buffer;
      this.windNoise.loop = true;
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 900;
      this.windFilter.Q.value = 0.6;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      this.windNoise.connect(this.windFilter).connect(this.windGain).connect(this.master);
      this.windNoise.start();

      const boostSource = ctx.createBufferSource();
      boostSource.buffer = buffer;
      boostSource.loop = true;
      const boostFilter = ctx.createBiquadFilter();
      boostFilter.type = 'highpass';
      boostFilter.frequency.value = 1800;
      this.boostGain = ctx.createGain();
      this.boostGain.gain.value = 0;
      boostSource.connect(boostFilter).connect(this.boostGain).connect(this.master);
      boostSource.start();
    }
    this.engineRunning = true;
  }

  stopEngine(): void {
    if (!this.engineRunning) return;
    try {
      this.engineOsc?.stop();
      this.engineOsc2?.stop();
      this.lumpOsc?.stop();
      this.windNoise?.stop();
    } catch {
      // already stopped
    }
    this.engineOsc?.disconnect();
    this.engineOsc2?.disconnect();
    this.lumpOsc?.disconnect();
    this.lumpNode?.disconnect();
    this.lumpOsc = null;
    this.lumpNode = null;
    this.engineGain?.disconnect();
    this.windGain?.disconnect();
    this.boostGain?.disconnect();
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.windGain = null;
    this.boostGain = null;
    this.engineRunning = false;
  }

  /** Called every frame with normalised throttle, speed (0..1) and boost state. */
  updateEngine(throttle: number, speed: number, boosting: boolean, overheated: boolean): void {
    if (!this.context || !this.engineRunning) return;
    const t = this.context.currentTime;
    const sound = this.sound;
    const base = sound.base + throttle * sound.range + speed * sound.range * 0.65;
    this.engineOsc?.frequency.setTargetAtTime(base, t, 0.08);
    this.engineOsc2?.frequency.setTargetAtTime(base * sound.ratio, t, 0.08);
    // The lope quickens with the revs.
    this.lumpOsc?.frequency.setTargetAtTime(sound.lumpRate * (0.6 + throttle * 0.8), t, 0.2);
    this.engineFilter?.frequency.setTargetAtTime(400 + throttle * 1400 + (boosting ? 1200 : 0), t, 0.1);
    this.engineGain?.gain.setTargetAtTime((0.12 + throttle * 0.2) * (overheated ? 0.7 : 1), t, 0.1);
    this.windGain?.gain.setTargetAtTime(clamp01(speed) * 0.35, t, 0.15);
    this.windFilter?.frequency.setTargetAtTime(600 + speed * 1800, t, 0.15);
    this.boostGain?.gain.setTargetAtTime(boosting ? 0.3 : 0, t, 0.08);
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number, when = 0): void {
    if (!this.context || !this.master) return;
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    const start = ctx.currentTime + when;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  countdownBeep(final: boolean): void {
    this.tone(final ? 880 : 440, final ? 0.5 : 0.18, 'square', 0.25);
  }

  gatePass(): void {
    this.tone(1046, 0.12, 'triangle', 0.3);
    this.tone(1568, 0.16, 'triangle', 0.22, 0.06);
  }

  gateMissed(): void {
    this.tone(220, 0.25, 'sawtooth', 0.25);
    this.tone(160, 0.3, 'sawtooth', 0.2, 0.12);
  }

  crash(): void {
    if (!this.context || !this.master) return;
    const buffer = this.noiseBuffer();
    if (!buffer) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const gain = this.context.createGain();
    const t = this.context.currentTime;
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t);
    source.stop(t + 0.9);
  }

  overheat(): void {
    this.tone(300, 0.4, 'square', 0.18);
    this.tone(300, 0.4, 'square', 0.18, 0.5);
  }

  finish(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((note, index) => this.tone(note, 0.35, 'triangle', 0.3, index * 0.12));
  }

  /** Filtered noise sweep: the "whoosh" of air rushing past something close. */
  private whoosh(from: number, to: number, duration: number, volume: number, when = 0): void {
    if (!this.context || !this.master) return;
    const buffer = this.noiseBuffer();
    if (!buffer) return;
    const ctx = this.context;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    const start = ctx.currentTime + when;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + duration * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(start, Math.random() * 1.5);
    source.stop(start + duration + 0.05);
  }

  /** Semitone offset for the current combo tier, so rewards climb in pitch as the multiplier grows. */
  private static tierPitch(multiplier: number): number {
    return 2 ** (((Math.min(4, Math.max(1, multiplier)) - 1) * 2) / 12);
  }

  /** Dead-centre gate: the gate chime plus a bright overtone. */
  perfectGate(multiplier: number): void {
    const p = AudioEngine.tierPitch(multiplier);
    this.tone(1318 * p, 0.12, 'triangle', 0.26);
    this.tone(1976 * p, 0.22, 'sine', 0.2, 0.05);
    this.tone(2637 * p, 0.18, 'sine', 0.08, 0.1);
  }

  nearMiss(multiplier: number): void {
    this.whoosh(2400, 500, 0.45, 0.32);
    this.tone(660 * AudioEngine.tierPitch(multiplier), 0.14, 'triangle', 0.14, 0.12);
  }

  ring(multiplier: number): void {
    const p = AudioEngine.tierPitch(multiplier);
    [784, 988, 1175, 1568].forEach((note, index) =>
      this.tone(note * p, 0.16, 'triangle', 0.2, index * 0.045),
    );
  }

  overtake(multiplier: number): void {
    const p = AudioEngine.tierPitch(multiplier);
    this.tone(523 * p, 0.1, 'square', 0.1);
    this.tone(784 * p, 0.16, 'square', 0.1, 0.07);
  }

  /** Multiplier tier up: short rising blip. */
  comboUp(multiplier: number): void {
    const p = AudioEngine.tierPitch(multiplier);
    this.tone(880 * p, 0.08, 'sine', 0.16, 0.12);
    this.tone(1320 * p, 0.14, 'sine', 0.14, 0.18);
  }

  /** Combo lost: soft and low so it informs without nagging. */
  comboBreak(): void {
    this.tone(392, 0.16, 'triangle', 0.14);
    this.tone(294, 0.24, 'triangle', 0.12, 0.1);
  }

  /** Personal best on the results screen. */
  personalBest(): void {
    [659, 784, 988, 1319].forEach((note, index) => this.tone(note, 0.3, 'triangle', 0.22, index * 0.09));
    this.tone(1976, 0.5, 'sine', 0.1, 0.36);
  }

  uiClick(): void {
    this.tone(1200, 0.05, 'sine', 0.12);
  }

  dispose(): void {
    this.stopEngine();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
