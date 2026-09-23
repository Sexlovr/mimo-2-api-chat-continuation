// A/B benchmark: identical 5-turn conversation (2 big-context turns + 3 small
// recall turns) against whatever branch is currently checked out and running.
// Usage: node ab-timing.mjs <label>  → writes captures/ab-<label>.json
import fs from 'node:fs';

const KEY = 'sk-mimo-775def3615341072cffb41152110fda8877020c77bda0474';
const BASE = 'http://127.0.0.1:7860';
const LABEL = process.argv[2] || 'run';
const filler = 'The quick brown fox jumps over the lazy dog near the riverbank at dawn. ';

function bigTurn(needle) {
  const parts = []; let len = 0;
  while (len < 100000) { parts.push(filler); len += filler.length; }
  return parts.join('').slice(0, 100000) + '\nThe archival reference code is ' + needle + '.';
}

const TURNS = [
  { role: 'user', content: bigTurn('KILO-4141') },
  { role: 'user', content: bigTurn('LIMA-2727') },
  { role: 'user', content: 'Briefly confirm you have received the two reference documents.' },
  { role: 'user', content: 'Report the archival reference code from the FIRST document. Reply with just the code.' },
  { role: 'user', content: 'Now report the code from the SECOND document. Reply with just the code.' }
];

// decode + strip zero-width markers (marker format mirrors lib/markers.js)
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
function stripMarkers(text) {
  return String(text || '').replace(new RegExp(SENT + '[\\u200B\\u2060]+' + SENT, 'g'), '');
}

async function chat(messages) {
  const t0 = Date.now();
  const res = await fetch(BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'authorization': 'Bearer ' + KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'mimo-v2.6-pro', messages, stream: false })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('wrapper HTTP ' + res.status + ': ' + t.slice(0, 200));
  }
  const j = await res.json();
  const raw = j.choices?.[0]?.message?.content || '';
  return {
    elapsedMs: Date.now() - t0,
    raw,                          // verbatim, WITH any marker — this goes back into history
    reply: stripMarkers(raw),
    marker: decodeMarker(raw),
    usage: j.usage || null
  };
}

// Build a REAL multi-turn client: keep full message history, echo assistant
// replies (with their markers) back as assistant turns, exactly like
// SillyTavern would.
const history = [{ role: 'system', content: 'You are a meticulous archival assistant. Answer concisely.' }];
const results = [];
const turns = [];
let markersSeen = [];
for (let i = 0; i < TURNS.length; i++) {
  history.push({ role: 'user', content: TURNS[i].content });
  let r;
  try {
    r = await chat(history);
  } catch (e) {
    results.push({ turn: i + 1, error: e.message });
    break;
  }
  if (r.marker) markersSeen.push(r.marker);
  // echo the RAW assistant content (marker included) back into history —
  // exactly what a real client (SillyTavern) does
  history.push({ role: 'assistant', content: r.raw });
  results.push({
    turn: i + 1,
    elapsedSec: +(r.elapsedMs / 1000).toFixed(1),
    promptTokens: r.usage?.prompt_tokens ?? null,
    replyLen: r.reply.length,
    replyFull: r.reply,
    replyHead: r.reply.slice(0, 120),
    hasMarker: !!r.marker
  });
  console.error(`turn ${i + 1}: ${r.elapsedMs}ms  marker=${r.marker ? 'yes' : 'no'}  reply="${r.reply.slice(0, 60).replace(/\n/g, ' ')}"`);
}

// recall checks run on the FULL reply text (results, not the truncated head)
const t4 = results.find(x => x.turn === 4);
const t5 = results.find(x => x.turn === 5);
const recall1 = t4?.replyFull || t4?.replyHead || '';
const recall2 = t5?.replyFull || t5?.replyHead || '';
const out = {
  label: LABEL,
  turns: results,
  markers: markersSeen,
  contextMemory: {
    firstCodeRecalled: recall1.includes('KILO-4141'),
    secondCodeRecalled: recall2.includes('LIMA-2727')
  },
  totalSec: +(results.reduce((s, r) => s + (r.elapsedSec || 0), 0)).toFixed(1)
};
fs.writeFileSync(`E:/mimo-2-api-chat-continuation/captures/ab-${LABEL}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
