// User's combo test via direct API: 20k-token query + 25k-token file on a FRESH conversation.
// Question: do query-text and file-attachment budgets stack (→ ~45k effective) or share one pool?
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
const log = (s) => process.stderr.write('[combo] ' + s + '\n');

// ── 1) build the 25.6k-token file (102,000 chars, needle at 95,000) ──
const filler = 'The quick brown fox jumps over the lazy dog near the riverbank at dawn. ';
let fileContent = '';
while (fileContent.length < 95000) fileContent += filler;
fileContent = fileContent.slice(0, 95000) + '\nThe access code for the north gate is FOXTROT-8842.\n';
while (fileContent.length < 102000) fileContent += filler;
fileContent = fileContent.slice(0, 102000);
const fileBuf = Buffer.from(fileContent, 'utf8');
const fileMd5 = crypto.createHash('md5').update(fileBuf).digest('hex');
const tagged = `combo-E-${crypto.randomBytes(16).toString('hex')}.txt`;
log('file: 102000 chars, md5=' + fileMd5);

// ── 2) upload: genUploadInfo → PUT → parse ──
const gi = await (await fetch(`${BASE}/open-apis/resource/genUploadInfo?xiaomichatbot_ph=${PH}`, {
  method: 'POST', headers: H, body: JSON.stringify({ fileName: tagged, fileContentMd5: fileMd5 })
})).json();
if (gi.code !== 0) { console.log(JSON.stringify({ status: 'genUploadInfo_rejected', resp: gi })); process.exit(1); }
log('genUploadInfo ok, resourceId=' + gi.data.resourceId.slice(0, 8));

const put = await fetch(gi.data.uploadUrl, {
  method: 'PUT',
  headers: { 'content-type': 'application/octet-stream', 'content-md5': fileMd5 },
  body: fileBuf
});
log('PUT: HTTP ' + put.status);
if (!put.ok) { console.log(JSON.stringify({ status: 'put_failed', code: put.status })); process.exit(1); }

const parse = await (await fetch(`${BASE}/open-apis/resource/parse?fileUrl=${encodeURIComponent(gi.data.resourceUrl)}&xiaomichatbot_ph=${PH}`, {
  method: 'POST', headers: H, body: '{}'
})).json();
log('parse: ' + JSON.stringify(parse.data));
if (parse.code !== 0) { console.log(JSON.stringify({ status: 'parse_rejected', resp: parse })); process.exit(1); }

// ── 3) build the ~20k-token query (80,000 chars) with needle at the END ──
let query = '';
while (query.length < 99500) query += filler;
query = query.slice(0, 99500)
  + '\nThe validation string for this session is: ECHO-3319.\n\n'
  + 'What are the two marker values: the validation string stated in this message, and the access code stated in the attached document? Reply with both values.';
log('query: ' + query.length + ' chars (~' + Math.round(query.length / 4) + ' tokens)');

// ── 4) fresh conversation + /bot/chat with file attached ──
const conversationId = crypto.randomBytes(16).toString('hex');
const msgId = crypto.randomBytes(16).toString('hex');
const body = {
  msgId, conversationId, query, isEditedQuery: false,
  modelConfig: { enableThinking: false, webSearchStatus: 'disabled', model: 'mimo-v2.6-pro' },
  multiMedias: [{
    mediaType: 'file',
    fileUrl: gi.data.resourceUrl,
    compressedVideoUrl: '',
    audioTrackUrl: '',
    name: tagged,
    size: fileBuf.length,
    status: 'completed',
    objectName: gi.data.objectName,
    url: parse.data.id,
    tokenUsage: parse.data.tokenUsage
  }]
};

const ac = new AbortController();
const kill = setTimeout(() => ac.abort(), 240000);
const t0 = Date.now();
let httpStatus = null;
try {
  const res = await fetch(`${BASE}/open-apis/bot/chat?xiaomichatbot_ph=${PH}`, {
    method: 'POST', headers: H, body: JSON.stringify(body), signal: ac.signal
  });
  httpStatus = res.status;
  log('chat: HTTP ' + res.status + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');

  // parse SSE from the stream
  let text = '', thinking = '', usage = null, dialogId = null, finished = false, weirdEvents = {};
  let buf = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  loop: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const evm = block.match(/^event:(.*)$/m);
      const dtm = [...block.matchAll(/^data:(.*)$/mg)];
      const ev = evm ? evm[1].trim() : null;
      for (const d of dtm) {
        let p; try { p = JSON.parse(d[1]); } catch { continue; }
        if (ev === 'dialogId') dialogId = p.content;
        else if (ev === 'message') {
          if (p.type === 'text') text += (p.content || '').replace(/\0/g, '');
          else if (p.type === 'thinking') thinking += (p.content || '').replace(/\0/g, '');
          else weirdEvents['msg:' + p.type] = (weirdEvents['msg:' + p.type] || 0) + 1;
        }
        else if (ev === 'usage') usage = p;
        else if (ev === 'finish') finished = true;
        else weirdEvents[ev] = (weirdEvents[ev] || 0) + 1;
      }
    }
    if (finished) { try { reader.cancel(); } catch {} break loop; }
  }

  const verdict = {
    status: finished ? 'ok' : (text ? 'partial_no_finish' : 'empty_stream'),
    httpStatus,
    elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
    queryChars: query.length,
    fileSize: fileBuf.length,
    usage,
    weirdEvents,
    reply: text.slice(0, 700),
    needleQuery: /ECHO-3319/.test(text),
    needleFile: /FOXTROT-8842/.test(text),
    thinkingHead: thinking.slice(0, 300)
  };
  console.log(JSON.stringify(verdict, null, 1));
} catch (e) {
  console.log(JSON.stringify({ status: 'error', httpStatus, error: e.message, elapsedSec: +((Date.now() - t0) / 1000).toFixed(1) }));
} finally { clearTimeout(kill); }
