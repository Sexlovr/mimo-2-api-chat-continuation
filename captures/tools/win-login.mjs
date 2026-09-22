// Windows CDP login flow for aistudio.xiaomimimo.com — account rapid-grove-4993.
// Chrome must already be running with --remote-debugging-port=9333 (fresh
// user-data-dir so it spawns its own process). Phases:
//   node win-login.mjs login          fill email+password on account.xiaomi.com, submit, click "Send" code
//   node win-login.mjs code <NNNNNN>  enter the emailed code, then Sign in on aistudio, save cookies
//   node win-login.mjs status         print URL + screenshot
//   node win-login.mjs cookies        extract .xiaomimimo.com cookies to captures/cookies-rapid-grove.json
import { CDP, listTargets } from './cdp.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const EMAIL = process.env.MIMO_EMAIL;
const PASSWORD = process.env.MIMO_PASSWORD;
const ROOT = 'E:/mimo-2-api-chat-continuation/captures';
const SHOTS = ROOT + '/shots';
const COOKIES_OUT = ROOT + '/cookies-rapid-grove.json';
const ALL_COOKIES_OUT = ROOT + '/all-cookies-rapid-grove.json';
mkdirSync(SHOTS, { recursive: true });

const log = (s) => process.stderr.write('[win-login] ' + s + '\n');

async function attach() {
  const targets = await listTargets();
  const t = targets.find((x) => x.type === 'page' && /xiaomi|xiaomimimo/.test(x.url))
    || targets.find((x) => x.type === 'page' && !x.url.startsWith('chrome'))
    || targets.find((x) => x.type === 'page');
  if (!t) throw new Error('no page target (is Chrome on 9333?)');
  log('attached: ' + t.url);
  const cdp = new CDP(t.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Page.enable').catch(() => {});
  await cdp.send('Runtime.enable').catch(() => {});
  return cdp;
}

async function shot(cdp, name) {
  const p = SHOTS + '/' + name + '.png';
  try { await cdp.screenshot(p); log('shot: ' + p); } catch (e) { log('shot failed: ' + e.message); }
  return p;
}

async function extractWant(cdp) {
  const all = await cdp.getCookies(['https://aistudio.xiaomimimo.com/']);
  const want = {};
  for (const c of all) {
    if (c.name === 'xiaomichatbot_serviceToken') want.serviceToken = c.value.replace(/^"|"$/g, '');
    else if (c.name === 'userId') want.userId = c.value;
    else if (c.name === 'xiaomichatbot_ph') want.phToken = c.value.replace(/^"|"$/g, '');
  }
  return { want, all };
}

async function finishAistudio(cdp) {
  // Navigate to aistudio chat, dismiss cookie banner, click Sign in.
  await cdp.setViewport(1300, 720);
  await cdp.navigate('https://aistudio.xiaomimimo.com/#/c');
  await cdp.wait(6000);
  await shot(cdp, '10-aistudio-landed');
  await cdp.eval(`(function(){const b=[...document.querySelectorAll('button,a')].find(x=>/Accept All/i.test(x.innerText));if(b){b.click();return true}return false})()`);
  await cdp.wait(800);
  const signin = await cdp.eval(`(function(){const b=[...document.querySelectorAll('button,a')].find(x=>/^Sign in/i.test((x.innerText||'').trim())&&!x.disabled);if(b){b.click();return 'clicked'}return 'not found'})()`);
  log('sign-in: ' + signin);
  await cdp.wait(6000);
  await shot(cdp, '11-after-signin');

  let { want, all } = await extractWant(cdp);
  if (!want.serviceToken || !want.userId || !want.phToken) {
    log('cookies incomplete; waiting 10s and retrying');
    await cdp.wait(10000);
    ({ want, all } = await extractWant(cdp));
    await shot(cdp, '12-retry-cookies');
  }
  writeFileSync(ALL_COOKIES_OUT, JSON.stringify(all, null, 2));
  if (!want.serviceToken || !want.userId || !want.phToken) {
    console.log(JSON.stringify({ status: 'cookies_missing', got: Object.keys(want), url: await cdp.eval('location.href') }));
    return;
  }
  writeFileSync(COOKIES_OUT, JSON.stringify(want, null, 2));
  log('cookies saved: ' + COOKIES_OUT + ' (userId=' + want.userId + ', serviceToken ' + want.serviceToken.length + ' chars)');
  console.log(JSON.stringify({ status: 'ok', userId: want.userId, cookiesFile: COOKIES_OUT }));
}

async function phaseLogin(cdp) {
  await cdp.setViewport(1300, 720);
  await cdp.navigate('https://account.xiaomi.com/fe/service/login/password');
  await cdp.wait(3500);
  await shot(cdp, '01-login-page');

  const cb = await cdp.eval(`(function(){const cb=document.querySelector('input[type=checkbox]');if(cb&&!cb.checked)(cb.closest('label')||cb).click();return cb?cb.checked:null})()`);
  log('agree checkbox: ' + cb);

  await cdp.typeChars('input[name="account"]', EMAIL, { delayMs: 35 });
  await cdp.typeChars('input[name="password"]', PASSWORD, { delayMs: 25 });
  await cdp.wait(300);
  await shot(cdp, '02-creds-filled');
  await cdp.clickEvents('button.mi-button[type="submit"]');
  log('submitted login form');

  for (let i = 1; i <= 15; i++) {
    await cdp.wait(2000);
    let url;
    try { url = await cdp.eval('location.href'); } catch (e) { continue; }
    log('url: ' + url);
    if (url.includes('/identity/verifyEmail')) {
      await shot(cdp, '03-verify-page');
      const sent = await cdp.eval(`(function(){const b=[...document.querySelectorAll('button')].find(b=>/^Send$/i.test((b.innerText||'').trim()));if(b){b.click();return true}return false})()`);
      log('Send clicked: ' + sent);
      await cdp.wait(1500);
      await shot(cdp, '04-code-sent');
      console.log(JSON.stringify({ status: 'awaiting_code', url }));
      return;
    }
    if (url.includes('/fe/service/account')) {
      log('already logged in — going straight to aistudio');
      await finishAistudio(cdp);
      return;
    }
    if (!url.includes('/fe/service/login/password')) {
      await shot(cdp, '03-redirect');
      console.log(JSON.stringify({ status: 'redirected', url }));
      return;
    }
  }
  await shot(cdp, '03-stuck-on-login');
  console.log(JSON.stringify({ status: 'stuck_on_login', hint: 'possible captcha/slider — see 03-stuck-on-login.png' }));
}

async function phaseCode(cdp, code) {
  const url = await cdp.eval('location.href');
  log('at: ' + url);
  if (!url.includes('/identity/verifyEmail')) {
    log('not on verify page; navigating');
    await cdp.navigate('https://account.xiaomi.com/fe/service/login/password');
    await cdp.wait(3000);
  }
  await shot(cdp, '05-before-code');
  await cdp.typeChars('input[name="ticket"]', code, { delayMs: 60 });
  await cdp.wait(400);
  await shot(cdp, '06-code-filled');
  await cdp.clickEvents('button.miui-btn-primary');
  log('submitted verification code');

  for (let i = 1; i <= 15; i++) {
    await cdp.wait(2000);
    let u;
    try { u = await cdp.eval('location.href'); } catch (e) { continue; }
    log('url: ' + u);
    if (u.includes('/fe/service/account') || u.includes('aistudio.xiaomimimo.com')) break;
  }
  await shot(cdp, '07-after-code');
  await finishAistudio(cdp);
}

const [, , phase, arg] = process.argv;
const cdp = await attach();
try {
  if (phase === 'login') await phaseLogin(cdp);
  else if (phase === 'code') await phaseCode(cdp, arg);
  else if (phase === 'status') {
    const url = await cdp.eval('location.href');
    const title = await cdp.eval('document.title');
    await shot(cdp, 'status');
    console.log(JSON.stringify({ status: 'info', url, title }));
  } else if (phase === 'cookies') {
    const { want } = await extractWant(cdp);
    console.log(JSON.stringify({ status: want.serviceToken ? 'ok' : 'missing', keys: Object.keys(want), userId: want.userId || null }));
  } else {
    console.error('usage: node win-login.mjs login | code <NNNNNN> | status | cookies');
    process.exit(1);
  }
} finally { try { await cdp.close(); } catch {} }
