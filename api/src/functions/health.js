// Setup check that reveals no secrets: which settings exist and whether Azure accepts the speech key.
// Results are cached for a minute so the check cannot be used to hammer Azure.
const { app } = require('@azure/functions');

let cached = null, cachedAt = 0;

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async () => {
    if (cached && Date.now() - cachedAt < 60_000) return { jsonBody: cached };
    const key = (process.env.SPEECH_KEY || '').trim();
    const region = (process.env.SPEECH_REGION || 'japaneast').trim();
    let speech = 'no-key';
    if (key) {
      try {
        const res = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
          method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key },
        });
        speech = res.ok ? 'ok' : `azure-${res.status}`;
      } catch { speech = 'unreachable'; }
    }
    cached = {
      speech,
      region,
      speechKeyLength: key.length,
      passcodeSet: !!(process.env.FAMILY_CODE || '').trim(),
      aiTranslation: !!process.env.ANTHROPIC_API_KEY,
      usageStorage: !!process.env.STORAGE_CONNECTION,
    };
    cachedAt = Date.now();
    return { jsonBody: cached, headers: { 'Cache-Control': 'no-store' } };
  },
});
