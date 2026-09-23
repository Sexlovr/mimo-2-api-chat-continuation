// Inspect raw SSE chunk structure from a captured /bot/chat stream.
import fs from 'node:fs';

const file = process.argv[2] || 'E:/mimo-2-api-chat-continuation/captures/net/send-text-100kb.jsonl';
const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const chatReq = lines.find(e => e.e === 'req' && e.url.includes('/bot/chat'));
if (!chatReq) { console.log('no chat request in this log'); process.exit(0); }
const ss = lines.filter(e => e.e === 'sse' && e.id === chatReq.id);
let n = 0;
for (const s of ss) {
  try {
    const d = JSON.parse(s.d);
    if (d.content !== undefined || d.type) {
      n++;
      console.log(n + ': ev=' + s.ev + ' type=' + d.type + ' content=' + JSON.stringify(String(d.content ?? '').slice(0, 110)));
      if (n >= 12) break;
    }
  } catch {}
}
console.log('total sse blocks:', ss.length);
