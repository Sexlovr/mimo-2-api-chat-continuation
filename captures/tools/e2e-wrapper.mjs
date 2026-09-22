// E2E through the local wrapper: stage 1 = big-context birth (file-priming path),
// stage 2 = marker continuation turn. Run with: node e2e-wrapper.mjs [stage]
import fs from 'node:fs';

const KEY = 'sk-mimo-775def3615341072cffb41152110fda8877020c77bda0474';
const BASE = 'http://127.0.0.1:7860';
const MODEL = 'mimo-v2.6-pro';
const filler = 'The quick brown fox jumps over the lazy dog near the riverbank at dawn. ';

// build ~350k chars of context: system + 2 big prior user/assistant turns + final user turn with needle
function bigContext() {
  const sys = 'You are a meticulous archival assistant. Answer concisely.';
  const big = (label) => {
    const parts = []; let len = 0;
    while (len < 100000) { parts.push(filler); len += filler.length; }
    return label + ':\n' + parts.join('');
  };
  const needle = 'VAULT-7719';
  // needle goes at the END of block A — that block becomes a FILE via file-priming,
  // so this proves ingestion of file content, not just the streamed query.
  const blockA = big('Prior context block A') + '\nThe archival reference code is ' + needle + '.';
  const finalUser = 'Archival reference code check.\n' + big('Prior context block B') + '\nState that you have processed the context, then stop.';
  return {
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: blockA },
      { role: 'assistant', content: 'Understood. All context blocks have been received and filed.' },
      { role: 'user', content: finalUser }
    ],
    needle
  };
}

// decode the zero-width marker from an assistant reply (same encoding as lib/markers.js)
const ZERO = '\u200B', ONE = '\u2060', SENT = '\u200C';
function decodeMarker(text) {
  const m = String(text || '').match(new RegExp(SENT + '([\\u200B\\u2060]+?)' + SENT));
  if (!m) return null;
  const bits = m[1];
  if (bits.length < 8 || bits.length % 4 !== 0) return null;
  let id = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    let v = 0;
    for (let j = 0; j < 4; j++) v = (v << 1) | (bits[i + j] === ONE ? 1 : 0);
    id += v.toString(16);
  }
  return id;
}
function stripMarker(text) {
  return String(text || '').replace(new RegExp(SENT + '[\\u200B\\u2060]+' + SENT, 'g'), '');
}

async function chat(messages, stream) {
  const t0 = Date.now();
  const res = await fetch(BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'authorization': 'Bearer ' + KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, stream: !!stream })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('wrapper HTTP ' + res.status + ': ' + t.slice(0, 300));
  }
  if (!stream) {
    const j = await res.json();
    return { text: j.choices?.[0]?.message?.content || '', usage: j.usage, elapsedSec: +((Date.now() - t0) / 1000).toFixed(1) };
  }
  // stream
  let text = '', usage = null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const dm = block.match(/^data: (.*)$/m);
      if (!dm) continue;
      const d = dm[1];
      if (d === '[DONE]') continue;
      try {
        const j = JSON.parse(d);
        const c = j.choices?.[0]?.delta?.content;
        if (c) text += c;
        if (j.usage) usage = j.usage;
      } catch {}
    }
  }
  return { text, usage, elapsedSec: +((Date.now() - t0) / 1000).toFixed(1) };
}

const stage = process.argv[2] || '1';

if (stage === '1') {
  const { messages, needle } = bigContext();
  console.log('context size:', JSON.stringify(messages).length, 'chars, needle:', needle);
  const r = await chat(messages, false);
  const marker = decodeMarker(r.text);
  const clean = stripMarker(r.text);
  console.log(JSON.stringify({
    stage: 1,
    elapsedSec: r.elapsedSec,
    usage: r.usage,
    needleFound: clean.includes(needle),
    replyHead: clean.slice(0, 200),
    marker: marker ? marker.slice(0, 12) + '…(' + marker.length + ' hex)' : null
  }, null, 1));
  // save turn state for stage 2
  fs.writeFileSync('E:/mimo-2-api-chat-continuation/captures/e2e-stage1.json', JSON.stringify({
    messages, assistantReply: r.text, marker, needle
  }));
} else {
  const st = JSON.parse(fs.readFileSync('E:/mimo-2-api-chat-continuation/captures/e2e-stage1.json', 'utf8'));
  if (!st.marker) { console.log('no marker from stage 1 — cannot continue'); process.exit(1); }
  const messages = st.messages.concat([{ role: 'assistant', content: st.assistantReply }]);
  messages.push({ role: 'user', content: 'Report the archival reference code stated in the reference document filed earlier in this conversation. Reply with just the code.' });
  const r = await chat(messages, false);
  const clean = stripMarker(r.text);
  console.log(JSON.stringify({
    stage: 2,
    elapsedSec: r.elapsedSec,
    usage: r.usage,
    needleRecalled: clean.includes(st.needle),
    saysContinued: /CONTINUED/i.test(clean),
    replyHead: clean.slice(0, 250)
  }, null, 1));
}
