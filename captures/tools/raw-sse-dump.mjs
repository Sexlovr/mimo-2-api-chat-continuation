// Direct-API tiny chat: dump RAW SSE blocks verbatim (no filtering) to a file.
import crypto from 'node:crypto';
import fs from 'node:fs';

const cookies = JSON.parse(fs.readFileSync('E:/mimo-2-api-chat-continuation/captures/cookies-rapid-grove.json', 'utf8'));
const PH = encodeURIComponent(cookies.phToken);
const COOKIE = 'xiaomichatbot_serviceToken="' + cookies.serviceToken + '"; userId=' + cookies.userId + '; xiaomichatbot_ph="' + cookies.phToken + '"';
const BASE = 'https://aistudio.xiaomimimo.com';
const H = {
  'accept': '*/*', 'accept-language': 'en-US,en;q=0.9', 'content-type': 'application/json',
  'cookie': COOKIE, 'origin': BASE, 'referer': BASE + '/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'x-timezone': 'UTC'
};

const body = {
  msgId: crypto.randomBytes(16).toString('hex'),
  conversationId: crypto.randomBytes(16).toString('hex'),
  query: 'What is the capital of France? One word.',
  isEditedQuery: false,
  modelConfig: { enableThinking: false, webSearchStatus: 'disabled', model: 'mimo-v2.6-pro' },
  multiMedias: []
};

const res = await fetch(BASE + '/open-apis/bot/chat?xiaomichatbot_ph=' + PH, { method: 'POST', headers: H, body: JSON.stringify(body) });
console.error('HTTP ' + res.status);
const out = [];
let buf = '';
const reader = res.body.getReader();
const dec = new TextDecoder();
let finished = false;
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let idx;
  while ((idx = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
    out.push(JSON.stringify(block));
    try {
      const m = block.match(/^event:(.*)$/m);
      if (m && /finish/.test(m[1])) finished = true;
    } catch {}
  }
  if (finished) { try { reader.cancel(); } catch {} break; }
}
fs.writeFileSync('E:/mimo-2-api-chat-continuation/captures/net/raw-sse-dump.txt', out.join('\n'));
console.error('dumped ' + out.length + ' blocks');
