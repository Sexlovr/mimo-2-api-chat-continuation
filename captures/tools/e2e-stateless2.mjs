// Stateless E2E stage 2: resend full history + stage-1 assistant reply + recall question.
// Expect: fresh Stateless+fileprime conv id (different from stage 1) + needle recalled.
import fs from 'node:fs';

const KEY = 'sk-mimo-775def3615341072cffb41152110fda8877020c77bda0474';
const BASE = 'http://127.0.0.1:7860';

const st1 = JSON.parse(fs.readFileSync('E:/mimo-2-api-chat-continuation/captures/e2e-stage1.json', 'utf8'));
const messages = st1.messages.concat([{ role: 'assistant', content: st1.assistantReply }]);
messages.push({ role: 'user', content: 'Report the archival reference code stated in the reference document filed earlier in this conversation. Reply with just the code.' });

const t0 = Date.now();
const res = await fetch(BASE + '/v1/chat/completions', {
  method: 'POST',
  headers: { 'authorization': 'Bearer ' + KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'mimo-v2.6-pro', messages, stream: false })
});
const j = await res.json();
const text = j.choices?.[0]?.message?.content || '';
console.log(JSON.stringify({
  http: res.status,
  elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
  needleRecalled: text.includes(st1.needle),
  usage: j.usage,
  replyHead: text.slice(0, 250)
}, null, 1));
