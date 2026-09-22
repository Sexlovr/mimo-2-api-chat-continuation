// Pipelining test: fire 3 file-turns back-to-back WITHOUT waiting for their streams,
// then a full recall turn. If all 3 needles return + linear promptTokens, the server
// commits history per-request and birth latency = upload + one final response.
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
const log = (s) => process.stderr.write('[pipe] ' + s + '\n');
const filler = 'The quick brown fox jumps over the lazy dog near the riverbank at dawn. ';
const CODES = ['OMEGA-1122', 'SIGMA-3344', 'TAU-5566'];

// upload all files first, in parallel (no model anywhere)
async function uploadFile(content) {
  const buf = Buffer.from(content, 'utf8');
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  const tagged = `pipe-${crypto.randomBytes(8).toString('hex')}.txt`;
  const gi = await (await fetch(`${BASE}/open-apis/resource/genUploadInfo?xiaomichatbot_ph=${PH}`, {
    method: 'POST', headers: H, body: JSON.stringify({ fileName: tagged, fileContentMd5: md5 })
  })).json();
  if (gi.code !== 0) throw new Error('genUploadInfo rejected');
  const put = await fetch(gi.data.uploadUrl, {
    method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'content-md5': md5 }, body: buf
  });
  if (!put.ok) throw new Error('PUT HTTP ' + put.status);
  const parse = await (await fetch(`${BASE}/open-apis/resource/parse?fileUrl=${encodeURIComponent(gi.data.resourceUrl)}&xiaomichatbot_ph=${PH}`, {
    method: 'POST', headers: H, body: '{}'
  })).json();
  if (parse.code !== 0) throw new Error('parse rejected');
  return {
    mediaType: 'file', fileUrl: gi.data.resourceUrl, compressedVideoUrl: '', audioTrackUrl: '',
    name: tagged, size: buf.length, status: 'completed', objectName: gi.data.objectName,
    url: parse.data.id, tokenUsage: parse.data.tokenUsage
  };
}

function makeFileContent(code) {
  const parts = []; let len = 0;
  while (len < 95000) { parts.push(filler); len += filler.length; }
  parts.push(`\nThe archival reference code is ${code}.\n`);
  while (len < 102000) { parts.push(filler); len += filler.length; }
  return parts.join('').slice(0, 102000);
}

// fire a chat turn but do NOT wait for its stream to finish — only confirm the
// request was accepted (200 + first bytes), then move on. Body is left draining
// in the background.
async function fireTurn(conversationId, query, multiMedias) {
  const body = {
    msgId: crypto.randomBytes(16).toString('hex'),
    conversationId, query, isEditedQuery: false,
    modelConfig: { enableThinking: false, webSearchStatus: 'disabled', model: 'mimo-v2.6-pro' },
    multiMedias: multiMedias || []
  };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/open-apis/bot/chat?xiaomichatbot_ph=${PH}`, {
    method: 'POST', headers: H, body: JSON.stringify(body)
  });
  if (!res.ok) { const t = await res.text(); throw new Error('chat HTTP ' + res.status + ': ' + t.slice(0, 200)); }
  // read just the first chunk to confirm the stream started, then keep draining in background
  const reader = res.body.getReader();
  const first = await reader.read();
  log(`turn fired: +${((Date.now() - t0) / 1000).toFixed(1)}s got ${first.value ? first.value.length : 0}B`);
  // drain in background without blocking
  (async () => { try { while (true) { const { done } = await reader.read(); if (done) break; } } catch {} })();
  return (Date.now() - t0) / 1000;
}

// full read for the final turn
async function chatFull(conversationId, query, multiMedias) {
  const body = {
    msgId: crypto.randomBytes(16).toString('hex'),
    conversationId, query, isEditedQuery: false,
    modelConfig: { enableThinking: false, webSearchStatus: 'disabled', model: 'mimo-v2.6-pro' },
    multiMedias: multiMedias || []
  };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/open-apis/bot/chat?xiaomichatbot_ph=${PH}`, {
    method: 'POST', headers: H, body: JSON.stringify(body)
  });
  if (!res.ok) { const t = await res.text(); throw new Error('chat HTTP ' + res.status + ': ' + t.slice(0, 200)); }
  let text = '', usage = null, finished = false, sbuf = '';
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
  return { text, usage, finished, elapsedSec: +((Date.now() - t0) / 1000).toFixed(1) };
}

const conversationId = crypto.randomBytes(16).toString('hex');
log('conversation: ' + conversationId);

const tStart = Date.now();
// 1) parallel uploads (no model)
const tU = Date.now();
const mms = await Promise.all(CODES.map(c => uploadFile(makeFileContent(c))));
log('uploads done in ' + ((Date.now() - tU) / 1000).toFixed(1) + 's (parallel, no model)');

// 2) fire the 3 priming turns back-to-back, no waiting between them
const fireTimes = [];
for (let i = 0; i < 3; i++) {
  const dt = await fireTurn(conversationId, 'Acknowledge receipt of this reference document in one short sentence.', [mms[i]]);
  fireTimes.push(dt);
}
log('3 turns fired, total ' + ((Date.now() - tStart) / 1000).toFixed(1) + 's from start');

// 3) wait a moment for server-side history commits, then the recall turn (full read)
await new Promise(r => setTimeout(r, 3000));
log('recall turn...');
const r4 = await chatFull(conversationId, 'Report the three archival reference codes from the three documents filed earlier in this conversation, in order. Reply with just the three codes.', []);
log('recall done: finished=' + r4.finished + ' promptTokens=' + (r4.usage ? r4.usage.promptTokens : '?') + ' (' + r4.elapsedSec + 's)');

const found = CODES.map(c => r4.text.includes(c));
console.log(JSON.stringify({
  fireTimes,
  totalBirthSec: +((Date.now() - tStart) / 1000).toFixed(1),
  recall: {
    promptTokens: r4.usage ? r4.usage.promptTokens : null,
    allThreeFound: found.every(Boolean),
    found,
    reply: r4.text.slice(0, 300),
    recallElapsedSec: r4.elapsedSec
  },
  verdict: found.every(Boolean) && r4.usage && r4.usage.promptTokens > 70000
    ? 'PIPELINING WORKS — history committed per-request, priming turns overlap'
    : (found.every(Boolean)
      ? 'needles survived but token count low — investigate'
      : 'PIPELINING FAILS — must wait for each stream before next turn')
}, null, 1));
