// Takes the portfolio screenshots with headless Edge, emulating each screen size exactly.
// Run "node server.js" first, then: node tools/screenshots.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });

const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const port = 9333;
const shots = [
  { name: 'desktop-light', width: 1280, height: 800, scale: 1, mobile: false, hash: 'demo-light' },
  { name: 'desktop-dark', width: 1280, height: 800, scale: 1, mobile: false, hash: 'demo-dark' },
  { name: 'phone-light', width: 390, height: 844, scale: 2, mobile: true, hash: 'demo-light' },
  { name: 'phone-dark', width: 390, height: 844, scale: 2, mobile: true, hash: 'demo-dark' },
];

const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${join(tmpdir(), 'edge-shot-cdp')}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
}
if (!target) { browser.kill(); throw new Error('Edge did not start'); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0;
const waiting = new Map();
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
});
const send = (method, params = {}) => new Promise(res => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

for (const s of shots) {
  await send('Emulation.setDeviceMetricsOverride', { width: s.width, height: s.height, deviceScaleFactor: s.scale, mobile: s.mobile });
  await send('Page.navigate', { url: `http://localhost:8000/?shot=${s.name}#${s.hash}` });
  await sleep(3500); // fonts and the sample conversation settle
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `${s.name}.png`), Buffer.from(result.data, 'base64'));
  console.log('saved', `${s.name}.png`);
}
ws.close();
browser.kill();
