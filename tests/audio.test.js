import test from 'node:test';
import assert from 'node:assert/strict';
import { RainAudio } from '../src/audio.js';

class AudioParamStub {
  constructor() { this.value = 0; }
  setValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
}

class AudioNodeStub {
  constructor(ctx, kind) {
    this.kind = kind;
    this.connections = new Set();
    for (const name of ['gain', 'frequency', 'detune', 'delayTime', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[name] = new AudioParamStub();
    if (kind === 'panner') this.pan = new AudioParamStub();
    if (kind === 'oscillator' || kind === 'buffer') {
      this.start = at => { this.startedAt = at ?? ctx.currentTime; };
      this.stop = at => { this.stopsAt = at ?? ctx.currentTime; };
    }
  }
  connect(node) { this.connections.add(node); }
  disconnect() { this.connections.clear(); }
}

class AudioContextStub {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 64;
    this.nodes = [];
    this.destination = {};
  }
  node(kind) {
    const node = new AudioNodeStub(this, kind);
    this.nodes.push(node);
    return node;
  }
  createGain() { return this.node('gain'); }
  createDynamicsCompressor() { return this.node('compressor'); }
  createDelay() { return this.node('delay'); }
  createBiquadFilter() { return this.node('filter'); }
  createBufferSource() { return this.node('buffer'); }
  createOscillator() { return this.node('oscillator'); }
  createStereoPanner() { return this.node('panner'); }
  createBuffer(channels, length) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: channel => data[channel] };
  }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
  advance(seconds) {
    this.currentTime += seconds;
    for (const node of this.nodes) {
      if (!node.ended && node.stopsAt <= this.currentTime) {
        node.ended = true;
        node.onended?.();
      }
    }
  }
}

async function unlockedAudio(t) {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = AudioContextStub;
  const audio = new RainAudio();
  try {
    assert.equal(await audio.unlock(), true);
  } finally {
    if (previous === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = previous;
  }
  t.after(() => audio.dispose());
  return audio;
}

function advance(audio, seconds, state) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) {
    audio.ctx.advance(1 / 60);
    audio.update(state, 1 / 60);
  }
}

const playing = combo => ({ mode: 'playing', x: 6, combo, speed: 11, progress: 0.2, fallIntensity: 0.5 });
const layerVoices = audio => [...audio.voices].filter(voice => voice.layer === 'combo');

test('hunter cues come from their window even when the player is on the opposite side', async t => {
  const audio = await unlockedAudio(t);
  audio.update(playing(0), 0.02);
  for (const [name, x] of [['tracking', -6], ['lock', -6], ['lock', 6]]) {
    const before = new Set(audio.voices);
    audio.play(name, { x, id: 'window', type: 'hunter' });
    const cues = [...audio.voices].filter(voice => !before.has(voice));
    assert.ok(cues.length > 0);
    for (const cue of cues) {
      const panner = cue.nodes.find(node => node.kind === 'panner');
      assert.ok(panner, `${name} needs a tracked panner`);
      assert.equal(Math.sign(panner.pan.value), Math.sign(x));
    }
  }
  assert.doesNotThrow(() => audio.play('impact', null));
  assert.doesNotThrow(() => audio.play('tracking'));
});

test('combo adds a scheduled layer and every exit stops its current and future voices', async t => {
  for (const mode of ['paused', 'menu', 'intro', 'caught', 'impact', 'result']) {
    const audio = await unlockedAudio(t);
    advance(audio, 0.65, playing(6));
    const active = layerVoices(audio);
    assert.ok(active.length > 0, 'a long combo should be audible');
    const persistentCount = audio.persistent.length;
    audio.update({ ...playing(9), mode }, 0.02);
    assert.equal(layerVoices(audio).length, 0, mode);
    for (const voice of active) {
      assert.ok(voice.source.stopsAt <= audio.ctx.currentTime, `${mode} stops the layer immediately`);
      assert.ok(voice.nodes.every(node => node.connections.size === 0), `${mode} disconnects the layer`);
    }
    advance(audio, 1.3, { ...playing(9), mode });
    assert.equal(layerVoices(audio).length, 0, `${mode} cannot schedule new combo notes`);
    assert.equal(audio.persistent.length, persistentCount);
  }
});

test('combo begins at three, stops on retry, exhaustion and mute, and releases ended notes', async t => {
  const audio = await unlockedAudio(t);
  advance(audio, 0.65, playing(2));
  assert.equal(layerVoices(audio).length, 0);
  advance(audio, 1.05, playing(3));
  assert.ok(layerVoices(audio).length > 0);
  const notes = layerVoices(audio);
  audio.play('start');
  assert.equal(layerVoices(audio).length, 0);
  assert.ok(notes.every(voice => voice.nodes.every(node => node.connections.size === 0)));
  advance(audio, 1.05, playing(6));
  assert.ok(layerVoices(audio).length > 0);
  audio.update(playing(0), 0.02);
  assert.equal(layerVoices(audio).length, 0);
  advance(audio, 1.05, playing(6));
  assert.ok(layerVoices(audio).length > 0);
  audio.setMuted(true);
  assert.equal(layerVoices(audio).length, 0);
  advance(audio, 1.3, playing(9));
  assert.equal(layerVoices(audio).length, 0);
  audio.ctx.advance(5);
  assert.equal(audio.voices.size, 0);
});

test('overlapping positional cues and music stay within the voice cap and dispose cleanly', async t => {
  const audio = await unlockedAudio(t);
  advance(audio, 0.65, playing(9));
  for (let i = 0; i < 80; i++) audio.play('lock', { x: i % 2 ? 6 : -6 });
  assert.equal(audio.voices.size, 28);
  const ctx = audio.ctx;
  audio.dispose();
  assert.equal(audio.voices.size, 0);
  assert.equal(audio.persistent.length, 0);
  assert.ok(ctx.nodes.every(node => node.connections.size === 0));
});
