// Q1: Direct-API query-size escalation on mimo-v2.6-pro (README's 100k FAIL was v2.5).
// Tests 110k, 200k, 500k, 1M chars in the QUERY alone (no files), needle at end.
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
const log = (s) => process.stderr.write('[q1] ' + s + '\n');

const filler = 'The quick brown fox jumps over the lazy dog near the riverbank at dawn. ';
const SIZES = [110000, 200000, 500000, 1000000];

async function oneRound(size) {
  // build query: filler + needle near end + final ask
  const parts = [];
  let len = 0;
  while (len < size - 200) { parts.push(filler); len += filler.length; }
  const needle = 'HARNESS-' + crypto.randomBytes(2).toString('hex').toUpperCase();
  const tail = `\nThe checkpoint marker is ${needle}.\nWhat is the checkpoint marker stated above? Reply with just the marker.`;
  const query = parts.join('').slice(0, size - tail.length) + tail;

  const body = {
    msgId: crypto.randomBytes(16).toString('hex'),
    conversationId: crypto.randomBytes(16).toString('hex'),
    query, isEditedQuery: false,
    modelConfig: { enableThinking: false, webSearchStatus: 'disabled', model: 'mimo-v2.6-pro' },
    multiMedias: []
  };
  const t0 = Date.now();
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), 180000);
  try {
    const res = await fetch(`${BASE}/open-apis/bot/chat?xiaomichatbot_ph=${PH}`, {
      method: 'POST', headers: H, body: JSON.stringify(body), signal: ac.signal
    });
    log(`size=${size} HTTP ${res.status} (${((Date.now() - t0) / 1000).toFixed(1)}s to headers)`);
    if (!res.ok) {
      const t = await res.text();
      return { size, http: res.status, body: t.slice(0, 300) };
    }
    // stream SSE
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
    return {
      size, http: res.status, finished, elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
      promptTokens: usage ? usage.promptTokens : null,
      needleFound: text.includes(needle),
      replyHead: text.slice(0, 150)
    };
  } catch (e) {
    return { size, error: e.message, elapsedSec: +((Date.now() - t0) / 1000).toFixed(1) };
  } finally { clearTimeout(kill); }
}

const results = [];
for (const s of SIZES) {
  const r = await oneRound(s);
  results.push(r);
  log(JSON.stringify(r));
  if (r.error || (r.http && r.http !== 200) || r.finished === false) {
    log('stopping escalation — ceiling reached at ' + s);
    break;
  }
}
console.log(JSON.stringify(results, null, 1));
