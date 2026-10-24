import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'artifacts');
await mkdir(output, { recursive: true });
const port = 5174;
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', `${port}`, '--strictPort'], { cwd: root, windowsHide: true, stdio: 'pipe' });
let serverLog = '';
server.stdout.on('data', data => { serverLog += data; });
server.stderr.on('data', data => { serverLog += data; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
let page;
const errors = [];
const snapshots = {};
const snapshot = () => page.evaluate(() => window.__RAIN_PAIN__.snapshot());
const layoutSignature = state => JSON.stringify({
  hazards: state.hazards.map(({ at, baseX, type, phase }) => ({ at, baseX, type, phase })),
  pickups: state.pickups.map(({ at, x, risk }) => ({ at, x, risk })),
});

async function action(name) {
  const selector = `[data-action="${name}"]:visible`;
  const dialogAction = page.locator('[role="dialog"]:visible').locator(selector);
  const target = await dialogAction.count() ? dialogAction.first() : page.locator(selector).first();
  await target.click();
}

async function steerUntilResult(intent = 'win', captureHardLanding = false) {
  const deadline = Date.now() + 45000;
  let held = null;
  let impactTime = null;
  let capturedHard = false;
  while (Date.now() < deadline) {
    const s = await snapshot();
    if (s.mode === 'result') {
      if (held) await page.keyboard.up(held);
      return s;
    }
    if (s.mode !== 'playing') {
      if (captureHardLanding && s.mode === 'impact') {
        impactTime ??= s.time;
        if (!capturedHard && s.time - impactTime > 0.8) {
          snapshots.hardLanding = await page.evaluate(() => window.__RAIN_PAIN__.landing());
          assert.equal(snapshots.hardLanding.active, true);
          assert.ok(snapshots.hardLanding.contacts > 0, 'Hard landing contacts the floor');
          assert.ok(snapshots.hardLanding.stainCount > 0, 'Hard landing leaves blood on the ground');
          await page.screenshot({ path: path.join(output, 'desktop-hard-impact.png') });
          capturedHard = true;
        }
      }
      await delay(70);
      continue;
    }
    const ahead = s.hazards.filter(h => h.at > s.distance - 1.05).sort((a, b) => a.at - b.at);
    let target = 0;
    if (ahead.length && ahead[0].at < s.distance + 22) {
      const row = ahead.filter(h => h.at === ahead[0].at);
      if (row.some(h => h.type === 'hunter' && h.locked)) snapshots.hunterSeen = true;
      if (intent === 'caught') target = row[0].x;
      else {
        const free = [-6, -3, 0, 3, 6].filter(x => row.every(h => Math.abs(x - h.baseX) > 2.2));
        target = free.sort((a, b) => Math.abs(a - s.x) - Math.abs(b - s.x))[0] ?? 0;
        const risk = s.level === 1 && s.pickups.find(p => p.risk && !p.collected && p.at === row[0].at);
        if (risk) target = risk.x;
      }
    }
    // Anticipate inertia so key release lands near the chosen safe window column.
    const difference = target - (s.x + s.velocity / 15);
    const next = Math.abs(difference) < 0.24 ? null : difference > 0 ? 'ArrowRight' : 'ArrowLeft';
    if (next !== held) {
      if (held) await page.keyboard.up(held);
      if (next) await page.keyboard.down(next);
      held = next;
    }
    await delay(65);
  }
  throw new Error(`No ${intent} result within 45s`);
}

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (server.exitCode !== null) throw new Error(serverLog);
    await delay(100);
  }
  if (!process.argv.includes('--skip-render')) {
    const previousRenderUrl = process.env.RENDER_TEST_URL;
    process.env.RENDER_TEST_URL = url;
    try { await import('./render-regression.mjs'); }
    finally {
      if (previousRenderUrl === undefined) delete process.env.RENDER_TEST_URL;
      else process.env.RENDER_TEST_URL = previousRenderUrl;
    }
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: true });
  page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__RAIN_PAIN__);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  assert.equal((await snapshot()).mode, 'menu');
  assert.equal((await snapshot()).impactMode, 'arcade');
  assert.equal(await page.locator('[data-action="modeArcade"]').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: path.join(output, 'desktop-menu.png') });
  await action('mute');
  assert.equal((await snapshot()).muted, true);
  await action('start');
  await page.waitForTimeout(150);
  snapshots.introRoof = await snapshot();
  assert.equal(snapshots.introRoof.mode, 'intro');
  assert.equal(snapshots.introRoof.introStage, 'roof');
  assert.equal(snapshots.introRoof.distance, 0);
  assert.equal(snapshots.introRoof.elapsed, 0);
  assert.equal(snapshots.introRoof.score, 0);
  assert.equal(await page.locator('[data-ref="introScreen"]').isVisible(), true);
  assert.equal(await page.locator('[data-ref="hud"]').isVisible(), false);
  assert.equal(await page.evaluate(() => window.__RAIN_PAIN__.landing().active), false);
  for (const name of ['skipIntro', 'pause']) {
    const bounds = await page.locator(`[data-action="${name}"]:visible`).first().boundingBox();
    assert.ok(bounds.width >= 44 && bounds.height >= 44, `${name}: intro target is large enough for touch`);
  }
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Escape');
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Shift');
  snapshots.introPaused = await snapshot();
  assert.equal(snapshots.introPaused.mode, 'paused');
  assert.equal(snapshots.introPaused.resumeMode, 'intro');
  assert.equal(snapshots.introPaused.x, 0);
  assert.equal(snapshots.introPaused.slow, false);
  await page.waitForTimeout(80);
  const pausedIntroPose = await page.evaluate(() => window.__RAIN_PAIN__.intro());
  await page.waitForTimeout(180);
  assert.equal((await snapshot()).introTime, snapshots.introPaused.introTime);
  const stillIntroPose = await page.evaluate(() => window.__RAIN_PAIN__.intro());
  assert.deepEqual(stillIntroPose.cameraPosition, pausedIntroPose.cameraPosition, 'Paused intro camera does not advance');
  assert.deepEqual(stillIntroPose.playerPosition, pausedIntroPose.playerPosition, 'Paused intro heroine stays on the same frame');
  assert.equal(await page.locator('[data-action="skipIntro"]').isDisabled(), true);
  await page.screenshot({ path: path.join(output, 'desktop-intro-roof.png') });
  await action('resume');
  assert.equal((await snapshot()).mode, 'intro');
  await page.waitForFunction(() => window.__RAIN_PAIN__.snapshot().introStage === 'jump', null, { timeout: 10000 });
  snapshots.introJump = await snapshot();
  assert.equal(snapshots.introJump.distance, 0);
  assert.equal(snapshots.introJump.elapsed, 0);
  await page.screenshot({ path: path.join(output, 'desktop-intro-jump.png') });
  await page.waitForFunction(() => window.__RAIN_PAIN__.snapshot().mode === 'playing', null, { timeout: 10000 });
  assert.equal((await snapshot()).launchProgress, 1, 'Natural intro completion does not replay a second launch');
  assert.equal(await page.locator('[data-ref="introScreen"]').isVisible(), false);
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => window.__RAIN_PAIN__.snapshot().x > 0.3);
  await page.keyboard.up('ArrowRight');
  assert.ok((await snapshot()).x > 0.25, 'Keyboard movement changes player x');
  await page.keyboard.press('Escape');
  const paused = await snapshot();
  assert.equal(paused.mode, 'paused');
  await page.waitForTimeout(160);
  assert.equal((await snapshot()).distance, paused.distance);
  await page.screenshot({ path: path.join(output, 'desktop-pause.png') });
  await action('resume');
  await page.keyboard.press('Space');
  assert.ok((await snapshot()).dashCooldown > 0, 'Dash responds');
  await page.keyboard.down('Shift');
  await page.waitForFunction(() => window.__RAIN_PAIN__.snapshot().slow);
  assert.equal((await snapshot()).slow, true, 'Slow responds');
  await page.keyboard.up('Shift');
  await page.screenshot({ path: path.join(output, 'desktop-game.png') });
  snapshots.win = await steerUntilResult('win');
  assert.equal(snapshots.win.outcome, 'win', 'Real key inputs complete first level');
  assert.equal(snapshots.win.unlockedLevel, 2);
  assert.equal(snapshots.win.lastResult.runImpactMode, 'arcade');
  assert.equal(await page.evaluate(() => window.__RAIN_PAIN__.landing().active), false);
  assert.ok(snapshots.hunterSeen, 'Authored first tower introduces and locks a hunter');
  assert.ok(snapshots.win.riskDrops > 0, 'Real keyboard route collects risk drops');
  assert.ok(['C', 'B', 'A', 'S'].includes(snapshots.win.lastResult.grade));
  assert.ok(snapshots.win.lastResult.style.goal, 'Style gives a concrete replay goal');
  assert.equal(snapshots.win.levelRecords['1'].score, snapshots.win.score);
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#result-title').textContent(), 'На вулиці rain — на душі pain');
  assert.equal(await page.locator('[data-ref="resultGrade"]').textContent(), snapshots.win.lastResult.grade);
  assert.equal(await page.locator('[data-ref="resultTowerGrade"]').textContent(), snapshots.win.levelRecords['1'].grade);
  await page.screenshot({ path: path.join(output, 'desktop-win.png') });
  await action('next');
  assert.equal((await snapshot()).level, 2);
  assert.equal((await snapshot()).mode, 'intro');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Enter');
  assert.equal((await snapshot()).mode, 'playing', 'Enter skips the next tower opening');
  snapshots.caught = await steerUntilResult('caught');
  assert.equal(snapshots.caught.outcome, 'caught');
  assert.ok(snapshots.caught.lastResult.caughtBy?.id, 'Loss identifies the window that caught the heroine');
  assert.ok(snapshots.caught.lastResult.progress > 0 && snapshots.caught.lastResult.progress < 1);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(output, 'desktop-caught.png') });
  await action('retry');
  assert.equal((await snapshot()).level, 2);
  assert.equal((await snapshot()).outcome, null);
  assert.equal((await snapshot()).mode, 'intro');
  assert.equal(layoutSignature(await snapshot()), layoutSignature(snapshots.caught), 'Retry repeats the same layout for practice');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Space');
  assert.equal((await snapshot()).mode, 'playing', 'Space skips a fresh retry without consuming dash');
  assert.equal((await snapshot()).dashCooldown, 0);
  await page.reload();
  await page.waitForFunction(() => window.__RAIN_PAIN__);
  assert.equal((await snapshot()).unlockedLevel, 2, 'Progress survives reload');
  assert.equal((await snapshot()).muted, true, 'Sound preference survives reload');
  assert.ok((await snapshot()).bestScore > 0, 'Record survives reload');
  assert.equal((await snapshot()).levelRecords['1'].grade, snapshots.win.lastResult.grade, 'Tower grade survives reload');

  await action('modeHard');
  assert.equal((await snapshot()).impactMode, 'hard');
  await page.reload();
  await page.waitForFunction(() => window.__RAIN_PAIN__);
  assert.equal((await snapshot()).impactMode, 'hard', 'Hard mode preference survives reload');
  assert.equal(await page.locator('[data-action="modeHard"]').getAttribute('aria-pressed'), 'true');
  await action('prevLevel');
  await action('start');
  assert.equal((await snapshot()).mode, 'intro');
  assert.equal((await snapshot()).runImpactMode, 'hard');
  assert.equal(await page.evaluate(() => window.__RAIN_PAIN__.landing().active), false, 'Hard mode intro does not start landing physics');
  await action('skipIntro');
  snapshots.hardWin = await steerUntilResult('win', true);
  assert.equal(snapshots.hardWin.outcome, 'win');
  assert.equal(snapshots.hardWin.lastResult.runImpactMode, 'hard');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#result-title').textContent(), 'На вулиці rain — на душі pain');
  assert.equal(await page.locator('[data-ref="resultImpactMode"]').getAttribute('data-impact-mode'), 'hard');
  await page.screenshot({ path: path.join(output, 'desktop-hard-result.png') });
  await action('menu');
  await page.waitForFunction(() => !window.__RAIN_PAIN__.landing().active);
  assert.equal(await page.evaluate(() => window.__RAIN_PAIN__.landing().active), false);
  await action('modeArcade');
  await page.reload();
  await page.waitForFunction(() => window.__RAIN_PAIN__);
  assert.equal((await snapshot()).impactMode, 'arcade', 'Switching back to arcade survives reload');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  await action('prevLevel');
  assert.equal(await page.locator('[data-ref="menuLevel"]').textContent(), 'ВЕЖА 01');
  await action('modeHard');
  assert.equal((await snapshot()).impactMode, 'hard', 'Mode selector works at phone size');
  await action('modeArcade');
  await page.screenshot({ path: path.join(output, 'mobile-menu.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow');
  await action('start');
  await page.waitForTimeout(250);
  assert.equal((await snapshot()).level, 1, 'Unlocked tower selector supports replay');
  assert.equal((await snapshot()).mode, 'intro');
  assert.equal(await page.locator('[data-ref="hud"]').isVisible(), false);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Intro has no mobile horizontal overflow');
  const skip = await page.locator('[data-action="skipIntro"]:visible').boundingBox();
  assert.ok(skip.width >= 44 && skip.height >= 44, 'Mobile intro skip remains a comfortable touch target');
  await page.screenshot({ path: path.join(output, 'mobile-intro-roof.png') });
  await page.touchscreen.tap(skip.x + skip.width / 2, skip.y + skip.height / 2);
  await page.waitForFunction(() => window.__RAIN_PAIN__.snapshot().mode === 'playing');
  assert.equal((await snapshot()).dashCooldown, 0, 'Touch skip does not trigger a dash');
  const beforeTouch = (await snapshot()).x;
  const right = await page.locator('[data-action="right"]:visible').boundingBox();
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
  await page.mouse.down();
  await page.waitForFunction(x => window.__RAIN_PAIN__.snapshot().x > x + 0.35, beforeTouch);
  await page.mouse.up();
  const slow = await page.locator('[data-action="slow"]:visible').boundingBox();
  await page.mouse.move(slow.x + slow.width / 2, slow.y + slow.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => window.__RAIN_PAIN__.snapshot().slow);
  await page.mouse.up();
  await page.waitForFunction(() => !window.__RAIN_PAIN__.snapshot().slow);
  await page.screenshot({ path: path.join(output, 'mobile-game.png') });
  snapshots.mobile = await snapshot();
  assert.doesNotMatch(await page.locator('[data-ref="tutorialHint"]').textContent(), /Space|Shift|A \/ D/i, 'Touch tutorial uses touch controls');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(output, 'mobile-pause.png') });
  await action('menu');
  await page.setViewportSize({ width: 1440, height: 900 });
  const beforeDaily = await snapshot();
  await action('daily');
  snapshots.dailyStart = await snapshot();
  assert.match(snapshots.dailyStart.dailyDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(snapshots.dailyStart.level, 3);
  assert.equal(snapshots.dailyStart.mode, 'intro', 'Daily challenge has the same rooftop opening');
  await action('skipIntro');
  snapshots.dailyWin = await steerUntilResult('win');
  assert.equal(snapshots.dailyWin.outcome, 'win');
  assert.equal(snapshots.dailyWin.unlockedLevel, beforeDaily.unlockedLevel, 'Daily does not unlock normal towers');
  assert.equal(snapshots.dailyWin.bestScore, beforeDaily.bestScore, 'Daily has an independent record');
  assert.deepEqual(snapshots.dailyWin.levelRecords, beforeDaily.levelRecords);
  assert.equal(snapshots.dailyWin.dailyRecords[snapshots.dailyStart.dailyDate].score, snapshots.dailyWin.score);
  assert.equal(await page.locator('[data-action="next"]').isVisible(), false, 'Daily result repeats today instead of advancing');
  await page.screenshot({ path: path.join(output, 'daily-result.png') });
  await action('retry');
  assert.equal((await snapshot()).dailyDate, snapshots.dailyStart.dailyDate);
  assert.equal(layoutSignature(await snapshot()), layoutSignature(snapshots.dailyStart), 'Daily retry repeats the same challenge');
  await action('menu');
  await page.reload();
  await page.waitForFunction(() => window.__RAIN_PAIN__);
  assert.deepEqual((await snapshot()).dailyRecords, snapshots.dailyWin.dailyRecords, 'Daily record survives reload');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(150);
  await page.locator('[data-action="daily"]').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Compact daily menu has no horizontal overflow');
  await page.screenshot({ path: path.join(output, 'daily-compact-menu.png') });
  await action('daily');
  assert.equal((await snapshot()).dailyDate, snapshots.dailyStart.dailyDate, 'Compact touch menu starts today\'s challenge');
  await action('menu');
  const archivePage = await context.newPage();
  archivePage.on('pageerror', error => errors.push(error.message));
  archivePage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await archivePage.goto(`${url}/releases/arcade-0.2.1/`);
  await archivePage.waitForFunction(() => window.__RAIN_PAIN__);
  assert.equal(await archivePage.locator('[data-action="modeHard"]').count(), 0, 'Original archived arcade release remains independent');
  await archivePage.locator('[data-action="start"]').click();
  assert.equal(await archivePage.evaluate(() => window.__RAIN_PAIN__.snapshot().mode), 'playing');
  await archivePage.close();
  assert.deepEqual(errors, [], 'No runtime or console errors');
  await writeFile(path.join(output, 'browser-report.json'), JSON.stringify({ passed: true, errors, snapshots }, null, 2));
  console.log('Browser checks passed: rooftop intro, pause/skip, arcade/hard, keyboard/touch, style goals, caught feedback, deterministic retry, isolated daily win/record/reload and compact menu, archived release. Screenshots: artifacts/');
} catch (error) {
  if (page) {
    try {
      await page.screenshot({ path: path.join(output, 'failure.png') });
      snapshots.failure = await snapshot();
    } catch {}
  }
  await writeFile(path.join(output, 'browser-report.json'), JSON.stringify({ passed: false, errors, error: String(error), snapshots, serverLog }, null, 2));
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
