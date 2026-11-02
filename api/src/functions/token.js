// Exchanges the Azure Speech key (kept on the server) for a 10-minute token the browser can use.
const { app } = require('@azure/functions');
const { guard } = require('../shared');

app.http('token', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'token',
  handler: async (request, context) => {
    const blocked = guard(request, 20);
    if (blocked) return blocked;
    const region = process.env.SPEECH_REGION || 'japaneast';
    const res = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': process.env.SPEECH_KEY || '' },
    });
    if (!res.ok) {
      context.error('issueToken failed', res.status);
      return { status: 502, jsonBody: { error: 'speech' } };
    }
    return { jsonBody: { token: await res.text(), region }, headers: { 'Cache-Control': 'no-store' } };
  },
});
