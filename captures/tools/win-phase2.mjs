// Phase 2: enter verification code, complete login, sign in on aistudio, extract cookies.
import { CDP, listTargets } from './cdp.mjs';
import { writeFileSync } from 'node:fs';

const CODE = process.argv[2];
if (!CODE || !/^\d{4,8}$/.test(CODE)) { console.error('usage: node win-phase2.mjs <NNNNNN>'); process.exit(1); }
const SHOT = (n) => 'E:/mimo-2-api-chat-continuation/captures/shots/' + n + '.png';
const COOKIES_OUT = 'E:/mimo-2-api-chat-continuation/captures/cookies-rapid-grove.json';
const ALL_COOKIES_OUT = 'E:/mimo-2-api-chat-continuation/captures/all-cookies-rapid-grove.json';
const log = (s) => process.stderr.write('[p2] ' + s + '\n');

const targets = await listTargets();
const t = targets.find(x => x.type === 'page' && x.url.includes('account.xiaomi.com'))
  || targets.find(x => x.type === 'page' && x.url.includes('xiaomi'))
  || targets.find(x => x.type === 'page' && !x.url.startsWith('chrome'));
if (!t) throw new Error('no page target');
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');

async function extractWant() {
  const all = await cdp.getCookies(['https://aistudio.xiaomimimo.com/']);
  const want = {};
  for (const c of all) {
    if (c.name === 'xiaomichatbot_serviceToken') want.serviceToken = c.value.replace(/^"|"$/g, '');
    else if (c.name === 'userId') want.userId = c.value;
    else if (c.name === 'xiaomichatbot_ph') want.phToken = c.value.replace(/^"|"$/g, '');
  }
  return { want, all };
}

try {
  await cdp.send('Page.bringToFront');
  await cdp.setViewport(1300, 720);
  const url0 = await cdp.eval('location.href');
  log('at: ' + url0.slice(0, 80));
  await cdp.screenshot(SHOT('08-before-code')).catch(() => {});

  // Enter the code
  await cdp.typeChars('input[name="ticket"]', CODE, { delayMs: 45 });
  await cdp.wait(400);
  const ticketLen = await cdp.eval("document.querySelector('input[name=ticket]').value.length");
  log('ticket len: ' + ticketLen + '/' + CODE.length);
  if (ticketLen !== CODE.length) {
    await cdp.typeInto('input[name="ticket"]', CODE);
    await cdp.wait(400);
  }
  await cdp.screenshot(SHOT('09-code-filled')).catch(() => {});

  // Submit the code — primary button on the verify page
  const clicked = await cdp.eval("(function(){const b=[...document.querySelectorAll('button')].find(b=>/^Submit$/i.test((b.innerText||'').trim())&&!b.disabled);if(b){b.click();return 'clicked'}return 'not-found'})()");
  log('submit: ' + clicked);
  await cdp.wait(2000);

  let verified = false;
  for (let i = 1; i <= 20; i++) {
    const u = await cdp.eval('location.href').catch(() => null);
    if (!u) { await cdp.wait(2000); continue; }
    log('url: ' + u.slice(0, 90));
    if (u.includes('/fe/service/account') || u.includes('xiaomimimo.com')) { verified = true; break; }
    if (!u.includes('verifyEmail')) { verified = true; break; }
    await cdp.wait(2000);
  }
  await cdp.screenshot(SHOT('10-after-code')).catch(() => {});
  log('verified: ' + verified);

  // Navigate to aistudio chat page
  await cdp.navigate('https://aistudio.xiaomimimo.com/#/c');
  await cdp.wait(7000);
  await cdp.screenshot(SHOT('11-aistudio-landed')).catch(() => {});

  // Dismiss cookie banner if present
  await cdp.eval("(function(){const b=[...document.querySelectorAll('button,a')].find(x=>/Accept All/i.test(x.innerText));if(b){b.click();return true}return false})()");
  await cdp.wait(800);

  // Click Sign in (uses passport cookies → SSO handoff sets .xiaomimimo.com cookies)
  const signin = await cdp.eval("(function(){const b=[...document.querySelectorAll('button,a')].find(x=>/^Sign in/i.test((x.innerText||'').trim())&&!x.disabled);if(b){b.click();return 'clicked'}return 'not-found'})()");
  log('sign-in: ' + signin);
  await cdp.wait(7000);
  await cdp.screenshot(SHOT('12-after-signin')).catch(() => {});

  let { want, all } = await extractWant();
  if (!want.serviceToken || !want.userId || !want.phToken) {
    log('cookies incomplete — retrying in 12s');
    await cdp.wait(12000);
    ({ want, all } = await extractWant());
    await cdp.screenshot(SHOT('13-retry-cookies')).catch(() => {});
  }
  writeFileSync(ALL_COOKIES_OUT, JSON.stringify(all, null, 2));

  if (!want.serviceToken || !want.userId || !want.phToken) {
    const u = await cdp.eval('location.href');
    const txt = await cdp.eval('document.body.innerText.slice(0,400)');
    console.log(JSON.stringify({ status: 'cookies_missing', got: Object.keys(want), url: u, pageText: txt }));
    process.exit(0);
  }
  writeFileSync(COOKIES_OUT, JSON.stringify(want, null, 2));
  log('cookies saved → ' + COOKIES_OUT);
  console.log(JSON.stringify({ status: 'ok', userId: want.userId, serviceTokenChars: want.serviceToken.length, phToken: want.phToken }));
} finally { await cdp.close(); }
