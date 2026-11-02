// Exchanges the Azure Speech key (kept on the server) for a 10-minute token the browser can use.
const { app } = require('@azure/functions');
const { guard } = require('../shared');
const usage = require('../usage');

app.http('token', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'token',
  handler: async (request, context) => {
    const blocked = guard(request, 20);
    if (blocked) return blocked;
    const limited = await usage.check(request, 'speech');
    if (limited) return limited;
    const region = (process.env.SPEECH_REGION || 'japaneast').trim();
    const res = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': (process.env.SPEECH_KEY || '').trim() },
    });
    if (!res.ok) {
      context.error('issueToken failed', res.status);
      return { status: 502, jsonBody: { error: 'speech' } };
    }
    const token = await res.text();
    await usage.record(request, 'speech', usage.SPEECH_TOKEN_USD);
    return { jsonBody: { token, region }, headers: { 'Cache-Control': 'no-store' } };
  },
});
