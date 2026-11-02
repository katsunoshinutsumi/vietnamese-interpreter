// Shared checks for every API call: the family passcode and a simple per-device rate limit.
const crypto = require('node:crypto');

function passcodeOk(request) {
  const expected = process.env.FAMILY_CODE || '';
  const given = request.headers.get('x-family-code') || '';
  if (!expected || !given) return false;
  const a = Buffer.from(expected), b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Per-instance limit; enough to stop a runaway loop or a leaked passcode from draining the budget quickly.
const hits = new Map();
function rateOk(request, perMinute) {
  const who = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(who) || []).filter(t => now - t < 60_000);
  recent.push(now);
  hits.set(who, recent);
  return recent.length <= perMinute;
}

function guard(request, perMinute) {
  if (!passcodeOk(request)) return { status: 401, jsonBody: { error: 'passcode' } };
  if (!rateOk(request, perMinute)) return { status: 429, jsonBody: { error: 'rate' } };
  return null;
}

module.exports = { guard };
