// Final E2E: 5MB file, needle A at char 50k (inside ~102.4k window), needle B at char 2M (outside).
// Confirms huge-file ingestion = first ~102.4k chars, rest truncated.
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
const log = (s) => process.stderr.write('[e2e] ' + s + '\n');

const SIZE = 5 * 1024 * 1024;
const filler = 'The quick brown fox jumps over the lazy dog near the riverbank at dawn. ';
// build via array join for speed
const parts = [];
let len = 0;
const pushFill = (until) => { while (len < until) { parts.push(filler); len += filler.length; } };
pushFill(50000);
parts.push('\nNEEDLE-A: The library password is LIBRA-4471.\n'); len += 46;
pushFill(2000000);
parts.push('\nNEEDLE-B: The observatory password is ORION-9932.\n'); len += 48;
pushFill(SIZE);
const content = parts.join('').slice(0, SIZE);
const buf = Buffer.from(content, 'utf8');
const md5 = crypto.createHash('md5').update(buf).digest('hex');
const tagged = `e2e-5mb-${crypto.randomBytes(16).toString('hex')}.txt`;
log('file: ' + buf.length + ' bytes, needles at ~50k and ~2M');

const gi = await (await fetch(`${BASE}/open-apis/resource/genUploadInfo?xiaomichatbot_ph=${PH}`, {
  method: 'POST', headers: H, body: JSON.stringify({ fileName: tagged, fileContentMd5: md5 })
})).json();
if (gi.code !== 0) { console.log(JSON.stringify({ status: 'genUploadInfo_rejected', resp: gi })); process.exit(1); }
const put = await fetch(gi.data.uploadUrl, {
  method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'content-md5': md5 }, body: buf
});
log('PUT: HTTP ' + put.status);
if (!put.ok) { console.log(JSON.stringify({ status: 'put_failed', code: put.status })); process.exit(1); }
const parse = await (await fetch(`${BASE}/open-apis/resource/parse?fileUrl=${encodeURIComponent(gi.data.resourceUrl)}&xiaomichatbot_ph=${PH}`, {
  method: 'POST', headers: H, body: '{}'
})).json();
log('parse: ' + JSON.stringify(parse.data));
if (parse.code !== 0) { console.log(JSON.stringify({ status: 'parse_rejected', resp: parse })); process.exit(1); }

const body = {
  msgId: crypto.randomBytes(16).toString('hex'),
  conversationId: crypto.randomBytes(16).toString('hex'),
  query: 'The attached document contains two passwords (NEEDLE-A and NEEDLE-B). Report both passwords exactly as written. If one is missing, say which one is missing.',
  isEditedQuery: false,
  modelConfig: { enableThinking: false, webSearchStatus: 'disabled', model: 'mimo-v2.6-pro' },
  multiMedias: [{
    mediaType: 'file', fileUrl: gi.data.resourceUrl, compressedVideoUrl: '', audioTrackUrl: '',
    name: tagged, size: buf.length, status: 'completed', objectName: gi.data.objectName,
    url: parse.data.id, tokenUsage: parse.data.tokenUsage
  }]
};

const t0 = Date.now();
const res = await fetch(`${BASE}/open-apis/bot/chat?xiaomichatbot_ph=${PH}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
log('chat: HTTP ' + res.status);
let text = '', usage = null, finished = false;
let sbuf = '';
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
      else if (ev === 'usage') usage = p;
      else if (ev === 'finish') finished = true;
    }
  }
  if (finished) { try { reader.cancel(); } catch {} break; }
}
console.log(JSON.stringify({
  status: finished ? 'ok' : (text ? 'partial' : 'empty'),
  elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
  usage,
  needleA_found: /LIBRA-4471/.test(text),
  needleB_found: /ORION-9932/.test(text),
  reply: text.slice(0, 500)
}, null, 1));
