import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__RAIN_PAIN__);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'artifacts/final-menu.png' });
  const metrics = await page.evaluate(async () => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
    const intervals = [];
    let previous;
    await new Promise(resolve => {
      const tick = time => {
        if (previous !== undefined) intervals.push(time - previous);
        previous = time;
        if (intervals.length >= 90) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    intervals.sort((a, b) => a - b);
    return { gpu, medianFrameMs: intervals[45], p95FrameMs: intervals[85], graphics: window.__RAIN_PAIN__.graphics() };
  });
  await writeFile('artifacts/render-report.json', JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
} finally { await browser.close(); }
