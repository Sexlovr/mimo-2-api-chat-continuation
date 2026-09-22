// Q2: Does MiMo build conversation context server-side (full stack) or via UI replay?
// 3 sequential turns, each with a 102k-char file (distinct needle), then a plain
// final query asking for all 3 codes. Final promptTokens reveals stacking vs RAG.
// Also: turn 2 and 3 test whether we can 'fake-build' multi-message history via API.
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
const log = (s) => process.stderr.write('[q2] ' + s + '\n');
const filler = 'The quick brown fox jumps over the lazy dog near the riverbank at dawn. ';

const CODES = ['GAMMA-3113', 'DELTA-8842', 'EPSILON-6029'];

async function uploadFile(content) {
  const buf = Buffer.from(content, 'utf8');
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  const tagged = `q2-${crypto.randomBytes(8).toString('hex')}.txt`;
  const gi = await (await fetch(`${BASE}/open-apis/resource/genUploadInfo?xiaomichatbot_ph=${PH}`, {
    method: 'POST', headers: H, body: JSON.stringify({ fileName: tagged, fileContentMd5: md5 })
  })).json();
  if (gi.code !== 0) throw new Error('genUploadInfo rejected: ' + JSON.stringify(gi).slice(0, 200));
  const put = await fetch(gi.data.uploadUrl, {
    method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'content-md5': md5 }, body: buf
  });
  if (!put.ok) throw new Error('PUT HTTP ' + put.status);
  const parse = await (await fetch(`${BASE}/open-apis/resource/parse?fileUrl=${encodeURIComponent(gi.data.resourceUrl)}&xiaomichatbot_ph=${PH}`, {
    method: 'POST', headers: H, body: '{}'
  })).json();
  if (parse.code !== 0) throw new Error('parse rejected: ' + JSON.stringify(parse).slice(0, 200));
  return {
    mediaType: 'file', fileUrl: gi.data.resourceUrl, compressedVideoUrl: '', audioTrackUrl: '',
    name: tagged, size: buf.length, status: 'completed', objectName: gi.data.objectName,
    url: parse.data.id, tokenUsage: parse.data.tokenUsage
  };
}

function makeFileContent(code) {
  const parts = []; let len = 0;
  while (len < 95000) { parts.push(filler); len += filler.length; }
  parts.push(`\nThe archival reference code is ${code}.\n`); len += 40;
  while (len < 102000) { parts.push(filler); len += filler.length; }
  return parts.join('').slice(0, 102000);
}

async function chat(conversationId, query, multiMedias) {
  const body = {
    msgId: crypto.randomBytes(16).toString('hex'),
    conversationId, query, isEditedQuery: false,
    modelConfig: { enableThinking: false, webSearchStatus: 'disabled', model: 'mimo-v2.6-pro' },
    multiMedias: multiMedias || []
  };
  const t0 = Date.now();
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), 240000);
  try {
    const res = await fetch(`${BASE}/open-apis/bot/chat?xiaomichatbot_ph=${PH}`, {
      method: 'POST', headers: H, body: JSON.stringify(body), signal: ac.signal
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
  } finally { clearTimeout(kill); }
}

const conversationId = crypto.randomBytes(16).toString('hex');
log('conversation: ' + conversationId);
const turns = [];

// Turns 1-3: one file each, tiny query
for (let i = 0; i < 3; i++) {
  const code = CODES[i];
  log(`turn ${i + 1}: uploading file with ${code}...`);
  const mm = await uploadFile(makeFileContent(code));
  const r = await chat(conversationId, 'Please acknowledge that you have received and filed this reference document. One short sentence only.', [mm]);
  log(`turn ${i + 1}: finished=${r.finished} promptTokens=${r.usage ? r.usage.promptTokens : '?'} (${r.elapsedSec}s)`);
  turns.push({ turn: i + 1, code, promptTokens: r.usage ? r.usage.promptTokens : null, reply: r.text.slice(0, 120) });
}

// Turn 4: plain recall query, NO file
log('turn 4: recall query...');
const r4 = await chat(conversationId, 'Report the three archival reference codes from the three documents filed earlier in this conversation, in order. Reply with just the three codes.', []);
log(`turn 4: finished=${r4.finished} promptTokens=${r4.usage ? r4.usage.promptTokens : '?'} (${r4.elapsedSec}s)`);

const found = CODES.map(c => r4.text.includes(c));
console.log(JSON.stringify({
  turns,
  finalTurn: {
    promptTokens: r4.usage ? r4.usage.promptTokens : null,
    completionTokens: r4.usage ? r4.usage.completionTokens : null,
    allThreeFound: found.every(Boolean),
    found,
    reply: r4.text.slice(0, 400)
  },
  interpretationHint: 'turn-4 promptTokens ~= 3x25.6k + overhead (~80k) => full server-side stacking; small (~30k or less) => RAG/truncation'
}, null, 1));
