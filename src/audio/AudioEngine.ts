import { clamp01 } from '../core/math';

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
  private enabled = true;
  private engineRunning = false;

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
    const length = this.context.sampleRate * 2;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    return buffer;
  }

  startEngine(): void {
    if (!this.context || !this.master || this.engineRunning) return;
    const ctx = this.context;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 70;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 141;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.25;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(osc2Gain).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
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
      this.windNoise?.stop();
    } catch {
      // already stopped
    }
    this.engineOsc?.disconnect();
    this.engineOsc2?.disconnect();
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
    const base = 55 + throttle * 90 + speed * 60;
    this.engineOsc?.frequency.setTargetAtTime(base, t, 0.08);
    this.engineOsc2?.frequency.setTargetAtTime(base * 2.01, t, 0.08);
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

  uiClick(): void {
    this.tone(1200, 0.05, 'sine', 0.12);
  }

  dispose(): void {
    this.stopEngine();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
