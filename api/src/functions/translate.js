// Gentle, family-style translation with Claude. The Anthropic key never leaves the server.
const { app } = require('@azure/functions');
const Anthropic = require('@anthropic-ai/sdk');
const { guard } = require('../shared');

const SYSTEM = `You interpret a spoken conversation inside a family: one person speaks Japanese, the other speaks Vietnamese.
Translate the latest utterance into the other language the way a warm, caring family member would say it out loud: gentle, kind, natural spoken language, never stiff or word-for-word.
Japanese: soft everyday speech (for example 〜だよ, 〜してね, 〜かな). Avoid formal keigo unless the speaker is clearly being formal.
Vietnamese: choose natural family pronouns and particles (con, mẹ, bố, anh, em, ông, bà, nhé, nha, ạ for elders) from the family notes and the conversation so far; when unsure, use warm neutral wording.
Keep the meaning, the feeling and the amount of detail. Do not add new content, explanations or quotation marks.
The input comes from speech recognition and may contain small mistakes; translate what the speaker meant.
Reply with the translation only.`;
const NAMES = { ja: 'Japanese', vi: 'Vietnamese' };
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the app settings

app.http('translate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'translate',
  handler: async (request, context) => {
    const blocked = guard(request, 30);
    if (blocked) return blocked;
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'json' } }; }
    const text = String(body.text || '').slice(0, 1000);
    const sl = body.sl === 'vi' ? 'vi' : 'ja';
    const tl = sl === 'ja' ? 'vi' : 'ja';
    if (!text.trim()) return { status: 400, jsonBody: { error: 'empty' } };
    const family = String(body.family || '').slice(0, 300);
    const recent = (Array.isArray(body.recent) ? body.recent : []).slice(-6)
      .map(t => `${NAMES[t.from] || 'Speaker'} speaker: ${String(t.src || '').slice(0, 300)}`).join('\n');
    const prompt = (family ? `Family notes: ${family}\n\n` : '') +
      (recent ? `Conversation so far:\n${recent}\n\n` : '') +
      `Translate this ${NAMES[sl]} utterance into ${NAMES[tl]}:\n${text}`;
    try {
      const res = await client.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 2000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      });
      if (res.stop_reason === 'refusal') return { status: 422, jsonBody: { error: 'refusal' } };
      const out = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      return out ? { jsonBody: { text: out } } : { status: 502, jsonBody: { error: 'empty' } };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return { status: 429, jsonBody: { error: 'rate' } };
      context.error('claude failed', e && e.status, e && e.message);
      return { status: 502, jsonBody: { error: 'claude' } };
    }
  },
});
