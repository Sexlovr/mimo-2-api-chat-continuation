// Add the rapid-grove account (from local cookies) to the deployed HF Space.
import fs from 'node:fs';

const SPACE = 'https://rhbstntsmnde-mimo.hf.space';
const PW = process.env.SPACE_PW || 'admin';
const c = JSON.parse(fs.readFileSync('E:/mimo-2-api-chat-continuation/captures/cookies-rapid-grove.json', 'utf8'));

const login = await (await fetch(SPACE + '/admin/login', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PW })
})).json();
if (!login.token) { console.log('LOGIN FAILED:', JSON.stringify(login)); process.exit(1); }
const H = { 'authorization': 'Bearer ' + login.token, 'content-type': 'application/json' };
console.log('admin login ok');

const before = await (await fetch(SPACE + '/admin/accounts', { headers: H })).json();
console.log('accounts before:', JSON.stringify(before.map(a => ({ id: a.id, user_id: a.user_id, active: a.active, label: a.label }))));

// parseCurl is plain regex — a minimal cURL carrying the three tokens is enough
const curl = "curl 'https://aistudio.xiaomimimo.com/open-apis/bot/chat' -H 'cookie: xiaomichatbot_serviceToken=\"" + c.serviceToken + "\"; userId=" + c.userId + "; xiaomichatbot_ph=\"" + c.phToken + "\"'";
const add = await (await fetch(SPACE + '/admin/accounts', {
  method: 'POST', headers: H, body: JSON.stringify({ curl, label: 'rapid-grove' })
})).json();
console.log('add:', JSON.stringify(add));
if (add.error) process.exit(1);

const accId = add.id;
const test = await (await fetch(SPACE + '/admin/accounts/' + accId + '/test', { method: 'POST', headers: H, body: '{}' })).json();
console.log('account test:', JSON.stringify(test).slice(0, 400));

// ensure an API key exists and run one real chat through the deployed wrapper
let keys = await (await fetch(SPACE + '/admin/keys', { headers: H })).json();
if (!Array.isArray(keys) || keys.length === 0) {
  const k = await (await fetch(SPACE + '/admin/keys', { method: 'POST', headers: H, body: JSON.stringify({ name: 'default' }) })).json();
  console.log('key created:', k.key);
  keys = [k];
}
const key = keys[0].key;
const r = await fetch(SPACE + '/v1/chat/completions', {
  method: 'POST',
  headers: { 'authorization': 'Bearer ' + key, 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'mimo-v2.6-pro', messages: [{ role: 'user', content: 'Reply with exactly: ok' }], stream: false })
});
const j = await r.json();
console.log('live chat:', r.status, JSON.stringify({ content: (j.choices?.[0]?.message?.content || j.error?.message || '').slice(0, 80), has_reasoning: !!j.choices?.[0]?.message?.reasoning_content, usage: j.usage }));
