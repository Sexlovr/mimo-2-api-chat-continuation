// Screenshot-based browser login (dpsk2api v3 pattern — NO VNC).
// One entry point: launchLoginBrowser(db, label, url).
//   • FRESH throwaway profile every launch (nothing persists between logins —
//     no previous account, incognito-equivalent via mkdtemp user-data-dir)
//   • Starts on https://aistudio.xiaomimimo.com/#/c — the admin clicks Sign
//     in, completes the Xiaomi login (email + code), lands back on MiMo Studio
//   • Watcher polls cookies every 3s; the moment all three .xiaomimimo.com
//     cookies exist it AUTO-SAVES the account (upsert by user_id)
//   • Auto-assists: dismisses the cookie banner + clicks "Sign in" on the
//     aistudio page once, and if cookies are still missing ~8s after landing
//     on an authenticated aistudio page it sends a tiny hello message to
//     force the SSO handoff
//   • The browser is ALWAYS killed — auto-save, 10-min hard cap, 3-min idle,
//     Kill button, or the next Launch. Browser.close + PID tree-kill +
//     profile dir wipe. No orphan chromium eating Space RAM.
import { spawn, exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CDP } from '../captures/tools/cdp.mjs';

var LOGIN_PORT = parseInt(process.env.LOGIN_CDP_PORT) || 9340;
var HUB = 'http://127.0.0.1:' + LOGIN_PORT;
var VW = 1300, VH = 900;
var HARD_CAP_MS = 10 * 60 * 1000;   // dpsk2api-style hard cap
var IDLE_KILL_MS = 3 * 60 * 1000;   // no interaction polls for 3 min → kill
var NUDGE_AFTER_MS = 8 * 1000;      // cookies missing this long after auth → send hello msg
var AISTUDIO = 'https://aistudio.xiaomimimo.com/#/c';

var st = {
  cdp: null, proc: null, pid: null, profileDir: null,
  status: 'idle', message: 'No browser running. Click Launch.',
  userId: null, label: null,
  launchedAt: 0, lastActivity: 0, watcher: null,
  signinTried: false, bannerTried: false, nudged: false
};

function log(s) { process.stderr.write('[browserLogin] ' + s + '\n'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function hubUp() {
  try { const r = await fetch(HUB + '/json/version', { signal: AbortSignal.timeout(1000) }); return r.ok; }
  catch (e) { return false; }
}

async function findPage() {
  const r = await fetch(HUB + '/json');
  const ts = await r.json();
  return ts.find(function (t) { return t.type === 'page' && !String(t.url).startsWith('chrome'); })
    || ts.find(function (t) { return t.type === 'page'; });
}

function detectState(url) {
  url = String(url || '');
  if (url.includes('verifyEmail')) return 'email_code';
  if (url.includes('account.xiaomi.com')) return 'xiaomi_login';
  if (url.includes('xiaomimimo.com')) return 'aistudio';
  return 'other';
}

// ── Kill: always thorough, never throws ──
export async function killBrowser() {
  if (st.watcher) { clearInterval(st.watcher); st.watcher = null; }
  try { if (st.cdp && !st.cdp.closed) await st.cdp.send('Browser.close'); } catch (e) {}
  try { if (st.cdp) await st.cdp.close(); } catch (e) {}
  st.cdp = null;
  var pid = st.pid;
  if (pid) {
    await sleep(800);
    try {
      process.kill(pid, 0); // still alive → force tree kill
      if (process.platform === 'win32') {
        exec('taskkill /PID ' + pid + ' /T /F', function () {});
      } else {
        try { process.kill(-pid, 'SIGKILL'); } catch (e) { try { process.kill(pid, 'SIGKILL'); } catch (e2) {} }
      }
    } catch (e) { /* already dead */ }
  }
  st.proc = null; st.pid = null;
  if (st.profileDir) {
    try { fs.rmSync(st.profileDir, { recursive: true, force: true }); } catch (e) {}
    st.profileDir = null;
  }
  if (st.status === 'running' || st.status === 'starting') {
    st.status = 'idle';
    st.message = 'No browser running. Click Launch.';
  }
  log('browser killed, state clean');
}

function saveAccount(db, want) {
  var existing = db.prepare('SELECT id FROM accounts WHERE user_id = ?').get(want.userId);
  if (existing) {
    db.prepare('UPDATE accounts SET service_token = ?, ph_token = ?, active = 1 WHERE id = ?')
      .run(want.serviceToken, want.phToken, existing.id);
    return 'updated';
  }
  var label = st.label || ('browser:' + want.userId);
  db.prepare('INSERT INTO accounts (label, service_token, user_id, ph_token) VALUES (?, ?, ?, ?)')
    .run(label, want.serviceToken, want.userId, want.phToken);
  return 'created';
}

// Auto-nudge: type a hello message into the aistudio composer and send it —
// some sessions land on the studio signed-in but the chat cookies only get
// minted after the first real interaction.
async function nudgeMessage() {
  try {
    var has = await st.cdp.eval("!!document.querySelector('textarea')");
    if (!has) return false;
    await st.cdp.clickEvents('textarea');
    for (const ch of 'hi') {
      await st.cdp.send('Input.dispatchKeyEvent', {
        type: 'char', key: ch, text: ch, unmodifiedText: ch,
        windowsVirtualKeyCode: ch.charCodeAt(0), modifiers: 0
      });
      await sleep(40);
    }
    await st.cdp.enterKey();
    log('sent hello nudge to force cookie mint');
    return true;
  } catch (e) { log('nudge failed: ' + e.message); return false; }
}

function startWatcher(db) {
  st.watcher = setInterval(async function () {
    if (st.status !== 'running') { if (st.watcher) clearInterval(st.watcher); return; }
    try {
      if (!st.cdp || st.cdp.closed) throw new Error('browser connection lost');
      if (Date.now() - st.launchedAt > HARD_CAP_MS) {
        st.status = 'error'; st.message = 'Timed out after 10 minutes.';
        await killBrowser(); return;
      }
      if (Date.now() - st.lastActivity > IDLE_KILL_MS) {
        st.status = 'error'; st.message = 'Idle timeout (3 min) — browser killed.';
        await killBrowser(); return;
      }

      var url = '';
      try { url = await st.cdp.eval('location.href'); } catch (e) {}

      // auto-assist on the aistudio page
      if (String(url).includes('xiaomimimo.com')) {
        if (!st.bannerTried) {
          st.bannerTried = true;
          try { await st.cdp.eval("(function(){const b=[...document.querySelectorAll('button,a')].find(x=>/Accept All/i.test(x.innerText||''));if(b){b.click();return true}return false})()"); } catch (e) {}
        }
        if (!st.signinTried) {
          try {
            var r = await st.cdp.eval("(function(){const b=[...document.querySelectorAll('button,a')].find(x=>/^Sign in/i.test((x.innerText||'').trim())&&!x.disabled);if(b){b.click();return true}return false})()");
            if (r) { st.signinTried = true; log('auto-clicked Sign in on aistudio'); }
          } catch (e) {}
        }
        // cookies missing after landing → send hello message to force mint
        if (!st.nudged && Date.now() - st.launchedAt > NUDGE_AFTER_MS && st.signinTried) {
          st.nudged = true;
          await nudgeMessage();
        }
      }

      // cookie poll — the moment all three exist, save and discard
      var all = await st.cdp.getCookies(['https://aistudio.xiaomimimo.com/']);
      var want = {};
      for (const c of all) {
        if (c.name === 'xiaomichatbot_serviceToken') want.serviceToken = c.value.replace(/^"|"$/g, '');
        else if (c.name === 'userId') want.userId = c.value;
        else if (c.name === 'xiaomichatbot_ph') want.phToken = c.value.replace(/^"|"$/g, '');
      }
      if (want.serviceToken && want.userId && want.phToken) {
        var action = saveAccount(db, want);
        st.userId = want.userId;
        st.status = 'done';
        st.message = 'Account ' + action + ' (userId ' + want.userId + ') — browser closed.';
        log('account auto-saved (' + action + '): ' + want.userId);
        await killBrowser();
      }
    } catch (e) {
      if (st.status === 'running') {
        st.status = 'error';
        st.message = 'Watcher: ' + e.message;
      }
      await killBrowser();
    }
  }, 3000);
}

// Resolve a chromium binary that ACTUALLY exists. spawn() reports ENOENT
// asynchronously on Windows — an unhandled 'error' event would crash the whole
// server, so we never spawn a path we haven't verified on disk.
function resolveChromium() {
  var cands = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'
  ].filter(Boolean);
  for (var c of cands) {
    try { if (fs.existsSync(c)) return c; } catch (e) {}
  }
  var names = process.platform === 'win32'
    ? ['chrome.exe', 'msedge.exe', 'chromium.exe']
    : ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (var n of names) {
    try {
      var out = require('child_process').execSync(
        (process.platform === 'win32' ? 'where ' : 'which ') + n,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      var first = String(out).split('\n').map(function (s) { return s.trim(); }).filter(Boolean)[0];
      if (first && fs.existsSync(first)) return first;
    } catch (e) {}
  }
  return null;
}

// ── Launch: fresh profile, guaranteed-clean start ──
export async function launchLoginBrowser(db, label, startUrl) {
  await killBrowser();
  st.status = 'starting'; st.message = 'Booting fresh chromium...';
  st.userId = null; st.label = label || null;
  st.signinTried = false; st.bannerTried = false; st.nudged = false;
  st.launchedAt = Date.now(); st.lastActivity = Date.now();
  st.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimo-login-'));

  var bin = resolveChromium();
  if (!bin) {
    st.status = 'error'; st.message = 'No chromium binary found (set CHROME_PATH).';
    try { fs.rmSync(st.profileDir, { recursive: true, force: true }); } catch (e) {}
    st.profileDir = null;
    throw new Error(st.message);
  }

  var flags = [
    '--remote-debugging-port=' + LOGIN_PORT,
    '--user-data-dir=' + st.profileDir,
    '--headless=new', '--no-sandbox', '--no-zygote', '--disable-gpu',
    '--disable-dev-shm-usage', '--disable-extensions', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--window-size=' + VW + ',' + VH
  ];
  st.proc = spawn(bin, flags, { stdio: 'ignore', detached: true });
  st.pid = st.proc.pid;
  st.proc.on('error', function (e) { log('chromium spawn error: ' + e.message); });
  st.proc.unref();

  for (var i = 0; i < 40; i++) { await sleep(500); if (await hubUp()) break; }
  if (!(await hubUp())) {
    st.status = 'error'; st.message = 'Chromium did not start on port ' + LOGIN_PORT + '.';
    await killBrowser();
    throw new Error(st.message);
  }

  var t = await findPage();
  st.cdp = new CDP(t.webSocketDebuggerUrl);
  await st.cdp.connect();
  await st.cdp.send('Page.enable');
  await st.cdp.send('Runtime.enable');
  await st.cdp.send('Network.enable');
  await st.cdp.setViewport(VW, VH);
  await st.cdp.send('Page.bringToFront').catch(function () {});
  await st.cdp.navigate(startUrl || AISTUDIO);
  st.status = 'running';
  st.message = 'Browser ready — click Sign in on the page and log in.';
  startWatcher(db);
  log('launched fresh browser pid=' + st.pid + ' port=' + LOGIN_PORT + ' profile=' + st.profileDir);
  return { status: st.status, message: st.message };
}

// ── Frame: one poll endpoint for shot + status ──
export async function getFrame() {
  var base = { status: st.status, message: st.message, userId: st.userId, img: null, url: '', state: st.status };
  if (st.status !== 'running' || !st.cdp || st.cdp.closed) return base;
  st.lastActivity = Date.now();
  try {
    var r = await st.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
    var url = await st.cdp.eval('location.href').catch(function () { return ''; });
    return { status: 'running', message: st.message, userId: null, img: 'data:image/jpeg;base64,' + r.data, url: String(url), state: detectState(url) };
  } catch (e) {
    base.message = 'frame error: ' + e.message;
    return base;
  }
}

export function getStatus() {
  return { status: st.status, message: st.message, userId: st.userId };
}

// ── Relays (all guarded, all touch activity) ──
function touch() { st.lastActivity = Date.now(); }
function requireRunning() {
  if (st.status !== 'running' || !st.cdp || st.cdp.closed) {
    throw new Error('No browser running — click Launch first');
  }
}

export async function clickAt(x, y) {
  requireRunning(); touch();
  await st.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x, y: y, button: 'left', clickCount: 1 });
  await st.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x, y: y, button: 'left', clickCount: 1 });
  return true;
}

export async function typeText(text) {
  requireRunning(); touch();
  var str = String(text);
  for (const ch of str) {
    await st.cdp.send('Input.dispatchKeyEvent', {
      type: 'char', key: ch, text: ch, unmodifiedText: ch,
      windowsVirtualKeyCode: ch.charCodeAt(0), modifiers: 0
    });
    await sleep(12);
  }
  return true;
}

export async function pressKey(key) {
  requireRunning(); touch();
  var codes = { Enter: 13, Tab: 9, Backspace: 8, Escape: 27 };
  var vk = codes[key] || (key && key.length === 1 ? key.charCodeAt(0) : 0);
  await st.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: key, code: key, windowsVirtualKeyCode: vk });
  await st.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key, code: key, windowsVirtualKeyCode: vk });
  return true;
}

export async function gotoUrl(url) {
  requireRunning(); touch();
  await st.cdp.navigate(url);
  return true;
}

// Auto-fill the Xiaomi email+password form. If the current page isn't the
// Xiaomi login form yet, navigate to it first (works both when the admin
// came via aistudio → Sign in, and standalone).
export async function autoFillLogin(email, password) {
  requireRunning(); touch();
  var onForm = false;
  try { onForm = !!await st.cdp.eval("document.querySelector('input[name=account]')"); } catch (e) {}
  if (!onForm) {
    await st.cdp.navigate('https://account.xiaomi.com/fe/service/login/password');
    await sleep(3000);
  }
  var cb = await st.cdp.eval("(function(){const cb=document.querySelector('input[type=checkbox]');if(cb&&!cb.checked){(cb.closest('label')||cb.parentElement||cb).click();}const c2=document.querySelector('input[type=checkbox]');return c2?c2.checked:null})()");
  await st.cdp.eval("document.querySelector('input[name=account]').focus()");
  await typeText(email);
  await sleep(250);
  await st.cdp.eval("document.querySelector('input[name=password]').focus()");
  await typeText(password);
  return { checkbox: cb };
}
