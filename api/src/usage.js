// Usage accounting so the service can never cost more than planned:
// - a per-device daily cap on listening tokens and translations
// - a monthly budget that switches the paid features off once estimated spend reaches it
// Counts live in Azure Table Storage (STORAGE_CONNECTION). Without it they fall back to memory,
// which resets whenever the function restarts, so set the connection before opening the app to the public.
const crypto = require('node:crypto');
const { TableClient } = require('@azure/data-tables');

const num = (name, fallback) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? v : fallback; };
const USD_JPY = num('USD_JPY', 150);
const BUDGET_JPY = num('MONTHLY_BUDGET_JPY', 1000);
const DAILY_SPEECH_TOKENS = num('DAILY_SPEECH_TOKENS', 8); // each token is refreshed after 8 min, so 8 ≈ 64 min a day
const DAILY_TRANSLATIONS = num('DAILY_TRANSLATIONS', 150);

// Deliberately pessimistic estimates (USD): a speech token is billed as 8 full minutes of listening at ~$1/hour,
// plus room for the AI voice; Claude Opus 5.5 is priced per token from the response's usage.
const SPEECH_TOKEN_USD = (8 / 60) * 1.0 + 0.01;
const CLAUDE_USD = { input: 4 / 1e6, output: 20 / 1e6 };

let table = null, tableReady = null;
function getTable() {
  if (!process.env.STORAGE_CONNECTION) return null;
  if (!table) {
    table = TableClient.fromConnectionString(process.env.STORAGE_CONNECTION, 'usage');
    tableReady = table.createTable().catch(() => {}); // already exists is fine
  }
  return table;
}
const memory = new Map();

async function read(pk, rk) {
  const t = getTable();
  if (!t) return memory.get(pk + '|' + rk) || {};
  await tableReady;
  try { return await t.getEntity(pk, rk); } catch (e) { if (e.statusCode === 404) return {}; throw e; }
}

// add numbers to an entity; optimistic concurrency so parallel requests don't lose counts
async function add(pk, rk, fields) {
  const t = getTable();
  if (!t) {
    const cur = memory.get(pk + '|' + rk) || {};
    for (const [k, v] of Object.entries(fields)) cur[k] = (cur[k] || 0) + v;
    memory.set(pk + '|' + rk, cur);
    return;
  }
  await tableReady;
  for (let attempt = 0; attempt < 6; attempt++) {
    let cur = null;
    try { cur = await t.getEntity(pk, rk); } catch (e) { if (e.statusCode !== 404) throw e; }
    const next = { partitionKey: pk, rowKey: rk };
    for (const [k, v] of Object.entries(fields)) next[k] = ((cur && cur[k]) || 0) + v;
    try {
      if (cur) await t.updateEntity({ ...cur, ...next }, 'Merge', { etag: cur.etag });
      else await t.createEntity(next);
      return;
    } catch (e) {
      if (e.statusCode !== 412 && e.statusCode !== 409) throw e; // someone else wrote first: read again
    }
  }
}

// dates in Japan time, so "today" and "this month" match what the family sees
function stamp() {
  const iso = new Date(Date.now() + 9 * 3600_000).toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}
// a device is identified by a hash of its network address (no personal data is stored)
function who(request) {
  const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().replace(/:\d+$/, '');
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

const LIMITS = { speech: ['speechTokens', DAILY_SPEECH_TOKENS], translate: ['translations', DAILY_TRANSLATIONS] };

// returns an HTTP response when the call must be refused, or null to go ahead
async function check(request, kind) {
  try {
    const { day, month } = stamp();
    const total = await read('month', month);
    if ((total.usd || 0) * USD_JPY >= BUDGET_JPY) return { status: 503, jsonBody: { error: 'budget' } };
    const [field, cap] = LIMITS[kind];
    const mine = await read('day-' + day, who(request));
    if ((mine[field] || 0) >= cap) return { status: 429, jsonBody: { error: 'daily' } };
    return null;
  } catch {
    return { status: 503, jsonBody: { error: 'usage' } }; // if counting fails, stay closed rather than spend blindly
  }
}

async function record(request, kind, usd) {
  const { day, month } = stamp();
  const [field] = LIMITS[kind];
  await Promise.all([
    add('day-' + day, who(request), { [field]: 1, usd }),
    add('month', month, { [field]: 1, usd }),
  ]);
}

const claudeCost = usage => ((usage && usage.input_tokens) || 0) * CLAUDE_USD.input + ((usage && usage.output_tokens) || 0) * CLAUDE_USD.output;

module.exports = { check, record, claudeCost, SPEECH_TOKEN_USD };
