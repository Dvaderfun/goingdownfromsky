import test from 'node:test';
import assert from 'node:assert/strict';
import { RainGame, LANES, PLAYER_Y, HUNTER_REACH, gradeRun, levelConfig, generateLevel, parseSave } from '../src/game.js';

const step = (game, seconds) => {
  for (let i = 0; i < Math.ceil(seconds / 0.02); i++) game.update(0.02);
};

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
  game.start(1, 7);
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
  game.start(1, 2);
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
  game.start(1, 8);
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
  a.start(1, 8); b.start(1, 8);
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
  game.start(2, 1);
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
  assert.deepEqual(parseSave('invalid'), { bestScore: 0, unlockedLevel: 1, muted: false, reducedMotion: false, impactMode: 'arcade', levelRecords: {} });
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
  game.start(1, 7);
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
  game.start(2, 3);
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
  game.start(1, 3);
  assert.equal(game.state.riskDrops, 0);
  assert.equal(game.state.nearTimer, 0);
  assert.equal(game.state.pickupTimer, 0);
  assert.equal(game.state.launchProgress, 0);
  assert.ok(game.state.hazards.every(h => !h.locked));
});

test('risk drop awards its combo, score and focus once', () => {
  const game = new RainGame();
  game.start(1, 1);
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
  game.start(1, 1);
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
  game.start(1, 1);
  Object.assign(game.state, { nearMisses: 12, riskDrops: 4, drops: 4, bestCombo: 9 });
  game.finish('win');
  assert.equal(game.state.lastResult.grade, 'S');
  assert.equal(game.state.lastResult.newLevelBest, false);
  assert.deepEqual(savedRecord, { score: 10000, grade: 'S' });
  game.start(1, 1);
  game.finish('caught');
  assert.equal(game.state.lastResult.grade, null);
  assert.deepEqual(game.state.levelRecords['1'], { score: 10000, grade: 'S' });
});

test('launch and fall intensity ramp smoothly while frame hitch protection remains', () => {
  const game = new RainGame();
  game.start(1, 1);
  game.state.hazards = [];
  game.state.pickups = [];
  assert.equal(game.state.launchProgress, 0);
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
  game.start(1, 1);
  assert.equal(game.state.runImpactMode, 'hard');
  assert.equal(game.setImpactMode('arcade'), false);
  assert.equal(game.state.runImpactMode, 'hard');
  game.menu();
  assert.equal(game.setImpactMode('arcade'), true);
  game.start(1, 1);
  assert.equal(game.state.runImpactMode, 'arcade');
});

test('hard landing allows the physics cinematic, while arcade keeps its old timing', () => {
  const hard = new RainGame({ saved: { impactMode: 'hard' } });
  hard.start(1, 1);
  hard.finish('win');
  step(hard, 1.5);
  assert.equal(hard.state.mode, 'impact');
  assert.equal(hard.state.lastResult.runImpactMode, 'hard');
  step(hard, 2.2);
  assert.equal(hard.state.mode, 'result');
  const arcade = new RainGame();
  arcade.start(1, 1);
  arcade.finish('win');
  step(arcade, 1.4);
  assert.equal(arcade.state.mode, 'result');
  assert.equal(arcade.state.lastResult.runImpactMode, 'arcade');
});

test('catch timing and replay preserve the selected style without running a landing', () => {
  const game = new RainGame({ saved: { impactMode: 'hard' } });
  game.start(1, 1);
  game.finish('caught');
  step(game, 1);
  assert.equal(game.state.mode, 'result');
  assert.equal(game.state.outcome, 'caught');
  game.start(1, 2);
  assert.equal(game.state.impactMode, 'hard');
  assert.equal(game.state.runImpactMode, 'hard');
  assert.equal(game.state.outcome, null);
});

test('reserved lanes remain traversable through hunters at every difficulty tier', () => {
  for (const level of [1, 3, 5, 10, 20]) {
    for (let seed = 0; seed < 20; seed++) {
      const game = new RainGame();
      game.start(level, seed);
      let iterations = 0;
      while (game.state.mode === 'playing' && iterations++ < 15000) {
        const wave = game.waves.find(w => w.at > game.state.distance - 0.85);
        if (wave) game.point(LANES[wave.safeLane]);
        game.update(1 / 120);
      }
      assert.equal(game.state.outcome, 'win', `Reserved path failed: level ${level}, seed ${seed}, distance ${game.state.distance}`);
    }
  }
});
