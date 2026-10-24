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
  { safeLane: 3, blocked: [2], hunter: true }, { safeLane: 3, blocked: [4] },
  { safeLane: 2, blocked: [3] }, { safeLane: 2, blocked: [1] },
  { safeLane: 1, blocked: [2], hunter: true }, { safeLane: 1, blocked: [0] },
  { safeLane: 1, blocked: [0] }, { safeLane: 2, blocked: [3] },
];
const GRADES = ['C', 'B', 'A', 'S'];
const STYLE_THRESHOLDS = [0, 0.25, 0.5, 0.75];
const PHRASES = [
  ['weave', 'weave', 'hunter', 'risk', 'weave', 'rest'],
  ['weave', 'risk', 'hunter', 'weave', 'risk', 'rest'],
  ['weave', 'hunter', 'weave', 'risk', 'rest'],
];

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

function nearSeparation(oldX, newX, oldHandX, newHandX, oldY, newY) {
  const vertical = bandInterval(oldY - PLAYER_Y, newY - PLAYER_Y, 0.72);
  if (!vertical) return Infinity;
  const start = oldX - oldHandX;
  const change = newX - newHandX - start;
  const a = start + change * vertical[0];
  const b = start + change * vertical[1];
  return a * b <= 0 ? 0 : Math.min(Math.abs(a), Math.abs(b));
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
  const size = Math.min(n, 10);
  const names = ['Тихий район', 'Чужі вікна', 'Протяги', 'Безсонний квартал', 'Вище за хмари'];
  return {
    level: n,
    district: (n - 1) % names.length,
    floors: 18 + (size - 1) * 6,
    height: 180 + (size - 1) * 60,
    speed: Math.min(20, 11 + (n - 1) * 0.8),
    waveSize: n < 2 ? 1 : n < 4 ? 2 : 3,
    sweepChance: n === 1 ? 0 : Math.min(0.6, n * 0.1),
    windStrength: n < 3 ? 0 : Math.min(2.1, 0.8 + (n - 3) * 0.15),
    levelName: names[(n - 1) % names.length],
  };
}

export function gradeRun({ nearMisses = 0, riskDrops = 0, drops = 0, bestCombo = 0 }, waveCount) {
  const normalDrops = Math.max(0, drops - riskDrops);
  if (typeof waveCount === 'object' && waveCount !== null) {
    return GRADES[styleDetails({ nearMisses, riskDrops, drops, bestCombo }, waveCount).gradeIndex];
  }
  const style = (nearMisses + riskDrops * 1.8 + normalDrops * 0.2 + bestCombo * 0.45) / Math.max(1, waveCount);
  return style >= 0.95 ? 'S' : style >= 0.6 ? 'A' : style >= 0.28 ? 'B' : 'C';
}

function styleDetails(stats, opportunities) {
  const near = Math.max(0, stats.nearMisses ?? 0);
  const risk = Math.max(0, stats.riskDrops ?? 0);
  const normal = Math.max(0, (stats.drops ?? 0) - risk);
  const nearTotal = Math.max(1, opportunities.nearOpportunities ?? opportunities.waveCount ?? 1);
  const riskTotal = Math.max(1, opportunities.riskOpportunities ?? 0);
  const normalTotal = Math.max(1, opportunities.dropOpportunities ?? 0);
  const value = clamp(near / nearTotal, 0, 1) * 0.5
    + clamp(risk / riskTotal, 0, 1) * 0.32
    + clamp((stats.bestCombo ?? 0) / 9, 0, 1) * 0.15
    + clamp(normal / normalTotal, 0, 1) * 0.03;
  const gradeIndex = value >= 0.75 ? 3 : value >= 0.5 ? 2 : value >= 0.25 ? 1 : 0;
  const nextGrade = GRADES[gradeIndex + 1] ?? null;
  if (!nextGrade) return { value, gradeIndex, nextGrade, nearNeeded: 0, riskNeeded: 0, goal: 'S. Тримай цей ритм.' };
  const deficit = STYLE_THRESHOLDS[gradeIndex + 1] - value;
  const requiredNear = Math.ceil((deficit - 1e-9) * nearTotal / 0.5);
  const requiredRisk = Math.ceil((deficit - 1e-9) * riskTotal / 0.32);
  const nearNeeded = requiredNear <= nearTotal - near ? requiredNear : null;
  const riskNeeded = requiredRisk <= (opportunities.riskOpportunities ?? 0) - risk ? requiredRisk : null;
  let goal = nearNeeded !== null ? `До ${nextGrade}: ще близьких прольотів — ${nearNeeded}.`
    : riskNeeded !== null ? `До ${nextGrade}: ще ризикових крапель — ${riskNeeded}.`
    : `До ${nextGrade}: доведи комбо до 9.`;
  if (nearNeeded === null && riskNeeded === null) {
    let plan = null;
    for (let extraNear = 0; extraNear <= nearTotal - near; extraNear++) {
      const extraRisk = Math.max(0, Math.ceil((deficit - extraNear / nearTotal * 0.5 - 1e-9) * riskTotal / 0.32));
      if (extraRisk > (opportunities.riskOpportunities ?? 0) - risk) continue;
      if (!plan || extraNear + extraRisk < plan.near + plan.risk) plan = { near: extraNear, risk: extraRisk };
    }
    if (plan) goal = `До ${nextGrade}: близькі прольоти +${plan.near}, ризикові краплі +${plan.risk}.`;
  }
  return { value, gradeIndex, nextGrade, nearNeeded, riskNeeded, goal };
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
  let phrase = [];
  let phraseIndex = 0;
  let weaveDirection = 1;
  for (let at = 30; at < config.height - 13;) {
    const authored = level === 1 ? FIRST_TOWER[waveIndex] : null;
    if (!authored && phraseIndex >= phrase.length) {
      phrase = PHRASES[Math.floor(rng() * PHRASES.length)];
      phraseIndex = 0;
      weaveDirection = rng() < 0.5 ? -1 : 1;
    }
    const pattern = authored ? (authored.hunter ? 'hunter' : 'weave') : phrase[phraseIndex++];
    if (authored) safeLane = authored.safeLane;
    else if (pattern === 'weave') {
      if (safeLane + weaveDirection < 0 || safeLane + weaveDirection > 4) weaveDirection *= -1;
      safeLane += weaveDirection;
      weaveDirection *= -1;
    }
    const candidates = LANES.map((_, i) => i).filter(i => i !== safeLane);
    // Fisher–Yates keeps the seeded layout independent of JS sort behavior.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const count = pattern === 'rest' ? 0 : config.waveSize;
    if (pattern === 'risk') {
      const closest = candidates.reduce((best, lane) => Math.abs(lane - safeLane) < Math.abs(best - safeLane) ? lane : best);
      candidates.splice(candidates.indexOf(closest), 1);
      candidates.unshift(closest);
    }
    const blocked = authored?.blocked ?? candidates.slice(0, count);
    const waveHazards = [];
    for (const [index, lane] of blocked.entries()) {
      const hunter = pattern === 'hunter' && index === 0;
      const type = hunter ? 'hunter' : pattern === 'risk' && index === 0 ? 'grab'
        : rng() < config.sweepChance ? 'sweep' : level >= 4 && rng() < 0.22 ? 'long' : 'grab';
      const hazard = {
        id: `h${id++}`, at, baseX: LANES[lane], x: LANES[lane], y: PLAYER_Y - at,
        type, phase: rng() * Math.PI * 2, warning: 0, active: false, passed: false,
        stage: 'warning', targetX: LANES[lane], locked: false,
        nearSeparation: null, dashedThrough: false, trackingNotified: false,
      };
      waveHazards.push(hazard);
      hazards.push(hazard);
    }
    waves.push({ at, safeLane, blocked, pattern });
    if (level === 1 ? waveIndex < 2 || waveIndex % 3 === 0 : pattern === 'rest' || rng() < 0.65) {
      const dropX = LANES[safeLane];
      pickups.push({ id: `d${id++}`, at: at + 4, x: dropX, y: PLAYER_Y - at - 4, risk: false, collected: false, passed: false });
    }
    const riskHand = waveHazards.filter(h => h.type === 'grab' || h.type === 'long')
      .sort((a, b) => Math.abs(a.baseX - LANES[safeLane]) - Math.abs(b.baseX - LANES[safeLane]))[0];
    if (riskHand && waveIndex >= 2 && (level === 1 ? waveIndex % 2 === 0 : pattern === 'risk')) {
      const direction = Math.sign(LANES[safeLane] - riskHand.baseX);
      const riskX = clamp(riskHand.baseX + direction * 1.75, -6.35, 6.35);
      const safeRisk = Math.abs(riskX - LANES[safeLane]) <= 1.25 && waveHazards.every(h => {
        const reach = h.type === 'sweep' ? 1.05 : h.type === 'hunter' ? HUNTER_REACH : 0;
        const catchWidth = h.type === 'long' ? 1.06 : 0.85;
        return Math.abs(riskX - h.baseX) > reach + catchWidth + 0.5;
      });
      if (safeRisk) pickups.push({ id: `d${id++}`, at, x: riskX, y: PLAYER_Y - at, risk: true, collected: false, passed: false });
    }
    waveIndex++;
    at += pattern === 'rest' ? 20 : 10;
  }
  return { config, hazards, pickups, waves };
}

function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function dailyChallenge(date = new Date()) {
  const instant = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const part = type => parts.find(p => p.type === type).value;
  const key = `${part('year')}-${part('month')}-${part('day')}`;
  let seed = 2166136261;
  for (const char of `RAIN/PAIN:${key}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  return { date: key, seed, level: 3 };
}

export function parseSave(raw) {
  try {
    const data = JSON.parse(raw);
    const levelRecords = {};
    const dailyRecords = {};
    if (data?.levelRecords && typeof data.levelRecords === 'object' && !Array.isArray(data.levelRecords)) {
      for (const [key, record] of Object.entries(data.levelRecords)) {
        if (!/^[1-9]\d{0,4}$/.test(key) || Number(key) > 10000 || !Number.isFinite(record?.score)) continue;
        levelRecords[key] = {
          score: clamp(Math.floor(record.score), 0, 999999999),
          grade: GRADES.includes(record.grade) ? record.grade : null,
        };
      }
    }
    if (data?.dailyRecords && typeof data.dailyRecords === 'object' && !Array.isArray(data.dailyRecords)) {
      for (const key of Object.keys(data.dailyRecords).filter(validDateKey).sort().reverse().slice(0, 366)) {
        const record = data.dailyRecords[key];
        if (!Number.isFinite(record?.score)) continue;
        dailyRecords[key] = {
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
      levelRecords, dailyRecords,
    };
  } catch {
    return { bestScore: 0, unlockedLevel: 1, muted: false, reducedMotion: false, impactMode: 'arcade', levelRecords: {}, dailyRecords: {} };
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
      dashDirection: 1, focusExhausted: false, comboRemaining: 0,
      riskDrops: 0, nearTimer: 0, pickupTimer: 0, launchProgress: 1,
      introTime: INTRO_DURATION, introProgress: 1, introStage: 'complete', resumeMode: null,
      fallSpeed: 11, fallIntensity: 0, tutorialHint: '',
      dashCooldown: 0, shake: 0, wind: 0, outcome: null, lastResult: null,
      bestScore: saved.bestScore ?? 0, unlockedLevel: saved.unlockedLevel ?? 1,
      muted: saved.muted ?? false, reducedMotion: saved.reducedMotion ?? false,
      impactMode: saved.impactMode === 'hard' ? 'hard' : 'arcade',
      runImpactMode: saved.impactMode === 'hard' ? 'hard' : 'arcade',
      levelRecords: structuredClone(saved.levelRecords ?? {}),
      dailyDate: null, dailyRecords: structuredClone(saved.dailyRecords ?? {}), caughtBy: null,
    };
    this.scoreFloat = 0;
    this.comboTimer = 0;
  }

  start(level = 1, seed = Math.floor(Math.random() * 0xffffffff), { skipIntro = false, dailyDate = null } = {}) {
    const layout = generateLevel(level, seed);
    Object.assign(this.state, layout.config, {
      mode: skipIntro ? 'playing' : 'intro', x: 0, velocity: 0, distance: 0, progress: 0, elapsed: 0,
      hazards: layout.hazards, pickups: layout.pickups, score: 0, combo: 0, bestCombo: 0,
      nearMisses: 0, drops: 0, focus: 0.65, slow: false, dashTimer: 0, dashCooldown: 0,
      dashDirection: 1, focusExhausted: false, comboRemaining: 0,
      riskDrops: 0, nearTimer: 0, pickupTimer: 0, launchProgress: skipIntro ? 1 : 0,
      introTime: skipIntro ? INTRO_DURATION : 0, introProgress: skipIntro ? 1 : 0,
      introStage: skipIntro ? 'complete' : 'roof', resumeMode: null,
      fallSpeed: layout.config.speed * 0.76, fallIntensity: 0, tutorialHint: level === 1 ? 'A / D або ← / → — обирай траєкторію' : '',
      shake: 0, wind: 0, outcome: null, lastResult: null, caughtBy: null,
      dailyDate: validDateKey(dailyDate) ? dailyDate : null,
      runImpactMode: this.state.impactMode,
    });
    this.seed = seed;
    this.waves = layout.waves;
    this.nearWaves = new Set();
    this.styleOpportunities = {
      waveCount: layout.waves.length,
      nearOpportunities: layout.waves.filter(w => w.blocked.length > 0).length,
      riskOpportunities: layout.pickups.filter(p => p.risk).length,
      dropOpportunities: layout.pickups.filter(p => !p.risk).length,
    };
    this.resetInput();
    this.lastDirection = 1;
    this.scoreFloat = 0;
    this.comboTimer = 0;
    this.resultTimer = 0;
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
    this.state.focusExhausted = false;
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
    s.dashDirection = this.lastDirection;
    s.velocity = s.dashDirection * 22;
    s.shake = s.reducedMotion ? 0 : 0.07;
    this.onEvent('dash');
    return true;
  }

  slow(held) {
    if (held && this.state.mode !== 'playing') return;
    this.slowHeld = held;
    if (!held) {
      this.focusExhausted = false;
      this.state.focusExhausted = false;
    }
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
    Object.assign(this.state, { mode: 'menu', outcome: null, distance: 0, progress: 0, x: 0, velocity: 0, hazards: [], pickups: [], shake: 0, nearTimer: 0, pickupTimer: 0, launchProgress: 1, introTime: INTRO_DURATION, introProgress: 1, introStage: 'complete', resumeMode: null, tutorialHint: '', fallIntensity: 0, dashTimer: 0, dashCooldown: 0, comboRemaining: 0, caughtBy: null, dailyDate: null });
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
      if (!s.dailyDate) s.unlockedLevel = Math.min(10000, Math.max(s.unlockedLevel, s.level + 1));
    }
    const newBest = !s.dailyDate && s.score > s.bestScore;
    if (!s.dailyDate) s.bestScore = Math.max(s.bestScore, s.score);
    const { gradeIndex, ...style } = styleDetails(s, this.styleOpportunities);
    const grade = outcome === 'win' ? GRADES[gradeIndex] : null;
    const previous = s.levelRecords[s.level] ?? { score: 0, grade: null };
    const newLevelBest = !s.dailyDate && outcome === 'win' && s.score > previous.score;
    if (outcome === 'win' && !s.dailyDate) {
      s.levelRecords[s.level] = {
        score: Math.max(previous.score, s.score),
        grade: GRADES[Math.max(GRADES.indexOf(previous.grade), GRADES.indexOf(grade))],
      };
    }
    const previousDaily = s.dailyRecords[s.dailyDate] ?? { score: 0, grade: null };
    const newDailyBest = Boolean(s.dailyDate && outcome === 'win' && s.score > previousDaily.score);
    if (outcome === 'win' && s.dailyDate) {
      s.dailyRecords[s.dailyDate] = {
        score: Math.max(previousDaily.score, s.score),
        grade: GRADES[Math.max(GRADES.indexOf(previousDaily.grade), GRADES.indexOf(grade))],
      };
      const dates = Object.keys(s.dailyRecords).sort().reverse();
      for (const date of dates.slice(366)) delete s.dailyRecords[date];
    }
    s.lastResult = {
      score: s.score, nearMisses: s.nearMisses, drops: s.drops,
      level: s.level, elapsed: s.elapsed, bestCombo: s.bestCombo, newBest,
      riskDrops: s.riskDrops, grade, newLevelBest,
      levelBestScore: s.levelRecords[s.level]?.score ?? 0,
      runImpactMode: s.runImpactMode,
      progress: s.progress, caughtBy: s.caughtBy ? { ...s.caughtBy } : null, style,
      dailyDate: s.dailyDate, dailyScore: s.dailyRecords[s.dailyDate]?.score ?? 0, newDailyBest,
    };
    s.comboRemaining = 0;
    this.onEvent(outcome === 'win' ? 'impact' : 'catch', s.caughtBy);
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
    s.focusExhausted = this.focusExhausted;
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
    if (axis && !wasDashing) this.lastDirection = Math.sign(axis);
    if (wasDashing) s.velocity = s.dashDirection * 22;
    else {
      const desired = axis * 11.5 + s.wind;
      s.velocity += (desired - s.velocity) * (1 - Math.exp(-dt * 15));
    }
    s.x = clamp(s.x + s.velocity * dt, -MAX_X, MAX_X);
    if (Math.abs(s.x) === MAX_X) s.velocity = 0;
    this.addScore(worldDt * 9);
    this.comboTimer = Math.max(0, this.comboTimer - worldDt);
    s.comboRemaining = this.comboTimer;
    if (this.comboTimer === 0) s.combo = 0;

    for (const h of s.hazards) {
      const oldY = PLAYER_Y + oldDistance - h.at;
      const oldHandX = h.type === 'hunter' ? h.x : h.baseX + (h.type === 'sweep' ? Math.sin((oldDistance - h.at) * 0.23 + h.phase) * 1.05 : 0);
      h.y = PLAYER_Y + s.distance - h.at;
      if (h.type === 'hunter') {
        if (!h.locked && h.y > -11) {
          const target = clamp(s.x, h.baseX - HUNTER_REACH, h.baseX + HUNTER_REACH);
          h.targetX += (target - h.targetX) * (1 - Math.exp(-worldDt * 7));
          if (!h.trackingNotified) {
            h.trackingNotified = true;
            this.onEvent('tracking', { x: h.targetX, type: h.type, id: h.id });
          }
          if (h.y >= -7.2) {
            h.locked = true;
            this.onEvent('lock', { x: h.targetX, type: h.type, id: h.id });
          }
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
      const contact = h.active && sweptCatch(oldX, s.x, oldHandX, h.x, oldY, h.y, halfWidth);
      if (contact && !wasDashing) {
        s.caughtBy = { id: h.id, type: h.type, x: h.x, at: h.at };
        this.finish('caught');
        return;
      }
      if (contact && wasDashing) h.dashedThrough = true;
      const separation = nearSeparation(oldX, s.x, oldHandX, h.x, oldY, h.y);
      if (Number.isFinite(separation)) h.nearSeparation = Math.min(h.nearSeparation ?? Infinity, separation);
      if (h.y > PLAYER_Y + 1.15) {
        h.passed = true;
        h.stage = 'passed';
        h.active = false;
        if (!h.dashedThrough && h.nearSeparation !== null && h.nearSeparation >= halfWidth && h.nearSeparation < 2.2 && !this.nearWaves.has(h.at)) {
          this.nearWaves.add(h.at);
          s.nearMisses++;
          s.combo = Math.min(9, s.combo + 1);
          s.bestCombo = Math.max(s.bestCombo, s.combo);
          this.comboTimer = 3.6;
          s.comboRemaining = this.comboTimer;
          s.focus = Math.min(1, s.focus + 0.13);
          s.nearTimer = 0.25;
          const reward = 75 * s.combo;
          this.addScore(reward);
          this.onEvent('near', { x: h.x, type: h.type, id: h.id, reward });
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
          s.comboRemaining = this.comboTimer;
          s.focus = Math.min(1, s.focus + 0.26);
          const reward = 250 + s.combo * 40;
          this.addScore(reward);
          this.onEvent('risk', { x: p.x, id: p.id, reward });
        } else {
          s.focus = Math.min(1, s.focus + 0.18);
          const reward = 100 + s.combo * 20;
          this.addScore(reward);
          this.onEvent('drop', { x: p.x, id: p.id, reward });
        }
      } else if (p.y > PLAYER_Y + 1.2) p.passed = true;
    }
    if (s.distance >= s.height) this.finish('win');
  }
}
