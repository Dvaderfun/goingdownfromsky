export const LANES = [-6, -3, 0, 3, 6];
export const PLAYER_Y = 1.2;
export const MAX_X = 6.65;
export const DASH_DURATION = 0.28;
export const DASH_COOLDOWN = 1.65;
export const HUNTER_REACH = 1.15;
export const INTRO_DURATION = 3.2;

function introStage(time) {
  return time < 0.8 ? 'roof' : time < 1.7 ? 'approach' : time < 2.5 ? 'jump' : time < INTRO_DURATION ? 'transition' : 'complete';
}

const FIRST_TOWER = [
  { safeLane: 2, blocked: [4] }, { safeLane: 2, blocked: [0] },
  { safeLane: 1, blocked: [2] }, { safeLane: 1, blocked: [0] },
  { safeLane: 2, blocked: [1] }, { safeLane: 2, blocked: [4] },
  { safeLane: 3, blocked: [2], hunter: true }, { safeLane: 3, blocked: [0] },
  { safeLane: 2, blocked: [4] }, { safeLane: 2, blocked: [1] },
  { safeLane: 1, blocked: [2], hunter: true }, { safeLane: 1, blocked: [4] },
  { safeLane: 1, blocked: [0] }, { safeLane: 2, blocked: [1] },
];
const GRADES = ['C', 'B', 'A', 'S'];

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function bandInterval(start, end, halfSize) {
  if (Math.abs(end - start) < 1e-9) return Math.abs(start) < halfSize ? [0, 1] : null;
  const a = (-halfSize - start) / (end - start);
  const b = (halfSize - start) / (end - start);
  const enter = Math.max(0, Math.min(a, b));
  const exit = Math.min(1, Math.max(a, b));
  return enter <= exit ? [enter, exit] : null;
}

/** Test both axes over the same frame interval, including a moving hand. */
export function sweptCatch(oldX, newX, oldHandX, newHandX, oldY, newY, halfWidth, halfHeight = 0.72) {
  const vertical = bandInterval(oldY - PLAYER_Y, newY - PLAYER_Y, halfHeight);
  const horizontal = bandInterval(oldX - oldHandX, newX - newHandX, halfWidth);
  return Boolean(vertical && horizontal && Math.max(vertical[0], horizontal[0]) <= Math.min(vertical[1], horizontal[1]));
}

export function randomGenerator(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function levelConfig(level) {
  const n = Math.max(1, Math.floor(level));
  const names = ['Тихий район', 'Чужі вікна', 'Протяги', 'Безсонний квартал', 'Вище за хмари'];
  return {
    level: n,
    floors: 18 + (n - 1) * 6,
    height: 180 + (n - 1) * 60,
    speed: Math.min(20, 11 + (n - 1) * 0.8),
    waveSize: n < 2 ? 1 : n < 4 ? 2 : 3,
    sweepChance: n === 1 ? 0 : Math.min(0.6, n * 0.1),
    windStrength: n < 3 ? 0 : Math.min(2.1, 0.8 + (n - 3) * 0.15),
    levelName: names[Math.min(n - 1, names.length - 1)],
  };
}

export function gradeRun({ nearMisses = 0, riskDrops = 0, drops = 0, bestCombo = 0 }, waveCount) {
  const normalDrops = Math.max(0, drops - riskDrops);
  const style = (nearMisses + riskDrops * 1.8 + normalDrops * 0.2 + bestCombo * 0.45) / Math.max(1, waveCount);
  return style >= 0.95 ? 'S' : style >= 0.6 ? 'A' : style >= 0.28 ? 'B' : 'C';
}

/** Every wave reserves a safe lane, at most one lane away from the last one. */
export function generateLevel(level, seed) {
  const config = levelConfig(level);
  const rng = randomGenerator(seed);
  const hazards = [];
  const pickups = [];
  const waves = [];
  let safeLane = 2;
  let id = 0;
  let waveIndex = 0;
  for (let at = 30; at < config.height - 13; at += 10) {
    const authored = level === 1 ? FIRST_TOWER[waveIndex] : null;
    safeLane = authored?.safeLane ?? clamp(safeLane + Math.floor(rng() * 3) - 1, 0, 4);
    const candidates = LANES.map((_, i) => i).filter(i => i !== safeLane);
    // Fisher–Yates keeps the seeded layout independent of JS sort behavior.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const count = config.waveSize;
    const blocked = authored?.blocked ?? candidates.slice(0, count);
    const waveHazards = [];
    for (const [index, lane] of blocked.entries()) {
      const hunter = authored?.hunter || (level >= 2 && waveIndex % 4 === 2 && index === 0);
      const type = hunter ? 'hunter' : rng() < config.sweepChance ? 'sweep' : level >= 4 && rng() < 0.22 ? 'long' : 'grab';
      const hazard = {
        id: `h${id++}`, at, baseX: LANES[lane], x: LANES[lane], y: PLAYER_Y - at,
        type, phase: rng() * Math.PI * 2, warning: 0, active: false, passed: false,
        stage: 'warning', targetX: LANES[lane], locked: false,
      };
      waveHazards.push(hazard);
      hazards.push(hazard);
    }
    waves.push({ at, safeLane, blocked, pattern: authored?.hunter ? 'hunter' : authored ? 'weave' : 'random' });
    if (level === 1 ? waveIndex < 2 || waveIndex % 3 === 0 : rng() < 0.65) {
      const dropX = LANES[safeLane];
      pickups.push({ id: `d${id++}`, at: at + 4, x: dropX, y: PLAYER_Y - at - 4, risk: false, collected: false, passed: false });
    }
    const riskHand = waveHazards.find(h => h.type !== 'hunter');
    if (riskHand && waveIndex >= 2 && (level === 1 ? waveIndex % 2 === 0 : rng() < 0.5)) {
      const direction = Math.sign(LANES[safeLane] - riskHand.baseX);
      const riskX = clamp(riskHand.baseX + direction * 1.75, -6.35, 6.35);
      pickups.push({ id: `d${id++}`, at, x: riskX, y: PLAYER_Y - at, risk: true, collected: false, passed: false });
    }
    waveIndex++;
  }
  return { config, hazards, pickups, waves };
}

export function parseSave(raw) {
  try {
    const data = JSON.parse(raw);
    const levelRecords = {};
    if (data?.levelRecords && typeof data.levelRecords === 'object' && !Array.isArray(data.levelRecords)) {
      for (const [key, record] of Object.entries(data.levelRecords)) {
        if (!/^[1-9]\d{0,4}$/.test(key) || Number(key) > 10000 || !Number.isFinite(record?.score)) continue;
        levelRecords[key] = {
          score: clamp(Math.floor(record.score), 0, 999999999),
          grade: GRADES.includes(record.grade) ? record.grade : null,
        };
      }
    }
    return {
      bestScore: Number.isFinite(data?.bestScore) ? clamp(Math.floor(data.bestScore), 0, 999999999) : 0,
      unlockedLevel: Number.isFinite(data?.unlockedLevel) ? clamp(Math.floor(data.unlockedLevel), 1, 10000) : 1,
      muted: data?.muted === true,
      reducedMotion: data?.reducedMotion === true,
      impactMode: data?.impactMode === 'hard' ? 'hard' : 'arcade',
      levelRecords,
    };
  } catch {
    return { bestScore: 0, unlockedLevel: 1, muted: false, reducedMotion: false, impactMode: 'arcade', levelRecords: {} };
  }
}

export class RainGame {
  constructor({ saved = {}, onEvent = () => {} } = {}) {
    this.onEvent = onEvent;
    this.axis = 0;
    this.targetX = null;
    this.slowHeld = false;
    this.focusExhausted = false;
    this.lastDirection = 1;
    this.resultTimer = 0;
    this.state = {
      ...levelConfig(1), mode: 'menu', x: 0, velocity: 0, distance: 0, progress: 0,
      time: 0, elapsed: 0, hazards: [], pickups: [], score: 0, combo: 0, bestCombo: 0,
      nearMisses: 0, drops: 0, focus: 0.65, slow: false, dashTimer: 0,
      riskDrops: 0, nearTimer: 0, pickupTimer: 0, launchProgress: 1,
      introTime: INTRO_DURATION, introProgress: 1, introStage: 'complete', resumeMode: null,
      fallSpeed: 11, fallIntensity: 0, tutorialHint: '',
      dashCooldown: 0, shake: 0, wind: 0, outcome: null, lastResult: null,
      bestScore: saved.bestScore ?? 0, unlockedLevel: saved.unlockedLevel ?? 1,
      muted: saved.muted ?? false, reducedMotion: saved.reducedMotion ?? false,
      impactMode: saved.impactMode === 'hard' ? 'hard' : 'arcade',
      runImpactMode: saved.impactMode === 'hard' ? 'hard' : 'arcade',
      levelRecords: structuredClone(saved.levelRecords ?? {}),
    };
    this.scoreFloat = 0;
    this.comboTimer = 0;
  }

  start(level = 1, seed = Math.floor(Math.random() * 0xffffffff), { skipIntro = false } = {}) {
    const layout = generateLevel(level, seed);
    Object.assign(this.state, layout.config, {
      mode: skipIntro ? 'playing' : 'intro', x: 0, velocity: 0, distance: 0, progress: 0, elapsed: 0,
      hazards: layout.hazards, pickups: layout.pickups, score: 0, combo: 0, bestCombo: 0,
      nearMisses: 0, drops: 0, focus: 0.65, slow: false, dashTimer: 0, dashCooldown: 0,
      riskDrops: 0, nearTimer: 0, pickupTimer: 0, launchProgress: skipIntro ? 1 : 0,
      introTime: skipIntro ? INTRO_DURATION : 0, introProgress: skipIntro ? 1 : 0,
      introStage: skipIntro ? 'complete' : 'roof', resumeMode: null,
      fallSpeed: layout.config.speed * 0.76, fallIntensity: 0, tutorialHint: level === 1 ? 'A / D або ← / → — обирай траєкторію' : '',
      shake: 0, wind: 0, outcome: null, lastResult: null,
      runImpactMode: this.state.impactMode,
    });
    this.seed = seed;
    this.waves = layout.waves;
    this.resetInput();
    this.scoreFloat = 0;
    this.comboTimer = 0;
    this.resultTimer = 0;
    this.hunterIntroduced = false;
    this.introTakeoff = skipIntro;
    this.onEvent('start');
  }

  beginFlight() {
    const s = this.state;
    Object.assign(s, {
      mode: 'playing', introTime: INTRO_DURATION, introProgress: 1,
      introStage: 'complete', launchProgress: 1, resumeMode: null,
      distance: 0, elapsed: 0, progress: 0, x: 0, velocity: 0,
    });
    this.resetInput();
    if (!this.introTakeoff) {
      this.introTakeoff = true;
      this.onEvent('takeoff');
    }
  }

  skipIntro() {
    if (this.state.mode !== 'intro') return false;
    this.beginFlight();
    return true;
  }

  resetInput() {
    this.axis = 0;
    this.targetX = null;
    this.slowHeld = false;
    this.focusExhausted = false;
    this.state.slow = false;
  }

  move(axis) {
    if (this.state.mode !== 'playing') return;
    this.axis = clamp(axis, -1, 1);
    this.targetX = null;
    if (this.axis) this.lastDirection = Math.sign(this.axis);
  }

  point(x) {
    if (this.state.mode !== 'playing') return;
    this.targetX = clamp(x, -MAX_X, MAX_X);
  }

  dash() {
    const s = this.state;
    if (s.mode !== 'playing' || s.dashCooldown > 0) return false;
    if (this.targetX !== null && Math.abs(this.targetX - s.x) > 0.3) this.lastDirection = Math.sign(this.targetX - s.x);
    s.dashTimer = DASH_DURATION;
    s.dashCooldown = DASH_COOLDOWN;
    s.velocity = this.lastDirection * 22;
    s.shake = s.reducedMotion ? 0 : 0.07;
    this.onEvent('dash');
    return true;
  }

  slow(held) {
    if (held && this.state.mode !== 'playing') return;
    this.slowHeld = held;
    if (!held) this.focusExhausted = false;
  }

  setImpactMode(mode) {
    if (this.state.mode !== 'menu' || !['arcade', 'hard'].includes(mode)) return false;
    if (this.state.impactMode !== mode) {
      this.state.impactMode = mode;
      this.onEvent('save');
    }
    return true;
  }

  pause() {
    if (!['playing', 'intro'].includes(this.state.mode)) return;
    this.state.resumeMode = this.state.mode;
    this.state.mode = 'paused';
    this.resetInput();
    this.onEvent('pause');
  }

  resume() {
    if (this.state.mode === 'paused') {
      this.state.mode = this.state.resumeMode === 'intro' ? 'intro' : 'playing';
      this.state.resumeMode = null;
    }
  }

  menu() {
    this.resetInput();
    Object.assign(this.state, { mode: 'menu', outcome: null, distance: 0, progress: 0, x: 0, velocity: 0, hazards: [], pickups: [], shake: 0, nearTimer: 0, pickupTimer: 0, launchProgress: 1, introTime: INTRO_DURATION, introProgress: 1, introStage: 'complete', resumeMode: null, tutorialHint: '', fallIntensity: 0 });
  }

  addScore(amount) {
    this.scoreFloat += amount;
    this.state.score = Math.floor(this.scoreFloat);
  }

  finish(outcome) {
    if (this.state.mode !== 'playing') return;
    const s = this.state;
    s.outcome = outcome;
    s.mode = outcome === 'win' ? 'impact' : 'caught';
    s.shake = s.reducedMotion ? 0 : outcome === 'win' ? 0.55 : 0.3;
    this.resetInput();
    s.dashTimer = 0;
    s.wind = 0;
    this.resultTimer = outcome === 'win' ? (s.runImpactMode === 'hard' ? 3.6 : 1.3) : 0.85;
    if (outcome === 'win') {
      this.addScore(250 + s.level * 100);
      s.unlockedLevel = Math.max(s.unlockedLevel, s.level + 1);
    }
    const newBest = s.score > s.bestScore;
    s.bestScore = Math.max(s.bestScore, s.score);
    const grade = outcome === 'win' ? gradeRun(s, this.waves.length) : null;
    const previous = s.levelRecords[s.level] ?? { score: 0, grade: null };
    const newLevelBest = outcome === 'win' && s.score > previous.score;
    if (outcome === 'win') {
      s.levelRecords[s.level] = {
        score: Math.max(previous.score, s.score),
        grade: GRADES[Math.max(GRADES.indexOf(previous.grade), GRADES.indexOf(grade))],
      };
    }
    s.lastResult = {
      score: s.score, nearMisses: s.nearMisses, drops: s.drops,
      level: s.level, elapsed: s.elapsed, bestCombo: s.bestCombo, newBest,
      riskDrops: s.riskDrops, grade, newLevelBest,
      levelBestScore: s.levelRecords[s.level]?.score ?? 0,
      runImpactMode: s.runImpactMode,
    };
    this.onEvent(outcome === 'win' ? 'impact' : 'catch');
    this.onEvent('save');
  }

  update(delta) {
    const dt = clamp(delta, 0, 0.05);
    const s = this.state;
    s.time += dt;
    s.shake = Math.max(0, s.shake - dt * 1.8);
    if (s.mode === 'intro') {
      s.introTime = Math.min(INTRO_DURATION, s.introTime + dt);
      s.introProgress = s.introTime / INTRO_DURATION;
      s.launchProgress = s.introProgress;
      s.introStage = introStage(s.introTime);
      if (!this.introTakeoff && s.introTime >= 1.7) {
        this.introTakeoff = true;
        this.onEvent('takeoff');
      }
      if (s.introTime >= INTRO_DURATION - 1e-9) this.beginFlight();
      return;
    }
    if (s.mode === 'impact' || s.mode === 'caught') {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        s.mode = 'result';
        if (s.outcome === 'win') this.onEvent('win');
      }
      return;
    }
    if (s.mode !== 'playing') return;
    s.elapsed += dt;
    s.launchProgress = 1;
    s.nearTimer = Math.max(0, s.nearTimer - dt);
    s.pickupTimer = Math.max(0, s.pickupTimer - dt);
    const wasDashing = s.dashTimer > 0;
    s.dashTimer = Math.max(0, s.dashTimer - dt);
    s.dashCooldown = Math.max(0, s.dashCooldown - dt);
    if (this.slowHeld && s.focus <= 0.025) this.focusExhausted = true;
    s.slow = this.slowHeld && !this.focusExhausted && s.focus > 0.025;
    if (s.slow) s.focus = Math.max(0, s.focus - dt * 0.32);
    else s.focus = Math.min(1, s.focus + dt * 0.017);
    const worldDt = dt * (s.slow ? 0.38 : 1);
    const oldDistance = s.distance;
    s.fallSpeed = s.speed * (0.76 + 0.24 * Math.min(1, s.elapsed / 1.4)) * (1 + 0.1 * s.progress ** 3);
    s.distance = Math.min(s.height, s.distance + s.fallSpeed * worldDt);
    s.progress = s.distance / s.height;
    s.fallIntensity = clamp(0.18 + s.progress * 0.52 + Math.min(1, s.elapsed / 1.4) * 0.2 + (s.dashTimer > 0 ? 0.1 : 0), 0, 1);
    if (s.level === 1) {
      s.tutorialHint = s.distance < 21 ? 'A / D або ← / → — обирай траєкторію'
        : s.distance < 46 ? 'Руки ловлять. Дочекайся вільного коридору.'
        : s.distance < 76 ? 'Коралова крапля — ризик, очки й більше фокусу'
        : s.distance < 103 ? 'Переслідувач: стежить → спалах → зміни курс'
        : s.distance < 136 ? 'Space — ривок. Shift — час на рішення.' : 'Близькі прольоти й ризикові краплі підвищують оцінку';
    }
    s.wind = s.windStrength * Math.sin(s.elapsed * 0.73) * Math.max(0, Math.sin(s.elapsed * 0.29));

    const oldX = s.x;
    let axis = this.axis;
    if (this.targetX !== null) axis = clamp((this.targetX - s.x) * 1.8, -1, 1);
    if (axis) this.lastDirection = Math.sign(axis);
    if (wasDashing) s.velocity = this.lastDirection * 22;
    else {
      const desired = axis * 11.5 + s.wind;
      s.velocity += (desired - s.velocity) * (1 - Math.exp(-dt * 15));
    }
    s.x = clamp(s.x + s.velocity * dt, -MAX_X, MAX_X);
    if (Math.abs(s.x) === MAX_X) s.velocity = 0;
    this.addScore(worldDt * 9);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0) s.combo = 0;

    for (const h of s.hazards) {
      const oldY = PLAYER_Y + oldDistance - h.at;
      const oldHandX = h.type === 'hunter' ? h.x : h.baseX + (h.type === 'sweep' ? Math.sin((oldDistance - h.at) * 0.23 + h.phase) * 1.05 : 0);
      h.y = PLAYER_Y + s.distance - h.at;
      if (h.type === 'hunter') {
        if (!h.locked && h.y > -11) {
          const target = clamp(s.x, h.baseX - HUNTER_REACH, h.baseX + HUNTER_REACH);
          h.targetX += (target - h.targetX) * (1 - Math.exp(-worldDt * 7));
          if (!this.hunterIntroduced) { this.hunterIntroduced = true; this.onEvent('tracking'); }
          if (h.y >= -7.2) { h.locked = true; this.onEvent('lock'); }
        }
        h.x = h.targetX;
        h.stage = h.passed ? 'passed' : h.y > -4.5 ? 'reaching' : h.locked ? 'locked' : 'tracking';
      } else {
        h.x = h.baseX + (h.type === 'sweep' ? Math.sin((s.distance - h.at) * 0.23 + h.phase) * 1.05 : 0);
        h.stage = h.passed ? 'passed' : h.y > -4.5 ? 'reaching' : 'warning';
      }
      h.warning = clamp((h.y + 11) / 6.5, 0, 1);
      h.active = h.y > -4.5 && h.y < 4.8 && !h.passed;
      if (h.passed || h.y < -14) continue;
      const halfWidth = h.type === 'long' ? 1.06 : 0.85;
      if (h.active && !wasDashing && sweptCatch(oldX, s.x, oldHandX, h.x, oldY, h.y, halfWidth)) {
        this.finish('caught');
        return;
      }
      if (h.y > PLAYER_Y + 1.15) {
        h.passed = true;
        h.stage = 'passed';
        h.active = false;
        const separation = Math.abs(s.x - h.x);
        if (separation < 2.2 && separation > halfWidth - 0.1) {
          s.nearMisses++;
          s.combo = Math.min(9, s.combo + 1);
          s.bestCombo = Math.max(s.bestCombo, s.combo);
          this.comboTimer = 3.6;
          s.focus = Math.min(1, s.focus + 0.13);
          s.nearTimer = 0.25;
          this.addScore(75 * s.combo);
          this.onEvent('near');
        }
      }
    }
    for (const p of s.pickups) {
      const oldY = PLAYER_Y + oldDistance - p.at;
      p.y = PLAYER_Y + s.distance - p.at;
      if (p.collected || p.passed) continue;
      if (sweptCatch(oldX, s.x, p.x, p.x, oldY, p.y, p.risk ? 0.5 : 1.05, 0.85)) {
        p.collected = true;
        s.drops++;
        s.pickupTimer = 0.35;
        if (p.risk) {
          s.riskDrops++;
          s.combo = Math.min(9, s.combo + 1);
          s.bestCombo = Math.max(s.bestCombo, s.combo);
          this.comboTimer = 3.6;
          s.focus = Math.min(1, s.focus + 0.26);
          this.addScore(250 + s.combo * 40);
          this.onEvent('risk');
        } else {
          s.focus = Math.min(1, s.focus + 0.18);
          this.addScore(100 + s.combo * 20);
          this.onEvent('drop');
        }
      } else if (p.y > PLAYER_Y + 1.2) p.passed = true;
    }
    if (s.distance >= s.height) this.finish('win');
  }
}
