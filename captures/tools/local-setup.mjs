// One-shot local setup: import account from saved cookies + create an API key.
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:7860';
const JWT = (await (await fetch(BASE + '/admin/login', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'admin' })
})).json()).token;
console.log('admin token ok');

const c = JSON.parse(fs.readFileSync('E:/mimo-2-api-chat-continuation/captures/cookies-rapid-grove.json', 'utf8'));
const curl = `curl 'https://aistudio.xiaomimimo.com/open-apis/bot/chat?xiaomichatbot_ph=${encodeURIComponent(c.phToken)}' \\
  -H 'cookie: xiaomichatbot_serviceToken="${c.serviceToken}"; userId=${c.userId}; xiaomichatbot_ph="${c.phToken}"'`;

const acc = await (await fetch(BASE + '/admin/accounts', {
  method: 'POST',
  headers: { 'authorization': 'Bearer ' + JWT, 'content-type': 'application/json' },
  body: JSON.stringify({ curl, label: 'rapid-grove' })
})).json();
console.log('account:', JSON.stringify(acc));

// create an API key (name + key); check endpoint shape defensively
const keyResp = await (await fetch(BASE + '/admin/keys', {
  method: 'POST',
  headers: { 'authorization': 'Bearer ' + JWT, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'e2e-test' })
})).json();
console.log('key:', JSON.stringify(keyResp));
