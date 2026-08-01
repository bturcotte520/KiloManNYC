// Procedural Vegas-lounge background music engine using the Web Audio API.
// Synthesizes an electric piano (Rhodes), walking bass, vibraphone melody,
// and brushed hi-hat over a jazz chord progression in C major. Loops
// indefinitely with melodic variation so no two passes are identical.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Chord shape: root MIDI offset + intervals (semitones from root).
// Roots are relative to C3 = 48.
interface Chord {
  root: number;
  intervals: number[];
}

const CMAJ7: Chord = { root: 48, intervals: [0, 4, 7, 11] };
const AM7: Chord = { root: 45, intervals: [0, 4, 7, 11] };
const DM7: Chord = { root: 50, intervals: [0, 4, 7, 11] };
const G7: Chord = { root: 43, intervals: [0, 4, 7, 10] };
const EM7: Chord = { root: 52, intervals: [0, 4, 7, 11] };
const A7: Chord = { root: 45, intervals: [0, 4, 7, 10] };
const Dm7: Chord = { root: 50, intervals: [0, 3, 7, 10] };
const EHALF_DIM: Chord = { root: 52, intervals: [0, 3, 6, 10] };

// 16-bar AABA-ish lounge form. Each entry is one bar (4 beats).
const PROGRESSION: Chord[] = [
  CMAJ7, AM7, Dm7, G7,
  CMAJ7, AM7, Dm7, G7,
  EM7, A7, DM7, G7,
  CMAJ7, AM7, Dm7, G7,
];

// Scale tones for melody generation, per chord quality.
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const DOMINANT_SCALE = [0, 2, 4, 5, 7, 9, 10];
const MINOR_SCALE = [0, 2, 3, 5, 7, 9, 10];
const HALF_DIM_SCALE = [0, 2, 3, 5, 6, 9, 10];

function scaleForChord(chord: Chord): number[] {
  const third = chord.intervals[1];
  const seventh = chord.intervals[3];
  if (third === 3 && seventh === 10) return MINOR_SCALE;
  if (third === 3 && seventh === 6) return HALF_DIM_SCALE;
  if (seventh === 10) return DOMINANT_SCALE;
  return MAJOR_SCALE;
}

// Deterministic-ish PRNG so variations are musical, not random noise.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GameMusic {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private schedulerId: number | null = null;
  private nextNoteTime = 0;
  private currentBar = 0;
  private currentBeat = 0;
  private rng = mulberry32(42);
  private melodyRange = 0;
  private running = false;
  private mode: 'menu' | 'game' = 'game';
  private muted = false;
  private fadeTarget = 0;
  private fadeRaf: number | null = null;

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.fadeTarget = muted ? 0 : (this.mode === 'menu' ? 0.12 : 0.18);
      this.startFade();
    }
  }

  private readonly tempo = 108;
  private readonly secondsPerBeat = 60 / 108;
  private readonly lookahead = 0.1;
  private readonly scheduleAhead = 0.25;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0;

      // Simple feedback delay for a spacious lounge reverb feel.
      this.delayNode = this.ctx.createDelay(1.0);
      this.delayNode.delayTime.value = 0.28;
      this.delayFeedback = this.ctx.createGain();
      this.delayFeedback.gain.value = 0.2;
      const delayWet = this.ctx.createGain();
      delayWet.gain.value = 0.18;

      this.masterGain.connect(this.ctx.destination);
      this.masterGain.connect(this.delayNode);
      this.delayNode.connect(this.delayFeedback);
      this.delayFeedback.connect(this.delayNode);
      this.delayNode.connect(delayWet);
      delayWet.connect(this.ctx.destination);

      // Pre-render a noise buffer for hi-hat synthesis.
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 1, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    return this.ctx;
  }

  start(mode: 'menu' | 'game' = 'game') {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') void ctx.resume();
    if (this.running) {
      this.setMode(mode);
      return;
    }
    this.running = true;
    this.mode = mode;
    this.fadeTarget = this.muted ? 0 : (mode === 'menu' ? 0.12 : 0.18);
    this.startFade();
    this.nextNoteTime = ctx.currentTime + 0.06;
    this.currentBar = 0;
    this.currentBeat = 0;
    this.rng = mulberry32(Math.floor(Math.random() * 100000));
    this.scheduler();
  }

  private setMode(mode: 'menu' | 'game') {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.masterGain && this.ctx) {
      const target = this.muted ? 0 : (mode === 'menu' ? 0.12 : 0.18);
      this.fadeTarget = target;
      this.startFade();
    }
  }

  stop() {
    this.stopping = true;
    this.fadeTarget = 0;
    this.startFade();
  }

  private stopping = false;

  private startFade() {
    if (this.fadeRaf !== null) return;
    const tick = () => {
      if (!this.ctx || !this.masterGain) {
        this.fadeRaf = null;
        return;
      }
      const now = this.ctx.currentTime;
      const cur = this.masterGain.gain.value;
      const diff = this.fadeTarget - cur;
      if (Math.abs(diff) < 0.001) {
        this.masterGain.gain.setValueAtTime(this.fadeTarget, now);
        if (this.fadeTarget === 0 && this.stopping) {
          this.running = false;
          this.stopping = false;
          if (this.schedulerId !== null) {
            clearTimeout(this.schedulerId);
            this.schedulerId = null;
          }
        }
        this.fadeRaf = null;
        return;
      }
      this.masterGain.gain.setValueAtTime(cur + diff * 0.08, now);
      this.fadeRaf = requestAnimationFrame(tick);
    };
    this.fadeRaf = requestAnimationFrame(tick);
  }

  private scheduler = () => {
    if (!this.ctx || !this.running) return;

    // Browsers start the AudioContext suspended until a user gesture.
    // Don't schedule notes while suspended; when it resumes, jump ahead
    // so we don't try to play a huge backlog of notes all at once.
    if (this.ctx.state !== 'running') {
      this.schedulerId = window.setTimeout(this.scheduler, this.lookahead * 1000);
      return;
    }
    if (this.nextNoteTime < this.ctx.currentTime - 0.1) {
      this.nextNoteTime = this.ctx.currentTime + 0.05;
    }

    while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAhead) {
      this.scheduleBeat(this.currentBar, this.currentBeat, this.nextNoteTime);
      this.advanceBeat();
    }
    this.schedulerId = window.setTimeout(this.scheduler, this.lookahead * 1000);
  };

  private advanceBeat() {
    this.nextNoteTime += this.secondsPerBeat / 2; // 8th-note grid
    this.currentBeat += 1;
    if (this.currentBeat >= 8) {
      this.currentBeat = 0;
      this.currentBar = (this.currentBar + 1) % PROGRESSION.length;
      if (this.currentBar === 0) {
        this.melodyRange = (this.melodyRange + 1) % 4;
      }
    }
  }

  private scheduleBeat(bar: number, beat: number, time: number) {
    const chord = PROGRESSION[bar];
    const beatInBar = beat / 2; // 0..3 (quarter notes)
    const isSwingLate = beat % 2 === 1; // off-beat 8th — swing it

    // Hi-hat: brushed feel on every 8th, lighter on off-beats.
    this.playHiHat(time, isSwingLate ? 0.04 : 0.07);

    // Walking bass: one note per quarter note.
    if (beat % 2 === 0) {
      this.playWalkingBass(chord, bar, beatInBar, time);
    }

    // Comping: chord stabs on beats 2 and 4 (classic swing comping),
    // plus a light stab on the "and" of 4 for forward motion.
    if (beatInBar === 1 || beatInBar === 3) {
      this.playComping(chord, time, this.mode === 'menu' ? 0.035 : 0.06);
    }
    if (beat === 7) {
      this.playComping(chord, time + this.secondsPerBeat * 0.16, this.mode === 'menu' ? 0.025 : 0.04);
    }

    // Melody: sparse, using chord-scale tones, varied per 16-bar pass.
    this.playMelody(chord, bar, beat, time);
  }

  private playWalkingBass(chord: Chord, bar: number, beatInBar: number, time: number) {
    const scale = scaleForChord(chord);
    let note: number;

    if (beatInBar === 0) {
      // Downbeat: chord root, down an octave for bass register.
      note = chord.root - 12;
    } else if (beatInBar === 1) {
      // Beat 2: approach to the 5th or 3rd.
      note = chord.root - 12 + scale[2 % scale.length];
    } else if (beatInBar === 2) {
      // Beat 3: 5th or 7th.
      note = chord.root - 12 + chord.intervals[2 % chord.intervals.length];
    } else {
      // Beat 4: chromatic approach into the next bar's root.
      const nextChord = PROGRESSION[(bar + 1) % PROGRESSION.length];
      const nextRoot = nextChord.root - 12;
      note = this.rng() < 0.5 ? nextRoot - 1 : nextRoot + 1;
    }

    this.playBassNote(midiToFreq(note), time, this.secondsPerBeat * 0.9);
  }

  private playBassNote(freq: number, time: number, duration: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.value = freq;

    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 1;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.28, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  private playComping(chord: Chord, time: number, volume: number) {
    // Play 3-4 note voicing in mid register, Rhodes tone.
    const voicing = chord.intervals.slice(0, 4).map((iv, i) => {
      // Spread voicing up an octave for the top notes.
      return chord.root + iv + (i >= 2 ? 12 : 0);
    });
    voicing.forEach((n) => {
      this.playRhodesNote(midiToFreq(n + 12), time, this.secondsPerBeat * 1.5, volume);
    });
  }

  private playRhodesNote(freq: number, time: number, duration: number, volume: number) {
    const ctx = this.ctx!;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const gain2 = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.value = freq;

    // Bell-like overtone: sine at 2x freq, lower gain, short decay.
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;
    gain2.gain.setValueAtTime(0, time);
    gain2.gain.linearRampToValueAtTime(volume * 0.5, time + 0.005);
    gain2.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.01);
    gain.gain.setValueAtTime(volume, time + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc1.connect(gain);
    osc2.connect(gain2);
    gain.connect(this.masterGain!);
    gain2.connect(this.masterGain!);

    osc1.start(time);
    osc1.stop(time + duration + 0.05);
    osc2.start(time);
    osc2.stop(time + 0.35);
  }

  private playMelody(chord: Chord, bar: number, beat: number, time: number) {
    // Sparse melodic line: roughly 35% of 8th-note slots get a note in
    // game mode, even sparser in menu mode for a relaxed feel.
    const gate = this.mode === 'menu' ? 0.18 : 0.35;
    if (this.rng() > gate) return;

    const scale = scaleForChord(chord);
    const beatInBar = beat / 2;

    // Rest on beat 1 of phrase starts sometimes for breathing room.
    if (beatInBar === 0 && this.rng() < 0.4) return;

    // Pick a scale degree, biased toward chord tones (0, 2, 4 of scale).
    let degree: number;
    const r = this.rng();
    if (r < 0.5) degree = [0, 2, 4][Math.floor(this.rng() * 3)];
    else degree = Math.floor(this.rng() * scale.length);

    // Octave shift based on the current 16-bar pass for variation.
    const octaveShift = [0, 0, 12, 12][this.melodyRange] + 12;
    const note = chord.root + scale[degree % scale.length] + octaveShift;

    // Occasional chromatic approach note for jazz flavor.
    const finalNote = this.rng() < 0.15 ? note + 1 : note;

    const duration = this.rng() < 0.3
      ? this.secondsPerBeat * 2.5 // long note
      : this.secondsPerBeat * 0.8; // short note

    this.playVibraphoneNote(midiToFreq(finalNote), time, duration, 0.1);
  }

  private playVibraphoneNote(freq: number, time: number, duration: number, volume: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const vibrato = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = freq;

    // Slow vibrato via LFO.
    vibrato.frequency.value = 5.5;
    vibratoGain.gain.value = freq * 0.008;
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    // Send melody to delay for reverb.
    gain.connect(this.delayNode!);

    osc.start(time);
    vibrato.start(time);
    osc.stop(time + duration + 0.1);
    vibrato.stop(time + duration + 0.1);
  }

  private playHiHat(time: number, volume: number) {
    const ctx = this.ctx!;
    if (!this.noiseBuffer) return;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    source.buffer = this.noiseBuffer;

    // Softer brushed-hat tone: bandpassed noise, not a sharp highpass scratch.
    filter.type = 'bandpass';
    filter.frequency.value = 6500;
    filter.Q.value = 1.2;

    const duration = 0.08;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume * 0.35, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    source.start(time);
    source.stop(time + duration + 0.02);
  }

  dispose() {
    if (this.fadeRaf !== null) {
      cancelAnimationFrame(this.fadeRaf);
      this.fadeRaf = null;
    }
    if (this.schedulerId !== null) {
      clearTimeout(this.schedulerId);
      this.schedulerId = null;
    }
    this.running = false;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
