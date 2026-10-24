import test from 'node:test';
import assert from 'node:assert/strict';
import { RainGame, LANES, PLAYER_Y, HUNTER_REACH, INTRO_DURATION, gradeRun, levelConfig, generateLevel, parseSave, dailyChallenge } from '../src/game.js';

const step = (game, seconds) => {
  for (let i = 0; i < Math.ceil(seconds / 0.02); i++) game.update(0.02);
};

const attemptProgress = game => {
  const { distance, elapsed, score, focus, dashTimer, dashCooldown, x, velocity, combo, drops, nearMisses } = game.state;
  return { distance, elapsed, score, focus, dashTimer, dashCooldown, x, velocity, combo, drops, nearMisses };
};

test('start opens a real rooftop intro and leaves the attempt clock untouched', () => {
  const game = new RainGame();
  game.start(1, 7);
  assert.equal(game.state.mode, 'intro');
  assert.equal(game.state.introTime, 0);
  assert.equal(game.state.introProgress, 0);
  assert.equal(game.state.introStage, 'roof');
  assert.equal(game.state.launchProgress, 0);
  const before = attemptProgress(game);
  const hazards = structuredClone(game.state.hazards);
  const pickups = structuredClone(game.state.pickups);
  step(game, 1.5);
  assert.equal(game.state.mode, 'intro');
  assert.equal(game.state.introStage, 'approach');
  assert.deepEqual(attemptProgress(game), before);
  assert.deepEqual(game.state.hazards, hazards);
  assert.deepEqual(game.state.pickups, pickups);
});

test('intro blocks movement, pointer, dash and focus without carrying held inputs into flight', () => {
  const events = [];
  const game = new RainGame({ onEvent: name => events.push(name) });
  game.start(1, 7);
  game.move(1);
  game.point(-6);
  game.slow(true);
  assert.equal(game.dash(), false);
  const before = attemptProgress(game);
  step(game, 0.5);
  assert.deepEqual(attemptProgress(game), before);
  assert.equal(game.axis, 0);
  assert.equal(game.targetX, null);
  assert.equal(game.slowHeld, false);
  assert.equal(game.state.slow, false);
  assert.equal(events.includes('dash'), false);
  game.skipIntro();
  game.state.hazards = [];
  game.state.pickups = [];
  game.update(0.02);
  assert.equal(game.state.x, 0);
  assert.equal(game.state.slow, false);
});

test('intro stages progress in order and takeoff fires once before natural gameplay', () => {
  const events = [];
  const game = new RainGame({ onEvent: name => events.push(name) });
  game.start(1, 7);
  const stages = [game.state.introStage];
  while (game.state.introTime < INTRO_DURATION - 0.04) {
    game.update(0.02);
    if (stages.at(-1) !== game.state.introStage) stages.push(game.state.introStage);
    assert.equal(game.state.distance, 0);
    assert.equal(game.state.elapsed, 0);
    assert.equal(game.state.score, 0);
    assert.equal(game.state.launchProgress, game.state.introProgress);
  }
  assert.deepEqual(stages, ['roof', 'approach', 'jump', 'transition']);
  assert.equal(events.filter(name => name === 'takeoff').length, 1);
  game.update(0.05);
  assert.equal(game.state.mode, 'playing');
  assert.equal(game.state.introTime, INTRO_DURATION);
  assert.equal(game.state.introProgress, 1);
  assert.equal(game.state.introStage, 'complete');
  assert.equal(game.state.launchProgress, 1);
  assert.equal(game.state.distance, 0);
  assert.equal(game.state.elapsed, 0);
  game.state.hazards = [];
  game.state.pickups = [];
  step(game, 0.2);
  assert.ok(game.state.distance > 0);
  assert.ok(game.state.elapsed > 0);
  assert.equal(game.state.launchProgress, 1);
  assert.equal(events.filter(name => name === 'takeoff').length, 1);
});

test('skip works from every intro stage, starts clean and cannot replay takeoff', () => {
  for (const time of [0, 1, 1.9, 2.8]) {
    const events = [];
    const game = new RainGame({ onEvent: name => events.push(name) });
    game.start(1, 7);
    step(game, time);
    assert.equal(game.skipIntro(), true);
    assert.equal(game.state.mode, 'playing');
    assert.equal(game.state.introTime, INTRO_DURATION);
    assert.equal(game.state.introProgress, 1);
    assert.equal(game.state.introStage, 'complete');
    assert.equal(game.state.launchProgress, 1);
    assert.equal(game.state.distance, 0);
    assert.equal(game.state.elapsed, 0);
    assert.equal(game.state.score, 0);
    assert.equal(game.skipIntro(), false);
    assert.equal(events.filter(name => name === 'takeoff').length, 1);
  }
});

test('pause and resume preserve the intro frame and resume mode', () => {
  const game = new RainGame();
  game.start(1, 7);
  step(game, 1);
  game.pause();
  assert.equal(game.state.mode, 'paused');
  assert.equal(game.state.resumeMode, 'intro');
  const before = structuredClone(game.state);
  step(game, 1);
  assert.equal(game.state.introTime, before.introTime);
  assert.equal(game.state.introProgress, before.introProgress);
  assert.equal(game.state.introStage, before.introStage);
  assert.deepEqual(attemptProgress(game), attemptProgress({ state: before }));
  assert.equal(game.skipIntro(), false);
  game.resume();
  assert.equal(game.state.mode, 'intro');
  game.update(0.02);
  assert.ok(game.state.introTime > before.introTime);
  game.skipIntro();
  game.pause();
  assert.equal(game.state.resumeMode, 'playing');
  game.resume();
  assert.equal(game.state.mode, 'playing');
});

test('menu and retry reset intro while keeping the saved landing style and snapshot', () => {
  const game = new RainGame({ saved: { impactMode: 'hard' } });
  game.start(2, 7);
  step(game, 1.9);
  const snapshot = JSON.parse(JSON.stringify(game.state));
  assert.equal(snapshot.mode, 'intro');
  assert.equal(snapshot.introStage, 'jump');
  assert.equal(snapshot.runImpactMode, 'hard');
  assert.equal(snapshot.outcome, null);
  assert.equal(game.setImpactMode('arcade'), false);
  game.pause();
  game.menu();
  assert.equal(game.state.mode, 'menu');
  assert.equal(game.state.outcome, null);
  assert.equal(game.state.distance, 0);
  game.start(2, 8);
  assert.equal(game.state.mode, 'intro');
  assert.equal(game.state.introStage, 'roof');
  assert.equal(game.state.introTime, 0);
  assert.equal(game.state.introProgress, 0);
  assert.equal(game.state.runImpactMode, 'hard');
  game.skipIntro();
  game.finish('caught');
  step(game, 1);
  game.start(2, 8);
  assert.equal(game.state.mode, 'intro');
  assert.equal(game.state.outcome, null);
  assert.equal(game.state.introStage, 'roof');
});

test('explicit gameplay fixtures skip intro and frame hitches cannot skip the whole cutscene', () => {
  const game = new RainGame();
  game.start(1, 7, { skipIntro: true });
  assert.equal(game.state.mode, 'playing');
  assert.equal(game.state.introStage, 'complete');
  assert.equal(game.state.launchProgress, 1);
  game.start(1, 7);
  game.update(20);
  assert.equal(game.state.mode, 'intro');
  assert.equal(game.state.introStage, 'roof');
  assert.ok(game.state.introTime <= 0.05);
  assert.equal(game.state.distance, 0);
});

test('height, speed and obstacle density increase, movement corridor stays reachable', () => {
  assert.ok(levelConfig(2).height > levelConfig(1).height);
  assert.ok(levelConfig(4).waveSize > levelConfig(1).waveSize);
  assert.ok(levelConfig(8).speed > levelConfig(1).speed);
  for (const level of [1, 2, 4, 9, 20]) {
    for (let seed = 0; seed < 40; seed++) {
      const layout = generateLevel(level, seed);
      let previous = 2;
      for (const wave of layout.waves) {
        assert.ok(!wave.blocked.includes(wave.safeLane));
        assert.ok(wave.blocked.length <= 3);
        assert.ok(Math.abs(wave.safeLane - previous) <= 1);
        assert.equal(new Set(wave.blocked).size, wave.blocked.length);
        for (const hazard of layout.hazards.filter(h => h.at === wave.at)) {
          assert.ok(Math.abs(hazard.baseX - LANES[wave.safeLane]) >= 3);
        }
        previous = wave.safeLane;
      }
    }
  }
});

test('level generation is deterministic for retryable test layouts', () => {
  assert.deepEqual(generateLevel(3, 42), generateLevel(3, 42));
  assert.notDeepEqual(generateLevel(3, 42).hazards, generateLevel(3, 43).hazards);
});

function collisionFixture() {
  const events = [];
  const game = new RainGame({ onEvent: e => events.push(e) });
  game.start(1, 7, { skipIntro: true });
  game.state.hazards = [{ id: 'test', at: 1, baseX: 0, x: 0, y: PLAYER_Y - 1, type: 'grab', phase: 0, warning: 1, active: true, passed: false }];
  game.state.pickups = [];
  return { game, events };
}

test('catch is a loss, settles into result and retry fully resets transient state', () => {
  const { game, events } = collisionFixture();
  step(game, 0.2);
  assert.equal(game.state.mode, 'caught');
  assert.equal(game.state.outcome, 'caught');
  assert.ok(events.includes('catch'));
  step(game, 1);
  assert.equal(game.state.mode, 'result');
  game.start(1, 2, { skipIntro: true });
  assert.equal(game.state.outcome, null);
  assert.equal(game.state.elapsed, 0);
  assert.equal(game.state.dashTimer, 0);
  assert.equal(game.state.combo, 0);
  assert.equal(game.state.distance, 0);
});

test('dash protects through hand, cannot be spammed, and stays within facade', () => {
  const { game } = collisionFixture();
  assert.equal(game.dash(), true);
  assert.equal(game.dash(), false);
  step(game, 0.25);
  assert.equal(game.state.mode, 'playing');
  assert.ok(Math.abs(game.state.x) <= 7.1);
  game.move(1);
  step(game, 2);
  assert.ok(game.state.x <= 7.1);
});

test('pause freezes gameplay and clears held slow and movement', () => {
  const game = new RainGame();
  game.start(1, 8, { skipIntro: true });
  game.slow(true);
  game.move(1);
  step(game, 0.1);
  game.pause();
  const { distance, x, focus, dashCooldown, elapsed } = game.state;
  step(game, 1);
  assert.deepEqual({ distance: game.state.distance, x: game.state.x, focus: game.state.focus, dashCooldown: game.state.dashCooldown, elapsed: game.state.elapsed }, { distance, x, focus, dashCooldown, elapsed });
  game.resume();
  game.update(0.02);
  assert.equal(game.state.slow, false);
  assert.equal(game.axis, 0);
});

test('slow reduces fall distance while retaining responsive horizontal control', () => {
  const a = new RainGame();
  const b = new RainGame();
  a.start(1, 8, { skipIntro: true }); b.start(1, 8, { skipIntro: true });
  a.move(1); b.move(1); b.slow(true);
  step(a, 0.5); step(b, 0.5);
  assert.ok(b.state.distance < a.state.distance * 0.5);
  assert.equal(b.state.x, a.state.x);
  assert.ok(b.state.focus < a.state.focus);
});

test('near miss awards combo/focus once; drops are collected only once', () => {
  const { game, events } = collisionFixture();
  game.state.x = 1.7;
  game.state.pickups = [{ id: 'drop', at: 2, x: 1.7, y: PLAYER_Y - 2, collected: false }];
  step(game, 0.5);
  assert.equal(game.state.nearMisses, 1);
  assert.equal(game.state.combo, 1);
  assert.equal(game.state.drops, 1);
  assert.equal(events.filter(e => e === 'near').length, 1);
  assert.equal(events.filter(e => e === 'drop').length, 1);
  assert.ok(game.state.score >= 175);
});

test('landing completes level, awards bonus, saves record and unlocks next tower', () => {
  const game = new RainGame();
  game.start(2, 1, { skipIntro: true });
  game.state.hazards = [];
  game.state.pickups = [];
  game.state.distance = game.state.height - 0.1;
  game.update(0.02);
  assert.equal(game.state.mode, 'impact');
  assert.equal(game.state.outcome, 'win');
  assert.equal(game.state.unlockedLevel, 3);
  assert.equal(game.state.progress, 1);
  assert.equal(game.state.lastResult.newBest, true);
  assert.ok(game.state.score >= 450);
  step(game, 1.4);
  assert.equal(game.state.mode, 'result');
});

test('storage tolerates malformed and impossible values without breaking startup', () => {
  assert.deepEqual(parseSave('invalid'), { bestScore: 0, unlockedLevel: 1, muted: false, reducedMotion: false, impactMode: 'arcade', levelRecords: {}, dailyRecords: {} });
  assert.equal(parseSave('{"bestScore":-10,"unlockedLevel":0}').bestScore, 0);
  assert.equal(parseSave('{"unlockedLevel":0}').unlockedLevel, 1);
  assert.equal(parseSave('{"bestScore":125.9,"unlockedLevel":3,"muted":true}').bestScore, 125);
  assert.equal(parseSave('null').unlockedLevel, 1);
});

test('large frame hitches cannot skip a catch or advance the whole level', () => {
  const { game } = collisionFixture();
  game.update(20);
  assert.ok(game.state.distance <= 0.55);
  assert.equal(game.state.mode, 'caught');
});

test('holding at the edge cannot bypass every outside window', () => {
  const { game } = collisionFixture();
  game.state.x = 6.65;
  game.state.hazards[0].baseX = 6;
  step(game, 0.2);
  assert.equal(game.state.mode, 'caught');
});

test('swept collision catches horizontal entry during the trailing vertical interval', () => {
  const { game } = collisionFixture();
  Object.assign(game.state, { speed: 20, distance: 1.4, x: 1, velocity: -11.5 });
  game.move(-1);
  game.update(0.05);
  assert.equal(game.state.mode, 'caught');
});

test('sweep cannot catch after the player has left its vertical interval', () => {
  const { game } = collisionFixture();
  Object.assign(game.state, { speed: 20, distance: 1.65, x: 0.96, velocity: 0 });
  Object.assign(game.state.hazards[0], { type: 'sweep', phase: -0.65 * 0.23 });
  game.update(0.05);
  assert.equal(game.state.mode, 'playing');
});

test('exhausted focus stays off while held and can reactivate after release', () => {
  const game = new RainGame();
  game.start(1, 7, { skipIntro: true });
  game.state.hazards = [];
  game.state.pickups = [];
  game.state.focus = 0.026;
  game.slow(true);
  game.update(0.02);
  assert.equal(game.state.slow, true);
  step(game, 3);
  assert.equal(game.state.slow, false);
  assert.equal(game.focusExhausted, true);
  game.slow(false);
  game.slow(true);
  game.update(0.02);
  assert.equal(game.state.slow, true);
  assert.equal(parseSave('{"unlockedLevel":1000}').unlockedLevel, 1000);
});

test('first tower teaches with authored waves, two hunters and optional risk routes', () => {
  const { waves, hazards, pickups } = generateLevel(1, 42);
  assert.equal(waves.length, 14);
  assert.equal(hazards[0].baseX, 6);
  assert.equal(hazards[1].baseX, -6);
  assert.deepEqual(hazards.filter(h => h.type === 'hunter').map(h => h.at), [90, 130]);
  assert.ok(pickups.filter(p => p.risk).length >= 4);
  assert.ok(pickups.some(p => !p.risk && p.at === 34 && p.x === 0));
  for (const pickup of pickups.filter(p => p.risk)) {
    const hand = hazards.find(h => h.at === pickup.at);
    assert.ok(Math.abs(pickup.x - hand.baseX) > 1.06);
    assert.ok(Math.abs(pickup.x - LANES[waves.find(w => w.at === pickup.at).safeLane]) > 0.5);
  }
});

function hunterFixture() {
  const events = [];
  const game = new RainGame({ onEvent: event => events.push(event) });
  game.start(2, 3, { skipIntro: true });
  game.state.pickups = [];
  game.state.distance = 18;
  game.state.x = 6;
  const hunter = { id: 'hunter-test', at: 30, baseX: 0, x: 0, targetX: 0, y: -10.8, type: 'hunter', phase: 0.2, locked: false, warning: 0, active: false, passed: false };
  game.state.hazards = [hunter];
  return { game, hunter, events };
}

test('hunter tracks within reach, gives a lock cue, then keeps the exact target', () => {
  const { game, hunter, events } = hunterFixture();
  game.update(0.02);
  assert.equal(hunter.stage, 'tracking');
  assert.ok(hunter.x > 0 && hunter.x <= HUNTER_REACH);
  for (let i = 0; i < 100 && !hunter.locked; i++) game.update(0.02);
  assert.equal(hunter.stage, 'locked');
  assert.equal(hunter.active, false);
  assert.ok(hunter.y < -4.5);
  const lockedX = hunter.x;
  game.state.x = -6;
  step(game, 1.5);
  assert.equal(hunter.x, lockedX);
  assert.equal(events.filter(event => event === 'tracking').length, 1);
  assert.equal(events.filter(event => event === 'lock').length, 1);
  assert.equal(game.state.mode, 'playing');
});

test('pause freezes tracking and visual feedback timers; retry clears all new state', () => {
  const { game, hunter } = hunterFixture();
  game.state.nearTimer = 0.2;
  game.state.pickupTimer = 0.3;
  game.update(0.02);
  game.pause();
  const before = [hunter.x, game.state.nearTimer, game.state.pickupTimer, game.state.launchProgress];
  step(game, 1);
  assert.deepEqual([hunter.x, game.state.nearTimer, game.state.pickupTimer, game.state.launchProgress], before);
  game.start(1, 3, { skipIntro: true });
  assert.equal(game.state.riskDrops, 0);
  assert.equal(game.state.nearTimer, 0);
  assert.equal(game.state.pickupTimer, 0);
  assert.equal(game.state.launchProgress, 1);
  assert.ok(game.state.hazards.every(h => !h.locked));
});

test('risk drop awards its combo, score and focus once', () => {
  const game = new RainGame();
  game.start(1, 1, { skipIntro: true });
  game.state.hazards = [];
  game.state.focus = 0.1;
  game.state.pickups = [{ id: 'risk-test', at: 1, x: 0, y: 0.2, risk: true, collected: false, passed: false }];
  step(game, 0.5);
  assert.equal(game.state.riskDrops, 1);
  assert.equal(game.state.drops, 1);
  assert.equal(game.state.combo, 1);
  assert.ok(game.state.score >= 290);
  assert.ok(game.state.focus >= 0.36);
  step(game, 0.5);
  assert.equal(game.state.riskDrops, 1);
});

test('dash collects a narrow risk drop crossed between two rendered frames', () => {
  const game = new RainGame();
  game.start(1, 1, { skipIntro: true });
  game.state.hazards = [];
  game.state.x = -0.55;
  game.state.pickups = [{ id: 'swept-risk', at: 1, x: 0, y: 0.2, risk: true, collected: false, passed: false }];
  game.dash();
  game.update(0.05);
  assert.equal(game.state.pickups[0].collected, true);
  assert.equal(game.state.riskDrops, 1);
});

test('style grades reward close passes, risk and combo without requiring them to win', () => {
  assert.equal(gradeRun({}, 10), 'C');
  assert.equal(gradeRun({ nearMisses: 3 }, 10), 'B');
  assert.equal(gradeRun({ nearMisses: 6 }, 10), 'A');
  assert.equal(gradeRun({ riskDrops: 4, drops: 4, bestCombo: 6 }, 10), 'S');
});

test('legacy saves remain valid and malformed per-tower records are filtered', () => {
  assert.deepEqual(parseSave('{"bestScore":123,"unlockedLevel":3}').levelRecords, {});
  const save = parseSave('{"levelRecords":{"1":{"score":600,"grade":"A"},"2":{"score":-1,"grade":"invalid"},"10001":{"score":1},"__proto__":{"score":1},"3":{"score":"500"}}}');
  assert.deepEqual(save.levelRecords, { '1': { score: 600, grade: 'A' }, '2': { score: 0, grade: null } });
});

test('tower record keeps best score and grade independently, and is saved before event', () => {
  let savedRecord;
  const game = new RainGame({ saved: { levelRecords: { '1': { score: 10000, grade: 'C' } } }, onEvent: name => { if (name === 'save') savedRecord = structuredClone(game.state.levelRecords['1']); } });
  game.start(1, 1, { skipIntro: true });
  Object.assign(game.state, { nearMisses: 12, riskDrops: 4, drops: 4, bestCombo: 9 });
  game.finish('win');
  assert.equal(game.state.lastResult.grade, 'S');
  assert.equal(game.state.lastResult.newLevelBest, false);
  assert.deepEqual(savedRecord, { score: 10000, grade: 'S' });
  game.start(1, 1, { skipIntro: true });
  game.finish('caught');
  assert.equal(game.state.lastResult.grade, null);
  assert.deepEqual(game.state.levelRecords['1'], { score: 10000, grade: 'S' });
});

test('flight acceleration and intensity ramp without replaying the completed intro', () => {
  const game = new RainGame();
  game.start(1, 1, { skipIntro: true });
  game.state.hazards = [];
  game.state.pickups = [];
  assert.equal(game.state.launchProgress, 1);
  assert.ok(game.state.fallSpeed < game.state.speed);
  step(game, 2);
  assert.equal(game.state.launchProgress, 1);
  assert.ok(game.state.fallSpeed >= game.state.speed);
  const earlyIntensity = game.state.fallIntensity;
  game.state.distance = game.state.height * 0.9;
  game.state.progress = 0.9;
  game.update(0.02);
  assert.ok(game.state.fallIntensity > earlyIntensity);
  assert.ok(game.state.fallSpeed > game.state.speed * 1.07);
});

test('impact style defaults to arcade for legacy and malformed saves', () => {
  assert.equal(parseSave(null).impactMode, 'arcade');
  assert.equal(parseSave('{"bestScore":600,"unlockedLevel":2}').impactMode, 'arcade');
  assert.equal(parseSave('{"impactMode":"invalid"}').impactMode, 'arcade');
  assert.equal(parseSave('{"impactMode":"hard"}').impactMode, 'hard');
  assert.equal(new RainGame().state.impactMode, 'arcade');
});

test('mode selection is saved in menu and locked for the current attempt', () => {
  const events = [];
  const game = new RainGame({ onEvent: name => events.push(name) });
  assert.equal(game.setImpactMode('hard'), true);
  assert.ok(events.includes('save'));
  game.start(1, 1, { skipIntro: true });
  assert.equal(game.state.runImpactMode, 'hard');
  assert.equal(game.setImpactMode('arcade'), false);
  assert.equal(game.state.runImpactMode, 'hard');
  game.menu();
  assert.equal(game.setImpactMode('arcade'), true);
  game.start(1, 1, { skipIntro: true });
  assert.equal(game.state.runImpactMode, 'arcade');
});

test('hard landing allows the physics cinematic, while arcade keeps its old timing', () => {
  const hard = new RainGame({ saved: { impactMode: 'hard' } });
  hard.start(1, 1, { skipIntro: true });
  hard.finish('win');
  step(hard, 1.5);
  assert.equal(hard.state.mode, 'impact');
  assert.equal(hard.state.lastResult.runImpactMode, 'hard');
  step(hard, 2.2);
  assert.equal(hard.state.mode, 'result');
  const arcade = new RainGame();
  arcade.start(1, 1, { skipIntro: true });
  arcade.finish('win');
  step(arcade, 1.4);
  assert.equal(arcade.state.mode, 'result');
  assert.equal(arcade.state.lastResult.runImpactMode, 'arcade');
});

test('catch timing and replay preserve the selected style without running a landing', () => {
  const game = new RainGame({ saved: { impactMode: 'hard' } });
  game.start(1, 1, { skipIntro: true });
  game.finish('caught');
  step(game, 1);
  assert.equal(game.state.mode, 'result');
  assert.equal(game.state.outcome, 'caught');
  game.start(1, 2, { skipIntro: true });
  assert.equal(game.state.impactMode, 'hard');
  assert.equal(game.state.runImpactMode, 'hard');
  assert.equal(game.state.outcome, null);
});

function playVisibleRoute(game, { risk = false, dt = 1 / 120 } = {}) {
  const plans = new Map();
  let previousGoal = 0;
  let iterations = 0;
  while (game.state.mode === 'playing' && iterations++ < 20000) {
    const visible = game.state.hazards.filter(h => h.warning > 0 && h.at > game.state.distance - 0.85);
    const rows = [...new Set(visible.map(h => h.at))].sort((a, b) => a - b);
    for (const at of rows) {
      if (plans.has(at)) continue;
      const windows = visible.filter(h => h.at === at);
      const available = LANES.filter(x => windows.every(h => Math.abs(x - h.baseX) >= 3));
      available.sort((a, b) => Math.abs(a - previousGoal) - Math.abs(b - previousGoal));
      const drop = risk && game.state.pickups.find(p => p.risk && p.at === at && p.y > -14);
      const target = drop ? drop.x : available[0];
      plans.set(at, { target, time: game.state.elapsed + 0.15 });
      previousGoal = target;
    }
    const next = plans.get(rows[0]);
    if (next && game.state.elapsed >= next.time) {
      game.point(next.target);
      game.slow(Math.abs(next.target - game.state.x) > (risk ? 1.25 : 1.5));
    } else game.slow(false);
    game.update(dt);
  }
}

test('visible routes remain traversable with a 150 ms reaction delay and focus', () => {
  for (const level of [1, 3, 5, 10, 20]) {
    for (let seed = 0; seed < 8; seed++) {
      const game = new RainGame();
      game.start(level, seed, { skipIntro: true });
      playVisibleRoute(game);
      assert.equal(game.state.outcome, 'win', `Reserved path failed: level ${level}, seed ${seed}, distance ${game.state.distance}`);
    }
  }
});

test('optional risk routes can be completed from visible cues with a 150 ms reaction delay', () => {
  for (const level of [1, 3, 5, 10, 20]) {
    for (let seed = 0; seed < 3; seed++) {
      const game = new RainGame();
      game.start(level, seed, { skipIntro: true });
      const risks = game.state.pickups.filter(p => p.risk).length;
      playVisibleRoute(game, { risk: true, dt: seed % 2 ? 1 / 60 : 1 / 120 });
      assert.equal(game.state.outcome, 'win', `Risk route failed: level ${level}, seed ${seed}, distance ${game.state.distance}`);
      assert.equal(game.state.riskDrops, risks, `Risk route missed a drop: level ${level}, seed ${seed}`);
    }
  }
});

test('near misses use only the shared vertical band rather than the exit position', () => {
  const escaping = collisionFixture().game;
  Object.assign(escaping.state, { distance: 1.65, x: 1.7, velocity: 11.5, speed: 20 });
  escaping.move(1);
  escaping.update(0.05);
  assert.ok(escaping.state.x > 2.2);
  assert.equal(escaping.state.nearMisses, 1, 'a real close pass survives moving away after the danger band');

  const late = collisionFixture().game;
  Object.assign(late.state, { distance: 1.65, x: 2.7, velocity: -11.5, speed: 20 });
  late.move(-1);
  late.update(0.05);
  assert.ok(late.state.x < 2.2);
  assert.equal(late.state.nearMisses, 0, 'moving closer after the danger band is not a close pass');
});

test('dash through a catch band does not earn a near miss and one wave earns only one credit', () => {
  const dash = collisionFixture().game;
  dash.state.x = -1.2;
  dash.dash();
  step(dash, 0.5);
  assert.equal(dash.state.outcome, null);
  assert.equal(dash.state.hazards[0].dashedThrough, true);
  assert.equal(dash.state.nearMisses, 0);

  const paired = collisionFixture().game;
  paired.state.hazards = [-1.7, 1.7].map((x, index) => ({
    ...paired.state.hazards[0], id: `pair-${index}`, x, baseX: x,
  }));
  step(paired, 0.5);
  assert.ok(paired.state.hazards.every(h => h.passed));
  assert.equal(paired.state.nearMisses, 1);
});

test('near and dash-through rewards agree at 20, 60 and 120 FPS', () => {
  for (const fps of [20, 60, 120]) {
    const near = collisionFixture().game;
    near.state.x = 1.7;
    for (let frame = 0; frame < fps / 2; frame++) near.update(1 / fps);
    assert.equal(near.state.nearMisses, 1, `close pass at ${fps} FPS`);
    const dash = collisionFixture().game;
    dash.state.x = -1.2;
    dash.dash();
    for (let frame = 0; frame < fps / 2; frame++) dash.update(1 / fps);
    assert.equal(dash.state.outcome, null);
    assert.equal(dash.state.nearMisses, 0, `dash-through pass at ${fps} FPS`);
  }
});

test('touch dash keeps its initial direction when it crosses the pointer target', () => {
  const game = new RainGame();
  game.start(1, 1, { skipIntro: true });
  game.state.hazards = [];
  game.state.pickups = [];
  game.point(3);
  game.dash();
  assert.equal(game.state.dashDirection, 1);
  let previous = game.state.x;
  for (let i = 0; i < 6; i++) {
    if (i === 3) game.point(-3);
    game.update(0.05);
    assert.ok(game.state.x >= previous, 'pointer changes cannot reverse an active dash');
    previous = game.state.x;
  }
  assert.equal(game.state.dashDirection, 1);
});

test('first tower forces each stationary lane to confront a warned window', () => {
  const layout = generateLevel(1, 42);
  assert.deepEqual([...new Set(layout.waves.flatMap(w => w.blocked))].sort(), [0, 1, 2, 3, 4]);
  for (const x of LANES) {
    const game = new RainGame();
    game.start(1, 42, { skipIntro: true });
    game.point(x);
    let warned = false;
    let frames = 0;
    while (game.state.mode === 'playing' && frames++ < 4000) {
      if (game.state.hazards.some(h => h.baseX === x && h.warning > 0 && h.y < -4.5)) warned = true;
      game.update(1 / 120);
    }
    assert.equal(game.state.outcome, 'caught', `stationary lane ${x} escaped the tutorial`);
    assert.equal(warned, true);
    assert.ok(game.state.caughtBy);
  }
});

test('seeded wave phrases contain rest gaps on the facade grid and optional safe risk drops', () => {
  for (const level of [2, 3, 5, 10, 20]) {
    for (let seed = 0; seed < 40; seed++) {
      const { config, hazards, pickups, waves } = generateLevel(level, seed);
      assert.deepEqual([...new Set(waves.map(w => w.pattern))].sort(), ['hunter', 'rest', 'risk', 'weave']);
      assert.ok(waves.some((wave, index) => index > 0 && wave.at - waves[index - 1].at === 20));
      for (const [index, wave] of waves.entries()) {
        assert.equal(wave.at % 10, 0);
        if (index) assert.ok([10, 20].includes(wave.at - waves[index - 1].at));
      }
      const risks = pickups.filter(p => p.risk);
      assert.ok(risks.length > 0);
      for (const pickup of risks) {
        const wave = waves.find(w => w.at === pickup.at);
        assert.ok(Math.abs(pickup.x - LANES[wave.safeLane]) <= 1.25);
        for (const hazard of hazards.filter(h => h.at === pickup.at)) {
          const reach = hazard.type === 'sweep' ? 1.05 : hazard.type === 'hunter' ? HUNTER_REACH : 0;
          const width = hazard.type === 'long' ? 1.06 : 0.85;
          assert.ok(Math.abs(pickup.x - hazard.baseX) > reach + width + 0.5, 'risk pickup intersects another catch band');
        }
      }
      if (level >= 10) assert.equal(config.height, 720);
    }
  }
});

test('late towers cap length and cycle district identity', () => {
  assert.equal(levelConfig(10).floors, 72);
  assert.equal(levelConfig(100).height, 720);
  assert.equal(levelConfig(100).floors, 72);
  assert.equal(levelConfig(6).levelName, levelConfig(1).levelName);
  assert.equal(levelConfig(100).district, 4);
  const game = new RainGame({ saved: { unlockedLevel: 10000 } });
  game.start(10000, 1, { skipIntro: true });
  game.finish('win');
  assert.equal(game.state.unlockedLevel, 10000);
});

test('style uses opportunity shares and a constant combo contribution across tower sizes', () => {
  const result = multiplier => {
    const game = new RainGame();
    game.start(1, 1, { skipIntro: true });
    game.styleOpportunities = { nearOpportunities: 14 * multiplier, riskOpportunities: 4 * multiplier, dropOpportunities: 10 * multiplier };
    Object.assign(game.state, { nearMisses: 7 * multiplier, riskDrops: 2 * multiplier, drops: 7 * multiplier, bestCombo: 9 });
    game.finish('win');
    return game.state.lastResult;
  };
  const short = result(1);
  const long = result(3);
  assert.equal(short.grade, 'A');
  assert.equal(short.style.value, long.style.value);
  assert.equal(short.grade, long.grade);
  assert.equal(gradeRun({ nearMisses: 7, riskDrops: 2, drops: 7, bestCombo: 9 }, {
    nearOpportunities: 14, riskOpportunities: 4, dropOpportunities: 10,
  }), 'A');
  assert.equal(short.style.nextGrade, 'S');
  assert.ok(short.style.nearNeeded > 0 && short.style.nearNeeded <= 7);
  assert.match(short.style.goal, /До S/);
});

test('focus preserves combo rhythm and exposes its exhaustion and remaining time', () => {
  const game = collisionFixture().game;
  game.state.x = 1.7;
  step(game, 0.5);
  game.state.hazards = [];
  const before = game.state.comboRemaining;
  game.slow(true);
  step(game, 0.5);
  assert.ok(before - game.state.comboRemaining < 0.21);
  game.state.focus = 0.02;
  game.update(0.02);
  assert.equal(game.state.focusExhausted, true);
  game.slow(false);
  assert.equal(game.state.focusExhausted, false);
});

test('catch and hunter cues expose their concrete window and progress', () => {
  const details = [];
  const game = new RainGame({ onEvent: (name, detail) => details.push({ name, detail }) });
  game.start(1, 7, { skipIntro: true });
  game.state.hazards = collisionFixture().game.state.hazards;
  game.state.pickups = [];
  step(game, 0.2);
  assert.deepEqual(game.state.lastResult.caughtBy, { id: 'test', type: 'grab', x: 0, at: 1 });
  assert.equal(game.state.lastResult.progress, game.state.distance / game.state.height);
  assert.deepEqual(details.find(e => e.name === 'catch').detail, game.state.caughtBy);
  const hunterGame = hunterFixture().game;
  hunterGame.onEvent = (name, detail) => details.push({ name, detail });
  step(hunterGame, 1);
  for (const name of ['tracking', 'lock']) {
    const cue = details.find(e => e.name === name).detail;
    assert.equal(cue.type, 'hunter');
    assert.equal(cue.id, 'hunter-test');
    assert.ok(Number.isFinite(cue.x));
  }
});

test('daily challenge is deterministic in Kyiv time and records stay isolated from tower progress', () => {
  const a = dailyChallenge(new Date('2026-10-23T21:30:00Z'));
  const b = dailyChallenge(new Date('2026-10-24T20:30:00Z'));
  assert.deepEqual(a, b);
  assert.equal(a.date, '2026-10-24');
  assert.equal(a.level, 3);
  assert.notEqual(a.seed, dailyChallenge(new Date('2026-10-24T21:30:00Z')).seed);
  assert.equal(dailyChallenge(new Date('2026-10-25T22:30:00Z')).date, '2026-10-26');
  let saved;
  const game = new RainGame({ saved: { bestScore: 25, unlockedLevel: 1, levelRecords: { '1': { score: 25, grade: 'C' } } },
    onEvent: name => { if (name === 'save') saved = structuredClone(game.state.dailyRecords); } });
  game.start(a.level, a.seed, { skipIntro: true, dailyDate: a.date });
  const firstLayout = structuredClone(game.state.hazards);
  game.addScore(1200);
  game.finish('win');
  assert.equal(game.state.unlockedLevel, 1);
  assert.equal(game.state.bestScore, 25);
  assert.deepEqual(game.state.levelRecords, { '1': { score: 25, grade: 'C' } });
  assert.equal(game.state.lastResult.newDailyBest, true);
  assert.equal(game.state.lastResult.dailyDate, a.date);
  assert.equal(saved[a.date].score, game.state.lastResult.dailyScore);
  const record = structuredClone(saved);
  game.start(a.level, a.seed, { skipIntro: true, dailyDate: a.date });
  assert.deepEqual(game.state.hazards, firstLayout);
  game.finish('caught');
  assert.deepEqual(game.state.dailyRecords, record);
  game.menu();
  assert.equal(game.state.dailyDate, null);
  game.start(1, 4, { skipIntro: true });
  game.finish('win');
  assert.equal(game.state.unlockedLevel, 2);
  assert.deepEqual(game.state.dailyRecords, record);
});

test('daily saves reject invalid dates and bound stored scores and record count', () => {
  const dailyRecords = {
    '2026-02-30': { score: 20, grade: 'S' }, '__proto__': { score: 10 },
    '2026-10-24': { score: 125.9, grade: 'A' }, '2026-10-25': { score: -5, grade: 'bad' },
    '2026-10-26': { score: '900', grade: 'S' },
  };
  assert.deepEqual(parseSave(JSON.stringify({ dailyRecords })).dailyRecords, {
    '2026-10-25': { score: 0, grade: null }, '2026-10-24': { score: 125, grade: 'A' },
  });
  const many = {};
  for (let day = 0; day < 500; day++) {
    const date = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10);
    many[date] = { score: 1e12, grade: 'B' };
  }
  const bounded = parseSave(JSON.stringify({ dailyRecords: many })).dailyRecords;
  assert.equal(Object.keys(bounded).length, 366);
  assert.equal(bounded['2025-01-01'], undefined);
  assert.ok(Object.values(bounded).every(record => record.score === 999999999));
});
