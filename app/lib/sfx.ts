// Procedural gameplay sound effects using the Web Audio API.
// Entirely independent of the music engine — has its own AudioContext
// and gain node so the music MUTE button doesn't affect SFX.

export class GameSFX {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  // --- Public SFX triggers ---

  /** Short rising chirp for player jump. */
  jump() {
    const ctx = this.ensureContext();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(680, t + 0.08);

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  /** Punchy bass thump + high pop for monster stomp. */
  stomp() {
    const ctx = this.ensureContext();
    const t = ctx.currentTime;

    // Bass thump
    const bass = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bass.type = 'sine';
    bass.frequency.setValueAtTime(160, t);
    bass.frequency.exponentialRampToValueAtTime(50, t + 0.15);
    bassGain.gain.setValueAtTime(0.3, t);
    bassGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    bass.connect(bassGain);
    bassGain.connect(this.masterGain!);
    bass.start(t);
    bass.stop(t + 0.16);

    // High pop
    const pop = ctx.createOscillator();
    const popGain = ctx.createGain();
    pop.type = 'square';
    pop.frequency.setValueAtTime(800, t);
    pop.frequency.exponentialRampToValueAtTime(400, t + 0.06);
    popGain.gain.setValueAtTime(0.12, t);
    popGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    pop.connect(popGain);
    popGain.connect(this.masterGain!);
    pop.start(t);
    pop.stop(t + 0.09);
  }

  /** Bright ascending arpeggio for chip/coin collect. */
  collect() {
    const ctx = this.ensureContext();
    const t = ctx.currentTime;
    const notes = [660, 880, 1100]; // quick ascending triad
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t + i * 0.04;

      osc.type = 'sine';
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.15, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.1);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  }

  /** Descending buzz for death/hit. */
  death() {
    const ctx = this.ensureContext();
    const t = ctx.currentTime;

    // Descending sawtooth buzz
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.4);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.4);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  /** Dull thud for head bonk against platform bottom. */
  bonk() {
    const ctx = this.ensureContext();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.08);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  dispose() {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
