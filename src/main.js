import '@fontsource/anton/latin-400.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/cyrillic-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/cyrillic-600.css';
import '@fontsource/manrope/latin-800.css';
import '@fontsource/manrope/cyrillic-800.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './style.css';
import { RainGame, parseSave } from './game.js';
import { RainScene } from './scene.js';
import { GameUI } from './ui.js';
import { RainAudio } from './audio.js';

const SAVE_KEY = 'rain-pain:v1';
let saved;
try { saved = parseSave(localStorage.getItem(SAVE_KEY)); }
catch { saved = parseSave(null); }
if (!localStorageAvailable()) saved.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function localStorageAvailable() {
  try { return localStorage.getItem(SAVE_KEY) !== null; }
  catch { return false; }
}

let ui;
const audio = new RainAudio();
const game = new RainGame({ saved, onEvent: name => {
  if (name === 'save') { save(); return; }
  audio.play(name);
  if (name === 'near') ui?.toast(`БЛИЗЬКО! ×${game.state.combo}`, 'near');
  if (name === 'drop') ui?.toast('+ КРАПЛЯ · + ФОКУС', 'drop');
  if (name === 'risk') ui?.toast(`РИЗИК ОКУПИВСЯ · ×${game.state.combo}`, 'risk');
  if (name === 'tracking') ui?.toast('СТЕЖИТЬ → СПАЛАХ → ЗМІНИ КУРС', 'hunter');
} });
audio.setMuted(saved.muted);

function save() {
  const { bestScore, unlockedLevel, muted, reducedMotion, levelRecords, impactMode } = game.state;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ bestScore, unlockedLevel, muted, reducedMotion, levelRecords, impactMode })); }
  catch { /* The session remains playable when browser storage is unavailable. */ }
}

async function unlockAudio() {
  try { await audio.unlock(); }
  catch { /* Audio is optional; blocked audio must not block the game. */ }
}

function toggleMute() {
  game.state.muted = !game.state.muted;
  audio.setMuted(game.state.muted);
  unlockAudio();
  save();
}

const keys = new Set();
let pointerId = null;
let renderer;

function clearInput() {
  keys.clear();
  pointerId = null;
  game.resetInput();
}

function start(level) {
  clearInput();
  document.activeElement?.blur?.();
  unlockAudio();
  game.start(level);
}

ui = new GameUI(document.querySelector('#ui'), {
  start: level => start(Number.isInteger(level) ? Math.max(1, Math.min(level, game.state.unlockedLevel)) : game.state.unlockedLevel),
  retry: () => start(game.state.level),
  next: () => start(game.state.level + 1),
  menu: () => { clearInput(); game.menu(); },
  pause: () => { clearInput(); game.pause(); },
  resume: () => { clearInput(); document.activeElement?.blur?.(); game.resume(); },
  mute: toggleMute,
  motion: () => { game.state.reducedMotion = !game.state.reducedMotion; save(); },
  impactMode: mode => game.setImpactMode(mode),
  dash: () => game.dash(),
  slow: held => game.slow(held),
  move: axis => game.move(axis),
});

try {
  renderer = new RainScene(document.querySelector('#scene'));
} catch (error) {
  document.querySelector('#scene').innerHTML = '<div class="webgl-error">Для цього міста потрібен WebGL.<br>Увімкни апаратне прискорення браузера та онови сторінку.</div>';
  console.error(error);
}

function syncKeyboard() {
  const left = keys.has('ArrowLeft') || keys.has('KeyA') || keys.has('KeyJ');
  const right = keys.has('ArrowRight') || keys.has('KeyD') || keys.has('KeyL');
  game.move(Number(right) - Number(left));
  game.slow(keys.has('ShiftLeft') || keys.has('ShiftRight'));
}

addEventListener('keydown', event => {
  if (event.defaultPrevented) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.target.closest?.('button') && ['Space', 'Enter'].includes(event.code)) return;
  if (['ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
  if (event.code === 'Escape' || event.code === 'KeyP') {
    if (!event.repeat) {
      clearInput();
      if (game.state.mode === 'playing') game.pause();
      else if (game.state.mode === 'paused') game.resume();
    }
    return;
  }
  if (event.code === 'KeyM' && !event.repeat) { toggleMute(); return; }
  if (game.state.mode !== 'playing') return;
  if (event.code === 'Space' && !event.repeat) game.dash();
  keys.add(event.code);
  syncKeyboard();
});

addEventListener('keyup', event => {
  keys.delete(event.code);
  if (game.state.mode === 'playing') syncKeyboard();
});

const sceneElement = document.querySelector('#scene');
sceneElement.addEventListener('pointerdown', event => {
  if (game.state.mode !== 'playing') return;
  unlockAudio();
  pointerId = event.pointerId;
  sceneElement.setPointerCapture(event.pointerId);
  const x = renderer?.screenToWorld?.(event.clientX, event.clientY);
  if (Number.isFinite(x)) game.point(x);
});
sceneElement.addEventListener('pointermove', event => {
  if (event.pointerId !== pointerId || game.state.mode !== 'playing') return;
  const x = renderer?.screenToWorld?.(event.clientX, event.clientY);
  if (Number.isFinite(x)) game.point(x);
});
function releasePointer(event) {
  if (event.pointerId !== pointerId) return;
  pointerId = null;
  game.targetX = null;
  game.move(0);
}
sceneElement.addEventListener('pointerup', releasePointer);
sceneElement.addEventListener('pointercancel', releasePointer);

addEventListener('blur', () => { clearInput(); game.pause(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearInput(); game.pause(); }
});
addEventListener('resize', () => renderer?.resize());

let lastTime = performance.now();
let frameId;
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  game.update(dt);
  renderer?.update(game.state, dt);
  ui.update(game.state);
  audio.update(game.state, dt);
  frameId = requestAnimationFrame(frame);
}
ui.update(game.state);
frameId = requestAnimationFrame(frame);

addEventListener('pagehide', event => {
  if (event.persisted) { clearInput(); game.pause(); return; }
  cancelAnimationFrame(frameId);
  renderer?.dispose();
  audio.dispose();
});

// Read-only diagnostics for browser smoke tests and future balancing sessions.
Object.defineProperty(window, '__RAIN_PAIN__', {
  value: Object.freeze({
    snapshot: () => JSON.parse(JSON.stringify(game.state)),
    graphics: () => renderer ? {
      calls: renderer.renderer.info.render.calls,
      triangles: renderer.renderer.info.render.triangles,
      geometries: renderer.renderer.info.memory.geometries,
      textures: renderer.renderer.info.memory.textures,
      pixelRatio: renderer.renderer.getPixelRatio(),
    } : null,
    landing: () => renderer ? {
      active: renderer.ragdoll.active,
      simulating: renderer.ragdoll.simulating,
      time: renderer.ragdoll.time,
      contacts: renderer.ragdoll.contacts,
      bodyCount: renderer.ragdoll.parts.length,
      stainCount: renderer.hardLanding.stains.filter(stain => stain.visible).length,
      visible: renderer.hardLanding.group.visible,
    } : null,
  }),
});
