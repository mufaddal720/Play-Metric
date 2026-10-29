// End-to-end browser tests: real Chromium, real MediaPipe models, fake camera fed from fixture videos.
// usage: npm run build && node scripts/e2e.mjs [scenario...]   (needs test-artifacts/fixtures from make_fixtures.py)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }

const PORT = 4173, BASE = `http://localhost:${PORT}/`;
const FIX = 'test-artifacts/fixtures', OUT = 'test-artifacts/e2e';
mkdirSync(OUT, { recursive: true });
const report = [];
const log = (...a) => { console.log(...a); report.push(a.join(' ')); };

// Serve the production build with the production security headers (CSP, Permissions-Policy).
const server = spawn('node', ['scripts/serve-dist.mjs', String(PORT)], { stdio: 'pipe' });
await new Promise((r) => { server.stdout.on('data', (d) => d.toString().includes('Local') && r()); setTimeout(r, 6000); });

async function launch(video, viewport = { width: 1366, height: 900 }) {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'];
  if (video) args.push(`--use-file-for-fake-video-capture=${FIX}/${video}`);
  const browser = await chromium.launch({ args, executablePath: process.env.CHROME_PATH || undefined });
  const ctx = await browser.newContext({ viewport, permissions: ['camera'], timezoneId: 'Asia/Dubai' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/XNNPACK|TensorFlow Lite/.test(m.text()) && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  return { browser, page, errors };
}

async function addPlayers(page, names) {
  for (const n of names) { await page.fill('#new-player', n); await page.click('button:has-text("Add")'); }
}

async function freezeScenario(name, video, expect) {
  const { browser, page, errors } = await launch(video);
  try {
    await page.goto(BASE + '#/setup/freeze');
    await addPlayers(page, ['Aisha']);
    await page.fill('#num-Rounds', '1');
    await page.fill('#num-Prepare-s-', '2');
    await page.fill('#num-Copy-s-', '3');
    await page.fill('#num-Freeze-s-', '3');
    await page.click('text=Choose specific poses');
    await page.check(`label:has-text("${expect.pose}") input`);
    await page.click('button:has-text("Start match")');
    await page.waitForSelector('text=/player\\(s\\) (detected|visible)/', { timeout: 60000 });
    if (expect.detect) await page.waitForSelector('text=detected — ready', { timeout: 30000 });
    await page.click('button:has-text("Start round 1")');
    await page.waitForSelector('text=AI verdict', { timeout: 60000 });
    await page.screenshot({ path: `${OUT}/${name}-verdict.png` });
    const verdict = await page.locator('h3:has-text("AI verdict")').locator('..').innerText();
    log(`[${name}] verdict:`, verdict.replace(/\s+/g, ' ').slice(0, 600));
    await page.click('text=Evidence & explanations').catch(() => {});
    const ev = await page.locator('h3:has-text("AI verdict")').locator('..').innerText();
    writeFileSync(`${OUT}/${name}-evidence.txt`, ev);
    await page.click('button:has-text("See results")');
    await page.waitForSelector('text=results', { timeout: 10000 });
    await page.screenshot({ path: `${OUT}/${name}-results.png`, fullPage: true });
    const score = Number((verdict.match(/Aisha\s+([\d.]+|—)\/100/) || [])[1]);
    const ok = expect.check(score, verdict);
    log(`[${name}] score=${score} → ${ok ? 'PASS' : 'FAIL'}`);
    if (errors.length) log(`[${name}] page errors:`, errors.slice(0, 5).join(' | '));
    return ok;
  } catch (e) {
    await page.screenshot({ path: `${OUT}/${name}-error.png` }).catch(() => {});
    log(`[${name}] ERROR ${e.message.split('\n')[0]}`, errors.slice(0, 5).join(' | '));
    return false;
  } finally { await browser.close(); }
}

async function footballScenario() {
  const name = 'football';
  const { browser, page, errors } = await launch('football.y4m');
  try {
    await page.goto(BASE + '#/setup/football');
    await page.fill('#num-Match-length-min-', '1');
    await page.click('button:has-text("Start match")');
    const canvas = page.locator('canvas').first();
    await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0, null, { timeout: 30000 });
    const box = await canvas.boundingBox();
    const at = (x, y) => page.mouse.click(box.x + (x / 640) * box.width, box.y + (y / 360) * box.height);
    for (const [x, y] of [[40, 60], [600, 60], [600, 320], [40, 320]]) await at(x, y);
    for (const [x, y] of [[600, 150], [600, 230], [625, 190]]) await at(x, y); // Goal 1 = right goal
    for (const [x, y] of [[40, 150], [40, 230], [15, 190]]) await at(x, y);    // Goal 2 = left goal
    // tap the ball; the fixture video loops, so retry until the app accepts the sample
    let accepted = false;
    for (let i = 0; i < 80 && !accepted; i++) {
      await at(320, 190);
      accepted = await page.locator('text=Testing ball tracking').count() > 0 || await page.locator('text=Match control').count() > 0;
      if (!accepted) await page.waitForTimeout(250);
    }
    if (!accepted) throw new Error('ball colour sample never accepted');
    await page.waitForSelector('text=Match control', { timeout: 20000 });
    log(`[${name}] perf after test:`, JSON.stringify(await page.evaluate(() => window.__footballPerf)));
    log(`[${name}] ball test:`, (await page.locator('text=/Ball found in/').innerText()).replace(/\s+/g, ' '));
    await page.click('button:has-text("Kick-off")');
    await page.waitForTimeout(40000);
    await page.screenshot({ path: `${OUT}/${name}-live.png` });
    const board = (await page.locator('div.text-2xl.font-black.tabular-nums').first().innerText()).replace(/\s+/g, ' ');
    log(`[${name}] analysis speed:`, await page.locator('div:has-text("Analysis speed:")').last().innerText());
    const logText = (await page.locator('h3:has-text("Event log")').locator('..').innerText()).replace(/\s+/g, ' ');
    const review = await page.locator('h3:has-text("Needs host review")').count();
    log(`[${name}] scoreboard: ${board}`);
    log(`[${name}] event log: ${logText.slice(0, 900)}`);
    log(`[${name}] pending reviews: ${review ? (await page.locator('h3:has-text("Needs host review")').innerText()) : 0}`);
    await page.click('button:has-text("End match")');
    await page.waitForSelector('text=results', { timeout: 10000 });
    await page.screenshot({ path: `${OUT}/${name}-results.png`, fullPage: true });
    const [a, b] = board.match(/(\d+) – (\d+)/)?.slice(1).map(Number) ?? [NaN, NaN];
    // Fixture timeline (loops every 17.3 s): shot into Goal 1, a shot wide of the post, a shot into Goal 2.
    // Expect at most one goal per real shot, and no goal from the wide shot.
    const g1 = (logText.match(/Goal 1 line/g) || []).length, g2 = (logText.match(/Goal 2 line/g) || []).length;
    const elapsed = 40; const loops = elapsed / 17.3;
    const ok = a + b >= 2 && g1 >= 1 && g2 >= 1 && g1 <= Math.ceil(loops) && g2 <= Math.ceil(loops) && a + b === g1 + g2;
    log(`[${name}] goal-1 events=${g1}, goal-2 events=${g2}, scoreboard ${a}-${b} → ${ok ? 'PASS' : 'FAIL'}`);
    if (errors.length) log(`[${name}] page errors:`, errors.slice(0, 5).join(' | '));
    return ok;
  } catch (e) {
    await page.screenshot({ path: `${OUT}/${name}-error.png` }).catch(() => {});
    log(`[${name}] ERROR ${e.message.split('\n')[0]}`, errors.slice(0, 5).join(' | '));
    return false;
  } finally { await browser.close(); }
}

async function actionScenario() {
  const name = 'action-static';
  const { browser, page, errors } = await launch('person-warrior.y4m');
  try {
    await page.goto(BASE + '#/setup/action');
    await addPlayers(page, ['Aisha', 'Omar']);
    await page.selectOption('#difficulty', 'easy');
    await page.click('button:has-text("Start match")');
    await page.click('button:has-text("show my secret")');
    const card = page.locator('button[aria-label="Hold to reveal the secret action"]');
    const hidden = await card.innerText();
    const b = await card.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    const secret = (await card.innerText()).split('\n').filter(Boolean)[1];
    await page.mouse.up();
    const hiddenAgain = await card.innerText();
    log(`[${name}] secret hidden before/after hold: ${/Hold to reveal/.test(hidden) && /Hold to reveal/.test(hiddenAgain)}; secret while held: "${secret}"`);
    await page.waitForSelector('button:has-text("Start acting"):not([disabled])', { timeout: 60000 });
    await page.click('button:has-text("Start acting")');
    await page.selectOption('#guesser', { label: 'Omar' });
    await page.fill('#guess', 'dancing'); await page.press('#guess', 'Enter');
    await page.fill('#guess', secret); await page.press('#guess', 'Enter');
    await page.waitForSelector('text=The answer was', { timeout: 60000 });
    await page.screenshot({ path: `${OUT}/${name}-verdict.png`, fullPage: true });
    const verdict = (await page.locator('text=The answer was').locator('..').innerText()).replace(/\s+/g, ' ');
    log(`[${name}] verdict: ${verdict.slice(0, 700)}`);
    const okGuess = /Omar got it/.test(verdict);
    const okHonest = /AI could not judge confidently/.test(verdict) || /AI action match/.test(verdict);
    await page.click('button:has-text("End game")');
    await page.waitForSelector('text=results');
    await page.screenshot({ path: `${OUT}/${name}-results.png`, fullPage: true });
    const standings = (await page.locator('ol').first().innerText()).replace(/\s+/g, ' ');
    log(`[${name}] standings: ${standings}`);
    const ok = okGuess && okHonest && /Omar 15/.test(standings);
    log(`[${name}] ${ok ? 'PASS' : 'FAIL'} (correct guess scored 15 to the guesser; the static performer's AI points come only from measured cues)`);
    if (errors.length) log(`[${name}] page errors:`, errors.slice(0, 5).join(' | '));
    return ok;
  } catch (e) {
    await page.screenshot({ path: `${OUT}/${name}-error.png` }).catch(() => {});
    log(`[${name}] ERROR ${e.message.split('\n')[0]}`, errors.slice(0, 5).join(' | '));
    return false;
  } finally { await browser.close(); }
}

async function uiScenario() {
  const name = 'ui';
  const { browser, page, errors } = await launch(null, { width: 390, height: 844 });
  try {
    for (const [route, file] of [['#/', 'mobile-home'], ['#/setup/freeze', 'mobile-setup'], ['#/how', 'mobile-how'], ['#/settings', 'mobile-settings']]) {
      await page.goto(BASE + route); await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      log(`[${name}] ${route} horizontal overflow at 390px: ${overflow}`);
      if (overflow) throw new Error(`horizontal overflow on ${route}`);
    }
    const tz = await page.evaluate(() => document.querySelector('header')?.innerText.match(/\d{2}:\d{2} GST/)?.[0]);
    const expected = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    log(`[${name}] header clock ${tz} vs Asia/Dubai now ${expected}`);
    await page.goto(BASE + '#/settings');
    await page.check('text=Right-to-left layout preview');
    const dir = await page.evaluate(() => document.documentElement.dir);
    await page.goto(BASE + '#/');
    await page.screenshot({ path: `${OUT}/mobile-home-rtl.png`, fullPage: true });
    log(`[${name}] RTL preview sets dir=${dir}`);
    // every button / link does something: check there are no anchors without href and no buttons without handlers is hard to do statically; check nav links resolve
    for (const r of ['#/how', '#/history', '#/settings', '#/privacy']) { await page.goto(BASE + r); if (!(await page.locator('h2, h1').count())) throw new Error('empty page ' + r); }
    const ok = dir === 'rtl' && tz && tz.startsWith(expected.slice(0, 2));
    log(`[${name}] ${ok ? 'PASS' : 'FAIL'}`);
    if (errors.length) log(`[${name}] page errors:`, errors.slice(0, 5).join(' | '));
    return !!ok && !errors.length;
  } catch (e) {
    log(`[${name}] ERROR ${e.message.split('\n')[0]}`);
    return false;
  } finally { await browser.close(); }
}

async function footballRecordedScenario() {
  const name = 'football-recorded';
  const { browser, page, errors } = await launch(null);
  try {
    await page.goto(BASE + '#/setup/football');
    await page.fill('#num-Match-length-min-', '1');
    await page.selectOption('#judging', 'recorded');
    await page.click('button:has-text("Start match")');
    await page.setInputFiles('#fb-file', `${FIX}/football.webm`);
    await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    const box = await page.locator('canvas').first().boundingBox();
    const at = (x, y) => page.mouse.click(box.x + (x / 640) * box.width, box.y + (y / 360) * box.height);
    for (const [x, y] of [[40, 60], [600, 60], [600, 320], [40, 320], [600, 150], [600, 230], [625, 190], [40, 150], [40, 230], [15, 190], [320, 190]]) { await at(x, y); await page.waitForTimeout(150); }
    await page.waitForSelector('text=Match control', { timeout: 30000 });
    log(`[${name}] ball test:`, (await page.locator('text=/Ball found in/').innerText()).replace(/\s+/g, ' '));
    await page.click('button:has-text("Kick-off")');
    await page.waitForFunction(() => document.querySelector('video')?.ended, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    const board = (await page.locator('div.text-2xl.font-black.tabular-nums').first().innerText()).replace(/\s+/g, ' ');
    const logText = (await page.locator('h3:has-text("Event log")').locator('..').innerText()).replace(/\s+/g, ' ');
    const review = await page.locator('h3:has-text("Needs host review")').count();
    log(`[${name}] scoreboard after the whole video: ${board}; pending reviews: ${review}`);
    log(`[${name}] event log: ${logText.slice(0, 500)}`);
    const ok = /1 – 1/.test(board) && review === 0;
    log(`[${name}] ${ok ? 'PASS' : 'FAIL'} (video contains exactly one goal per goal mouth plus one wide shot)`);
    if (errors.length) log(`[${name}] page errors:`, errors.slice(0, 5).join(' | '));
    return ok;
  } catch (e) {
    await page.screenshot({ path: `${OUT}/${name}-error.png` }).catch(() => {});
    log(`[${name}] ERROR ${e.message.split('\n')[0]}`, errors.slice(0, 5).join(' | '));
    return false;
  } finally { await browser.close(); }
}

async function freezeRecordedScenario() {
  const name = 'freeze-recorded';
  const { browser, page, errors } = await launch(null);
  try {
    await page.goto(BASE + '#/setup/freeze');
    await addPlayers(page, ['Aisha']);
    await page.fill('#num-Rounds', '1');
    await page.selectOption('#judging', 'recorded');
    await page.click('text=Choose specific poses');
    await page.check('label:has-text("Airplane Wings") input');
    await page.click('button:has-text("Start match")');
    await page.setInputFiles('#freeze-file', `${FIX}/warrior.webm`);
    await page.fill('#freeze-start', '2');
    await page.waitForSelector('button:has-text("Judge this clip"):not([disabled])', { timeout: 60000 });
    await page.click('button:has-text("Judge this clip")');
    await page.waitForSelector('text=AI verdict', { timeout: 60000 });
    const verdict = (await page.locator('h3:has-text("AI verdict")').locator('..').innerText()).replace(/\s+/g, ' ');
    log(`[${name}] verdict: ${verdict.slice(0, 200)}`);
    const score = Number((verdict.match(/Aisha ([\d.]+)\/100/) || [])[1]);
    const ok = score >= 70;
    log(`[${name}] score=${score} → ${ok ? 'PASS' : 'FAIL'}`);
    if (errors.length) log(`[${name}] page errors:`, errors.slice(0, 5).join(' | '));
    return ok;
  } catch (e) {
    await page.screenshot({ path: `${OUT}/${name}-error.png` }).catch(() => {});
    log(`[${name}] ERROR ${e.message.split('\n')[0]}`, errors.slice(0, 5).join(' | '));
    return false;
  } finally { await browser.close(); }
}

const scenarios = {
  'freeze-recorded': freezeRecordedScenario,
  'football-recorded': footballRecordedScenario,
  ui: uiScenario,
  action: actionScenario,
  football: footballScenario,
  'freeze-warrior': () => freezeScenario('freeze-warrior', 'person-warrior.y4m', { pose: 'Airplane Wings', detect: true, check: (s) => s >= 70 }),
  'freeze-standing': () => freezeScenario('freeze-standing', 'person-standing.y4m', { pose: 'Airplane Wings', detect: true, check: (s) => Number.isFinite(s) && s < 50 }),
  'freeze-empty': () => freezeScenario('freeze-empty', 'empty.y4m', { pose: 'Airplane Wings', detect: false, check: (s, v) => Number.isNaN(s) && /uncertain/i.test(v) }),
};

const pick = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios);
let failed = 0;
for (const s of pick) if (!(await scenarios[s]())) failed++;
writeFileSync(`${OUT}/report.txt`, report.join('\n') + '\n');
server.kill();
console.log(failed ? `${failed} scenario(s) failed` : 'all scenarios passed');
process.exit(failed ? 1 : 0);
