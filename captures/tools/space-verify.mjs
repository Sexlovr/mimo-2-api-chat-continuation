// Post-factory-rebuild verification on the deployed Space.
const SPACE = 'https://rhbstntsmnde-mimo.hf.space';

const login = await (await fetch(SPACE + '/admin/login', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'admin' })
})).json();
if (!login.token) { console.log('LOGIN FAILED', JSON.stringify(login)); process.exit(1); }
const H = { 'authorization': 'Bearer ' + login.token, 'content-type': 'application/json' };
console.log('admin login ok');

const accs = await (await fetch(SPACE + '/admin/accounts', { headers: H })).json();
console.log('ACCOUNTS:', JSON.stringify(accs.map(a => ({ id: a.id, label: a.label, user_id: a.user_id, active: a.active }))));

const models = await (await fetch(SPACE + '/admin/models', { headers: H })).json();
console.log('MODELS:', JSON.stringify(models.map(m => m.model_id)));

const al = await fetch(SPACE + '/admin/accounts/autologin', { method: 'POST', headers: H, body: '{}' });
console.log('AUTOLOGIN status (expect 404):', al.status);

const launch = await (await fetch(SPACE + '/admin/browser/launch', { method: 'POST', headers: H, body: '{}' })).json();
console.log('BROWSER LAUNCH:', JSON.stringify(launch));

const kill = await (await fetch(SPACE + '/admin/browser/kill', { method: 'POST', headers: H, body: '{}' })).json();
console.log('BROWSER KILL:', JSON.stringify(kill));

// Re-add rapid-grove from the local cookie jar
import fs from 'node:fs';
const c = JSON.parse(fs.readFileSync('E:/mimo-2-api-chat-continuation/captures/cookies-rapid-grove.json', 'utf8'));
const curl = "curl 'https://aistudio.xiaomimimo.com/open-apis/bot/chat' -H 'cookie: xiaomichatbot_serviceToken=\"" + c.serviceToken + "\"; userId=" + c.userId + "; xiaomichatbot_ph=\"" + c.phToken + "\"'";
const add = await (await fetch(SPACE + '/admin/accounts', { method: 'POST', headers: H, body: JSON.stringify({ curl, label: 'rapid-grove' }) })).json();
console.log('RE-ADD rapid-grove:', JSON.stringify(add));
if (add.id) {
  const test = await (await fetch(SPACE + '/admin/accounts/' + add.id + '/test', { method: 'POST', headers: H, body: '{}' })).json();
  console.log('ACCOUNT TEST:', JSON.stringify(test).slice(0, 200));
}

// One live chat through the Space to prove end-to-end
const keys = await (await fetch(SPACE + '/admin/keys', { headers: H })).json();
const key = (Array.isArray(keys) && keys.length) ? keys[0].key : null;
if (key) {
  const r = await fetch(SPACE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'authorization': 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'mimo-v2.6-pro', messages: [{ role: 'user', content: 'Reply with exactly: ok' }], stream: false })
  });
  const j = await r.json();
  const content = j.choices?.[0]?.message?.content || '';
  console.log('LIVE CHAT:', r.status, 'content=' + JSON.stringify(content.replace(/\u200C[\u200B\u2060]+\u200C/g, '').slice(0, 40)));
}
