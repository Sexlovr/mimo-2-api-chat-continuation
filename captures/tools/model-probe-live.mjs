// Live-probe plausible chat model ids with a minimal 1-token request.
import crypto from 'node:crypto';
import fs from 'node:fs';

const cookies = JSON.parse(fs.readFileSync('E:/mimo-2-api-chat-continuation/captures/cookies-rapid-grove.json', 'utf8'));
const PH = encodeURIComponent(cookies.phToken);
const COOKIE = `xiaomichatbot_serviceToken="${cookies.serviceToken}"; userId=${cookies.userId}; xiaomichatbot_ph="${cookies.phToken}"`;
const BASE = 'https://aistudio.xiaomimimo.com';
const H = {
  'accept': '*/*', 'accept-language': 'en-US,en;q=0.9', 'content-type': 'application/json',
  'cookie': COOKIE, 'origin': BASE, 'referer': BASE + '/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'x-timezone': 'UTC'
};

const MODELS = [
  'mimo-v2.6-pro',
  'mimo-v2.6-flash',
  'mimo-v2.6-pro-ultraspeed-studio',
  'mimo-v2.5-pro',
  'mimo-v2.1-pro',
  'mimo-v2.1-pro-preview',
  'mimo-v2-pro',
  'mimo-v2-omni',
  'mimo-v2.1-omni',
  'mimo-v2.1-omni-preview'
];

const results = [];
for (const model of MODELS) {
  const body = {
    msgId: crypto.randomBytes(16).toString('hex'),
    conversationId: crypto.randomBytes(16).toString('hex'),
    query: 'Reply with exactly: ok',
    isEditedQuery: false,
    modelConfig: { enableThinking: false, webSearchStatus: 'disabled', model },
    multiMedias: []
  };
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const kill = setTimeout(() => ac.abort(), 45000);
    const res = await fetch(`${BASE}/open-apis/bot/chat?xiaomichatbot_ph=${PH}`, {
      method: 'POST', headers: H, body: JSON.stringify(body), signal: ac.signal
    });
    if (!res.ok) {
      clearTimeout(kill);
      const t = await res.text().catch(() => '');
      results.push({ model, verdict: 'HTTP ' + res.status, detail: t.slice(0, 120) });
      console.error(model + ' → HTTP ' + res.status);
      continue;
    }
    let text = '', finished = false, sbuf = '';
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sbuf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = sbuf.indexOf('\n\n')) >= 0) {
        const block = sbuf.slice(0, idx); sbuf = sbuf.slice(idx + 2);
        const evm = block.match(/^event:(.*)$/m);
        const dtm = [...block.matchAll(/^data:(.*)$/mg)];
        const ev = evm ? evm[1].trim() : null;
        for (const d of dtm) {
          let p; try { p = JSON.parse(d[1]); } catch { continue; }
          if (ev === 'message' && p.type === 'text') text += (p.content || '').replace(/\0/g, '');
          else if (ev === 'finish') finished = true;
        }
      }
      if (finished) { try { reader.cancel(); } catch {} break; }
    }
    clearTimeout(kill);
    results.push({ model, verdict: finished || text ? 'WORKS' : 'empty-stream', reply: text.slice(0, 60), sec: +((Date.now() - t0) / 1000).toFixed(1) });
    console.error(model + ' → ' + (finished || text ? 'WORKS (' + text.slice(0, 30).replace(/\n/g, ' ') + ')' : 'EMPTY STREAM'));
  } catch (e) {
    results.push({ model, verdict: 'error', detail: e.message });
    console.error(model + ' → error ' + e.message);
  }
}
console.log(JSON.stringify(results, null, 1));
