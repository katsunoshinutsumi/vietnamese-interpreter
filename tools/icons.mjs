// Renders icon.svg to the PNG app icons with headless Edge. Run "node server.js" first, then: node tools/icons.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'icons');
mkdirSync(out, { recursive: true });
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const port = 9334;
const sizes = [512, 192, 180];

const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${join(tmpdir(), 'edge-icons-cdp')}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
}
if (!target) { browser.kill(); throw new Error('Edge did not start'); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const waiting = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}) => new Promise(res => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

for (const s of sizes) {
  await send('Emulation.setDeviceMetricsOverride', { width: s, height: s, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:8000/icon.svg' });
  await sleep(1200);
  const { result } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: s, height: s, scale: 1 } });
  const name = s === 180 ? 'apple-touch-icon.png' : `icon-${s}.png`;
  writeFileSync(join(out, name), Buffer.from(result.data, 'base64'));
  console.log('saved', name);
}
ws.close(); browser.kill();
