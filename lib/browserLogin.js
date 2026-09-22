// Screenshot-based browser login (dpsk2api v3 style) — NO VNC (forbidden on HF).
// Drives a headless chromium via CDP; the admin page polls JPEG frames and
// relays clicks/keys through /admin/browser/* endpoints. Works with ANY login
// variant Xiaomi shows (email code, Google sign-in, QR) because the admin sees
// and drives the real page through the screenshot pane.
import { spawn } from 'child_process';
import path from 'path';
import { CDP, listTargets } from '../captures/tools/cdp.mjs';

var CDP_PORT = 9333; // must match the hub hardcoded in captures/tools/cdp.mjs
var VW = 1300, VH = 900;
var st = { cdp: null, launching: false };

async function hubUp() {
  try {
    const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch (e) { return false; }
}

async function launchChromium() {
  var dataDir = path.join(process.env.DATA_DIR || process.cwd(), 'browser-profile');
  var flags = [
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + dataDir,
    '--headless=new', '--no-sandbox', '--no-zygote', '--disable-gpu',
    '--disable-dev-shm-usage', '--disable-extensions', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--window-size=' + VW + ',' + VH
  ];
  var candidates = [
    process.env.CHROME_PATH,
    'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  var launched = false;
  for (var bin of candidates) {
    try { var proc = spawn(bin, flags, { stdio: 'ignore', detached: true }); proc.unref(); launched = true; break; } catch (e) { /* next */ }
  }
  if (!launched) throw new Error('no chromium binary found (set CHROME_PATH)');
  for (var i = 0; i < 30; i++) {
    await new Promise(function (r) { setTimeout(r, 500); });
    if (await hubUp()) return;
  }
  throw new Error('chromium did not come up on port ' + CDP_PORT);
}

export async function ensureBrowser() {
  if (!(await hubUp())) {
    if (st.launching) throw new Error('chromium is launching, try again in a few seconds');
    st.launching = true;
    try { await launchChromium(); } finally { st.launching = false; }
  }
  if (!st.cdp || st.cdp.closed) {
    var targets = await listTargets();
    var t = targets.find(function (x) { return x.type === 'page' && !x.url.startsWith('chrome'); })
      || targets.find(function (x) { return x.type === 'page'; });
    if (!t) throw new Error('no page target in chromium');
    st.cdp = new CDP(t.webSocketDebuggerUrl);
    await st.cdp.connect();
    await st.cdp.send('Page.enable');
    await st.cdp.send('Runtime.enable');
    await st.cdp.send('Network.enable');
    await st.cdp.setViewport(VW, VH);
  }
  return st.cdp;
}

export async function navigate(url) {
  var cdp = await ensureBrowser();
  await cdp.send('Page.bringToFront');
  return cdp.navigate(url);
}

function detectState(url) {
  url = String(url || '');
  if (url.includes('verifyEmail')) return 'awaiting_code';
  if (url.includes('account.xiaomi.com')) return 'xiaomi_login';
  if (url.includes('xiaomimimo.com')) return 'aistudio';
  return 'other';
}

export async function shot() {
  var cdp = await ensureBrowser();
  var r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 75 });
  var url = await cdp.eval('location.href').catch(function () { return ''; });
  var title = await cdp.eval('document.title').catch(function () { return ''; });
  return { img: 'data:image/jpeg;base64,' + r.data, url: String(url), title: String(title), state: detectState(url) };
}

export async function clickAt(x, y) {
  var cdp = await ensureBrowser();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x, y: y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x, y: y, button: 'left', clickCount: 1 });
  return true;
}

export async function typeText(text) {
  var cdp = await ensureBrowser();
  var str = String(text);
  for (const ch of str) {
    var keyCode = ch.charCodeAt(0);
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'char', key: ch, text: ch, unmodifiedText: ch,
      windowsVirtualKeyCode: keyCode, modifiers: 0
    });
    await new Promise(function (r) { setTimeout(r, 12); });
  }
  return true;
}

export async function pressKey(key) {
  var cdp = await ensureBrowser();
  var codes = { Enter: 13, Tab: 9, Backspace: 8, Escape: 27 };
  var vk = codes[key] || (key && key.length === 1 ? key.charCodeAt(0) : 0);
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: key, code: key, windowsVirtualKeyCode: vk });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key, code: key, windowsVirtualKeyCode: vk });
  return true;
}

export async function extractCookies() {
  var cdp = await ensureBrowser();
  var all = await cdp.getCookies(['https://aistudio.xiaomimimo.com/']);
  var want = {};
  for (const c of all) {
    if (c.name === 'xiaomichatbot_serviceToken') want.serviceToken = c.value.replace(/^"|"$/g, '');
    else if (c.name === 'userId') want.userId = c.value;
    else if (c.name === 'xiaomichatbot_ph') want.phToken = c.value.replace(/^"|"$/g, '');
  }
  return { cookies: want, complete: !!(want.serviceToken && want.userId && want.phToken) };
}

// Convenience: auto-fill the Xiaomi email+password form with proven selectors.
// The admin still drives submit/code through the screenshot pane.
export async function autoFillLogin(email, password) {
  var cdp = await ensureBrowser();
  await navigate('https://account.xiaomi.com/fe/service/login/password');
  await new Promise(function (r) { setTimeout(r, 3000); });
  var cb = await cdp.eval('(function(){const cb=document.querySelector(\'input[type=checkbox]\');if(cb&&!cb.checked){(cb.closest(\'label\')||cb.parentElement||cb).click();}const c2=document.querySelector(\'input[type=checkbox]\');return c2?c2.checked:null})()');
  await cdp.eval('document.querySelector(\'input[name=account]\').focus()');
  await typeText(email);
  await new Promise(function (r) { setTimeout(r, 250); });
  await cdp.eval('document.querySelector(\'input[name=password]\').focus()');
  await typeText(password);
  return { checkbox: cb };
}
