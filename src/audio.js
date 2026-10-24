// Original score: a slow four-chord nocturne, glassy notes and a continuous rain bed.
// AudioContext is created only by unlock(), called from a real user gesture.
const CHORDS = [
  [50, 57, 60, 64],
  [46, 53, 57, 60],
  [48, 55, 58, 62],
  [43, 50, 53, 57],
];
const hz = (note) => 440 * 2 ** ((note - 69) / 12);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class RainAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.disposed = false;
    this.voices = new Set();
    this.persistent = [];
    this.nextNote = 0;
    this.step = 0;
    this.paramClock = 0;
    this.mode = 'menu';
    this.pan = 0;
    this.cueUntil = 0;
    this.comboLevel = 0;
  }

  async unlock() {
    if (this.disposed) return false;
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return false;
    if (!this.ctx) {
      this.ctx = new Context();
      this._setup();
    }
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return this.ctx.state === 'running';
    } catch {
      // A denied autoplay gesture leaves the game playable; the next click can retry.
      return false;
    }
  }

  _setup() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.68;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -16;
    limiter.knee.value = 15;
    limiter.ratio.value = 3;
    limiter.attack.value = 0.008;
    limiter.release.value = 0.25;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);

    this.music = ctx.createGain();
    this.music.gain.value = 0.52;
    this.music.connect(this.master);
    this.effects = ctx.createGain();
    this.effects.gain.value = 0.9;
    this.effects.connect(this.master);

    // A small shared echo makes the glass notes feel suspended in the street.
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.402;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.24;
    const echoFilter = ctx.createBiquadFilter();
    echoFilter.type = 'lowpass';
    echoFilter.frequency.value = 1900;
    const echoReturn = ctx.createGain();
    echoReturn.gain.value = 0.38;
    this.echo.connect(echoFilter);
    echoFilter.connect(feedback);
    feedback.connect(this.echo);
    echoFilter.connect(echoReturn);
    echoReturn.connect(this.master);

    this.noise = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = this.noise.getChannelData(channel);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.13;
      }
    }
    const rainSource = ctx.createBufferSource();
    rainSource.buffer = this.noise;
    rainSource.loop = true;
    const rainHigh = ctx.createBiquadFilter();
    rainHigh.type = 'highpass';
    rainHigh.frequency.value = 850;
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = 'lowpass';
    this.rainFilter.frequency.value = 6500;
    this.rain = ctx.createGain();
    this.rain.gain.value = 0.08;
    rainSource.connect(rainHigh);
    rainHigh.connect(this.rainFilter);
    this.rainFilter.connect(this.rain);
    this.rain.connect(this.master);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 280;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0.022;
    rainSource.connect(this.windFilter);
    this.windFilter.connect(this.wind);
    this.wind.connect(this.master);
    rainSource.start();

    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 850;
    padFilter.Q.value = 0.45;
    padFilter.connect(this.music);
    this.pads = CHORDS[0].map((note, index) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = index === 3 ? 'triangle' : 'sine';
      oscillator.frequency.value = hz(note);
      oscillator.detune.value = [-3, 2, -1, 4][index];
      const gain = ctx.createGain();
      gain.gain.value = index === 0 ? 0.04 : 0.024;
      oscillator.connect(gain);
      gain.connect(padFilter);
      oscillator.start();
      this.persistent.push(oscillator, gain);
      return oscillator;
    });
    this.persistent.push(
      this.master, limiter, this.music, this.effects, this.echo, feedback,
      echoFilter, echoReturn, rainSource, rainHigh, this.rainFilter,
      this.rain, this.windFilter, this.wind, padFilter,
    );
    this.nextNote = ctx.currentTime + 0.08;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) this._stopCombo();
    if (!this.ctx || this.disposed) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.68, this.ctx.currentTime, 0.07);
  }

  update(state, dt) {
    if (this.mode !== state.mode) this.paramClock = 0;
    this.mode = state.mode;
    this.pan = clamp((state.x || 0) / 10, -0.7, 0.7);
    const comboLevel = state.mode === 'playing' && !this.muted ? state.combo >= 6 ? 2 : state.combo >= 3 ? 1 : 0 : 0;
    if (!comboLevel && this.comboLevel) this._stopCombo();
    this.comboLevel = comboLevel;
    if (!this.ctx || this.ctx.state !== 'running' || this.disposed) return;
    const now = this.ctx.currentTime;
    this.paramClock -= dt;
    if (this.paramClock <= 0) {
      this.paramClock = 0.1;
      const playing = state.mode === 'playing';
      const intro = state.mode === 'intro';
      const paused = state.mode === 'paused';
      const terminal = state.mode === 'impact' || state.mode === 'caught';
      const intensity = Number.isFinite(state.fallIntensity)
        ? state.fallIntensity
        : (state.fallSpeed || state.speed || 11) / 24;
      const introFlight = intro ? clamp(((state.introTime || 0) - 1.7) / 1.5, 0, 1) : 0;
      const motion = playing ? clamp(intensity, 0, 1) : introFlight * 0.3;
      const landing = playing ? clamp(((state.progress || 0) - 0.78) / 0.22, 0, 1) : 0;
      const focused = playing && state.slow;
      const cue = now < this.cueUntil;
      const windVolume = (intro ? 0.012 : 0.018) + motion * 0.048 + landing * 0.022 + Math.abs(state.wind || 0) * 0.002;
      this.rain.gain.setTargetAtTime(paused ? 0.018 : terminal ? 0.028 : (intro ? 0.062 : 0.075) + motion * 0.028, now, 0.22);
      this.wind.gain.setTargetAtTime(paused || terminal ? 0.004 : windVolume * (focused ? 0.55 : 1) * (cue ? 0.55 : 1), now, cue ? 0.025 : 0.18);
      this.windFilter.frequency.setTargetAtTime(focused ? 240 : 260 + motion * 600 + landing * 360, now, 0.15);
      this.rainFilter.frequency.setTargetAtTime(focused ? 2300 : 6100 + motion * 1400 + landing * 500, now, 0.16);
      const musicVolume = focused ? 0.6 : playing ? 0.42 - landing * 0.1 : intro ? 0.45 - introFlight * 0.03 : 0.52;
      this.music.gain.setTargetAtTime(paused || terminal ? 0 : musicVolume * (cue ? 0.58 : 1), now, cue ? 0.025 : 0.3);
    }
    if (this.muted || state.mode === 'paused' || state.mode === 'impact' || state.mode === 'caught') {
      this.nextNote = now + 0.08;
      return;
    }
    if (this.nextNote < now) this.nextNote = now + 0.06;
    while (this.nextNote < now + 0.18) {
      const chord = CHORDS[Math.floor(this.step / 16) % CHORDS.length];
      if (this.step % 16 === 0) {
        this.pads.forEach((pad, index) => pad.frequency.setTargetAtTime(hz(chord[index]), this.nextNote, 0.65));
      }
      const beat = this.step % 8;
      const note = beat === 0 ? chord[0] + 24 : beat === 3 ? chord[2] + 24 : beat === 6 ? chord[3] + 24 : null;
      if (note !== null) this._tone(hz(note), this.nextNote, 1.65, beat === 0 ? 0.055 : 0.034, 'sine', this.music, 0, beat === 3 ? 0.32 : -0.25, 0.35);
      if (this.comboLevel && (beat % 2 === 1 || this.comboLevel === 2)) {
        const upperNote = chord[Math.floor(beat / 2) % chord.length] + 36;
        this._tone(hz(upperNote), this.nextNote, 0.3, this.comboLevel === 2 ? 0.024 : 0.016, 'triangle', this.music, 0, beat % 4 < 2 ? -0.3 : 0.3, 0, 'combo');
      }
      this.nextNote += 60 / 56 / 2;
      this.step++;
    }
  }

  // Short voices are capped and disconnect themselves; no audio nodes are made per frame.
  _tone(frequency, at, duration, volume, type = 'sine', target = this.effects, glide = 0, pan = this.pan, wet = 0.12, layer = null) {
    if (this.voices.size >= 28) return;
    const ctx = this.ctx;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    const send = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (panner.pan) panner.pan.value = pan;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    if (glide) oscillator.frequency.exponentialRampToValueAtTime(glide, at + duration * 0.85);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + Math.min(0.012, duration * 0.1));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope);
    envelope.connect(panner);
    panner.connect(target);
    send.gain.value = wet;
    panner.connect(send);
    send.connect(this.echo);
    const voice = { source: oscillator, nodes: [oscillator, envelope, panner, send], layer };
    this.voices.add(voice);
    oscillator.onended = () => this._release(voice);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.03);
  }

  _hush(at, duration, volume, from, to, type = 'bandpass', attack = 0.035, pan = this.pan) {
    if (this.voices.size >= 28) return;
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = 0.55;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + Math.min(attack, duration * 0.25));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (panner.pan) panner.pan.value = pan;
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(panner);
    panner.connect(this.effects);
    const voice = { source, nodes: [source, filter, envelope, panner] };
    this.voices.add(voice);
    source.onended = () => this._release(voice);
    source.start(at, Math.random() * 2);
    source.stop(at + duration + 0.03);
  }

  _release(voice) {
    for (const node of voice.nodes) node.disconnect();
    this.voices.delete(voice);
  }

  _stopCombo() {
    this.comboLevel = 0;
    for (const voice of this.voices) {
      if (voice.layer !== 'combo') continue;
      voice.source.onended = null;
      voice.source.stop();
      this._release(voice);
    }
  }

  play(name, detail = {}) {
    if (['start', 'pause', 'catch', 'impact', 'win'].includes(name)) this._stopCombo();
    if (!this.ctx || this.ctx.state !== 'running' || this.muted || this.disposed) return;
    const at = this.ctx.currentTime + 0.006;
    const cuePan = Number.isFinite(detail?.x) ? clamp(detail.x / 8, -0.8, 0.8) : this.pan;
    if (name === 'tracking' || name === 'lock' || name === 'near') {
      this.cueUntil = at + 0.28;
      this.paramClock = 0;
    }
    if (name === 'start') {
      this._tone(hz(62), at, 0.7, 0.028, 'sine', this.effects, 0, 0, 0.3);
      this._tone(hz(69), at + 0.1, 0.65, 0.02, 'sine', this.effects, 0, 0.12, 0.25);
    } else if (name === 'takeoff') {
      this.paramClock = 0;
      this._hush(at, 0.48, 0.11, 650, 3700, 'highpass', 0.05);
      this._tone(hz(74), at + 0.02, 0.42, 0.04, 'sine', this.effects, 0, 0, 0.14);
    } else if (name === 'dash') {
      this._hush(at, 0.28, 0.32, 500, 7000, 'highpass');
      this._tone(520, at, 0.24, 0.065, 'sine', this.effects, 180, this.pan, 0);
    } else if (name === 'near') {
      this._hush(at, 0.095, 0.105, 3600, 1600, 'bandpass', 0.007);
      this._tone(hz(81), at, 0.2, 0.09, 'sine', this.effects, 0, this.pan, 0.025);
      this._tone(hz(88), at + 0.03, 0.17, 0.035, 'sine', this.effects, 0, this.pan, 0.06);
    } else if (name === 'drop') {
      this._tone(hz(86), at, 0.45, 0.075);
      this._tone(hz(93), at + 0.045, 0.26, 0.027);
    } else if (name === 'tracking') {
      this._tone(hz(67), at, 0.12, 0.048, 'triangle', this.effects, 0, cuePan, 0);
      this._tone(hz(70), at + 0.15, 0.14, 0.045, 'triangle', this.effects, 0, cuePan, 0);
    } else if (name === 'lock') {
      this._hush(at, 0.085, 0.12, 2400, 1100, 'bandpass', 0.005, cuePan);
      this._tone(930, at, 0.09, 0.075, 'triangle', this.effects, 460, cuePan, 0);
      this._tone(hz(78), at + 0.015, 0.14, 0.035, 'sine', this.effects, 0, cuePan, 0);
    } else if (name === 'risk') {
      [69, 74, 78].forEach((note, index) => this._tone(hz(note), at + index * 0.025, 0.52, index === 0 ? 0.068 : 0.043, 'sine', this.effects, 0, this.pan, 0.16));
      this._tone(hz(90), at + 0.05, 0.27, 0.035, 'sine', this.effects, 0, this.pan, 0.1);
    } else if (name === 'catch') {
      this._tone(260, at, 0.45, 0.11, 'triangle', this.effects, 85, 0, 0);
      this._hush(at, 0.24, 0.1, 1400, 220, 'lowpass');
    } else if (name === 'impact') {
      this._tone(78, at, 0.7, 0.18, 'sine', this.effects, 30, 0, 0);
      this._hush(at, 0.11, 0.12, 1300, 480, 'bandpass', 0.006);
      this._hush(at, 0.42, 0.17, 650, 70, 'lowpass');
      this._tone(hz(74), at + 0.09, 1.15, 0.035, 'sine', this.effects, 0, 0, 0.45);
    } else if (name === 'win') {
      [62, 65, 69, 76, 81].forEach((note, index) => this._tone(hz(note), at + index * 0.12, 1.8, index < 3 ? 0.07 : 0.04, 'sine', this.effects, 0, (index - 2) * 0.17, 0.32));
    } else if (name === 'pause') {
      this._tone(hz(72), at, 0.16, 0.03, 'sine', this.effects, 0, 0, 0);
      this._tone(hz(69), at + 0.07, 0.2, 0.025, 'sine', this.effects, 0, 0, 0);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const voice of this.voices) {
      voice.source.onended = null;
      voice.source.stop();
      this._release(voice);
    }
    for (const node of this.persistent) {
      if (typeof node.stop === 'function') node.stop();
      node.disconnect();
    }
    this.persistent.length = 0;
    this.noise = null;
    if (this.ctx) void this.ctx.close().catch(() => {});
  }
}
