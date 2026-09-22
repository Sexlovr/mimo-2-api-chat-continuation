// Phase 1 retry: viewport fix + checkbox + creds + submit + code-send.
import { CDP, listTargets } from './cdp.mjs';

const EMAIL = process.env.MIMO_EMAIL;
const PASSWORD = process.env.MIMO_PASSWORD;
const SHOT = (n) => 'E:/mimo-2-api-chat-continuation/captures/shots/' + n + '.png';
const log = (s) => process.stderr.write('[p1] ' + s + '\n');

const targets = await listTargets();
const t = targets.find(x => x.type === 'page' && x.url.includes('xiaomi'))
  || targets.find(x => x.type === 'page' && !x.url.startsWith('chrome'))
  || targets.find(x => x.type === 'page');
if (!t) throw new Error('no page target');
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
try {
  await cdp.send('Page.bringToFront');
  await cdp.setViewport(1300, 720);
  await cdp.navigate('https://account.xiaomi.com/fe/service/login/password');
  for (let i = 0; i < 30; i++) {
    await cdp.wait(500);
    const has = await cdp.eval("!!document.querySelector('input[type=checkbox]') && !!document.querySelector('input[name=account]')");
    if (has) break;
  }
  log('form rendered');

  // tick the agreement checkbox
  const cb = await cdp.eval("(function(){const cb=document.querySelector('input[type=checkbox]');if(cb&&!cb.checked){(cb.closest('label')||cb.parentElement||cb).click();}return document.querySelector('input[type=checkbox]').checked})()");
  log('checkbox: ' + cb);
  await cdp.wait(400);

  // type credentials: real keys first, JS-setter fallback per field
  await cdp.typeChars('input[name="account"]', EMAIL, { delayMs: 25 });
  await cdp.wait(250);
  let acctLen = await cdp.eval("document.querySelector('input[name=account]').value.length");
  if (acctLen !== EMAIL.length) {
    log('account field empty after key-typing (' + acctLen + ') — JS-setter fallback');
    await cdp.typeInto('input[name="account"]', EMAIL);
    await cdp.wait(250);
    acctLen = await cdp.eval("document.querySelector('input[name=account]').value.length");
  }
  log('account len: ' + acctLen + '/' + EMAIL.length);

  await cdp.typeChars('input[name="password"]', PASSWORD, { delayMs: 20 });
  await cdp.wait(250);
  let passLen = await cdp.eval("document.querySelector('input[name=password]').value.length");
  if (passLen !== PASSWORD.length) {
    log('password field empty after key-typing (' + passLen + ') — JS-setter fallback');
    await cdp.typeInto('input[name="password"]', PASSWORD);
    await cdp.wait(250);
    passLen = await cdp.eval("document.querySelector('input[name=password]').value.length");
  }
  log('password len: ' + passLen + '/' + PASSWORD.length);

  const st = await cdp.eval("(function(){return {acct: document.querySelector('input[name=account]').value, passLen: document.querySelector('input[name=password]').value.length, cb: document.querySelector('input[type=checkbox]').checked, submitDisabled: document.querySelector('button.mi-button[type=submit]').disabled}})()");
  log('state: ' + JSON.stringify(st));
  await cdp.screenshot(SHOT('05-creds-ready')).catch(() => {});

  if (st.submitDisabled || st.acct !== EMAIL || st.passLen !== PASSWORD.length) {
    console.log(JSON.stringify({ status: 'form_not_ready', state: st }));
    process.exit(0);
  }

  await cdp.clickEvents('button.mi-button[type="submit"]');
  log('submitted');

  for (let i = 1; i <= 20; i++) {
    await cdp.wait(2000);
    let url; try { url = await cdp.eval('location.href'); } catch (e) { continue; }
    log('url: ' + url);
    if (url.includes('/identity/verifyEmail')) {
      await cdp.screenshot(SHOT('06-verify-page')).catch(() => {});
      const sent = await cdp.eval("(function(){const b=[...document.querySelectorAll('button')].find(b=>/^Send$/i.test((b.innerText||'').trim()));if(b){b.click();return true}return 'no-send-button'})()");
      log('Send clicked: ' + sent);
      await cdp.wait(2500);
      await cdp.screenshot(SHOT('07-code-sent')).catch(() => {});
      const bodyTxt = await cdp.eval('document.body.innerText.slice(0,600)');
      console.log(JSON.stringify({ status: 'awaiting_code', url, sendResult: sent, pageText: bodyTxt }));
      process.exit(0);
    }
    if (url.includes('/fe/service/account')) {
      console.log(JSON.stringify({ status: 'logged_in_no_verify', url }));
      process.exit(0);
    }
    if (!url.includes('/fe/service/login/password')) {
      await cdp.screenshot(SHOT('06-redirect')).catch(() => {});
      console.log(JSON.stringify({ status: 'redirected', url }));
      process.exit(0);
    }
  }
  const errTxt = await cdp.eval("(function(){const d=[...document.querySelectorAll('[class*=modal],[class*=dialog],[role=dialog],[class*=error],[class*=toast]')].map(x=>(x.innerText||'').trim()).filter(t=>t&&t.length>3);return d.join(' | ').slice(0,400)})()");
  await cdp.screenshot(SHOT('06-stuck')).catch(() => {});
  const bodyTxt = await cdp.eval('document.body.innerText.slice(0,600)');
  console.log(JSON.stringify({ status: 'stuck', dialogs: errTxt, pageText: bodyTxt }));
} finally { await cdp.close(); }
