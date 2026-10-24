import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'artifacts');
const prefix = '/goingdownfromsky/';
const argument = process.argv.slice(2).find(value => /^https?:\/\//.test(value));
const remoteUrl = argument || process.env.PAGES_URL;
const report = { passed: false, target: null, checks: [], resources: {}, errors: [] };
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png',
};
let server;
let browser;

async function serveBuild() {
  const dist = await realpath(path.join(root, 'dist'));
  await stat(path.join(dist, 'index.html'));
  await stat(path.join(dist, 'releases/arcade-0.2.1/index.html'));
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (!pathname.startsWith(prefix)) throw new Error('Outside the Pages prefix');
      const relative = decodeURIComponent(pathname.slice(prefix.length));
      if (relative.includes('\\') || relative.includes('\0')) throw new Error('Invalid path');
      let file = path.resolve(dist, relative || '.');
      if (file !== dist && !file.startsWith(`${dist}${path.sep}`)) throw new Error('Outside dist');
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const resolved = await realpath(file);
      if (!resolved.startsWith(`${dist}${path.sep}`)) throw new Error('Outside dist');
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}${prefix}`;
}

function watch(page, name, baseUrl) {
  const resources = report.resources[name] = { scripts: 0, styles: 0, fonts: 0, failed: [], escapedPrefix: [] };
  const base = new URL(baseUrl);
  page.on('pageerror', error => report.errors.push(`${name}: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(`${name}: ${message.text()}`);
  });
  page.on('requestfailed', request => resources.failed.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === base.origin && !url.pathname.startsWith(base.pathname)) resources.escapedPrefix.push(url.href);
    if (response.status() >= 400) resources.failed.push(`${response.status()} ${url.href}`);
    const type = response.request().resourceType();
    if (type === 'script') resources.scripts++;
    if (type === 'stylesheet') resources.styles++;
    if (type === 'font') resources.fonts++;
  });
  return resources;
}

async function boot(page, url, name, baseUrl) {
  const resources = watch(page, name, baseUrl);
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  assert.equal(response.status(), 200, `${name}: HTML loads`);
  await page.waitForFunction(() => window.__RAIN_PAIN__?.graphics()?.calls > 0, null, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('.webgl-error').count(), 0, `${name}: WebGL boots`);
  assert.equal(await page.evaluate(() => window.__RAIN_PAIN__.snapshot().mode), 'menu');
  assert.ok(resources.scripts > 0 && resources.styles > 0 && resources.fonts > 0, `${name}: bundled JS, CSS and fonts load`);
  const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
  const faviconUrl = new URL(favicon, url);
  assert.ok(faviconUrl.pathname.startsWith(new URL(baseUrl).pathname), `${name}: favicon stays under Pages prefix`);
  assert.equal((await page.request.get(faviconUrl.href)).status(), 200, `${name}: favicon loads`);
  report.checks.push(`${name}: HTML, WebGL, JS, CSS, local fonts and favicon`);
  return resources;
}

async function action(page, name) {
  const selector = `[data-action="${name}"]:visible`;
  const dialog = page.locator('[role="dialog"]:visible').locator(selector);
  await (await dialog.count() ? dialog.first() : page.locator(selector).first()).click();
}

async function snapshot(page) {
  return page.evaluate(() => window.__RAIN_PAIN__.snapshot());
}

try {
  await mkdir(output, { recursive: true });
  const url = remoteUrl ? `${remoteUrl.replace(/\/+$/, '')}/` : await serveBuild();
  report.target = url;
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await boot(page, url, 'current', url);
  assert.equal((await snapshot(page)).impactMode, 'arcade');
  await action(page, 'modeHard');
  assert.equal((await snapshot(page)).impactMode, 'hard');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__RAIN_PAIN__);
  assert.equal((await snapshot(page)).impactMode, 'hard', 'Mode preference persists');
  await action(page, 'modeArcade');
  assert.equal((await snapshot(page)).impactMode, 'arcade');
  await page.screenshot({ path: path.join(output, 'pages-current-menu.png') });
  await action(page, 'mute');
  await action(page, 'start');
  assert.equal((await snapshot(page)).mode, 'playing');
  assert.equal((await snapshot(page)).runImpactMode, 'arcade');
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => window.__RAIN_PAIN__.snapshot().x > 0.35);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.press('Escape');
  const paused = await snapshot(page);
  assert.equal(paused.mode, 'paused');
  await page.waitForTimeout(150);
  assert.equal((await snapshot(page)).distance, paused.distance);
  await action(page, 'resume');
  assert.equal((await snapshot(page)).mode, 'playing');
  await page.keyboard.press('Space');
  assert.ok((await snapshot(page)).dashCooldown > 0);
  await page.keyboard.press('Escape');
  await action(page, 'menu');
  await page.setViewportSize({ width: 390, height: 844 });
  await action(page, 'modeHard');
  await action(page, 'modeArcade');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  report.checks.push('Current release: mode preference, arcade start, movement, pause/resume, dash, mobile selector');

  const archive = await context.newPage();
  const archiveUrl = new URL('releases/arcade-0.2.1/', url).href;
  await boot(archive, archiveUrl, 'archive', url);
  assert.equal(await archive.locator('[data-action="modeHard"]').count(), 0);
  await archive.screenshot({ path: path.join(output, 'pages-archive-menu.png') });
  await action(archive, 'start');
  assert.equal((await snapshot(archive)).mode, 'playing');
  await archive.keyboard.press('Escape');
  assert.equal((await snapshot(archive)).mode, 'paused');
  report.checks.push('Archived 0.2.1: independent arcade menu, start and pause');
  for (const [name, resources] of Object.entries(report.resources)) {
    assert.deepEqual(resources.failed, [], `${name}: no failed asset requests`);
    assert.deepEqual(resources.escapedPrefix, [], `${name}: no asset requests escape Pages prefix`);
  }
  assert.deepEqual(report.errors, [], 'No browser runtime or console errors');
  report.passed = true;
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, 'pages-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
