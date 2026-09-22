// Upload MULTIPLE files at once, wait for chips, send query, capture wire + reply.
import { CDP, listTargets, hookNetwork } from './cdp.mjs';
import { readFileSync } from 'node:fs';

const MSG = process.argv[2];
const TAG = process.argv[3];
const FILES = process.argv.slice(4);
if (!MSG || !TAG || !FILES.length) { console.error('usage: node multi-upload-send.mjs <msg> <tag> <file1> [file2] ...'); process.exit(1); }
const NETFILE = `E:/mimo-2-api-chat-continuation/captures/net/${TAG}.jsonl`;
const log = (s) => process.stderr.write(`[${TAG}] ` + s + '\n');

const targets = await listTargets();
const t = targets.find(x => x.type === 'page' && x.url.includes('xiaomimimo')) || targets.find(x => x.type === 'page' && !x.url.startsWith('chrome'));
if (!t) throw new Error('no page target');
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('DOM.enable');
await hookNetwork(cdp, NETFILE);

const readNet = () => {
  try { return readFileSync(NETFILE, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
};

try {
  await cdp.send('Page.bringToFront');
  await cdp.setViewport(1300, 720);

  // clear any old chips (buttons only, safe click)
  const removed = await cdp.eval(`(function(){
    let n = 0;
    for (const chip of [...document.querySelectorAll('[data-state]')]) {
      const close = [...chip.querySelectorAll('button')].find(b => /remove|close|delete|cancel/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.className || '')));
      if (close && typeof close.click === 'function') { chip.dispatchEvent(new MouseEvent('mouseover', {bubbles: true})); close.click(); n++; }
    }
    return n;
  })()`);
  if (removed) { log('old chips removed: ' + removed); await cdp.wait(1200); }

  // set ALL files on the input at once
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  if (!q.nodeId) { console.log(JSON.stringify({ status: 'no_file_input' })); process.exit(0); }
  await cdp.send('DOM.setFileInputFiles', { files: FILES, nodeId: q.nodeId });
  log('files set: ' + FILES.length);

  // wait until chip count matches file count (or 40s)
  for (let i = 0; i < 20; i++) {
    await cdp.wait(2000);
    const chips = await cdp.eval(`[...document.querySelectorAll('[data-state]')].map(x => (x.innerText||'').replace(/\s+/g,' ').slice(0,90)).filter(Boolean)`);
    log('chips(' + chips.length + '): ' + JSON.stringify(chips));
    if (chips.length >= FILES.length) break;
  }

  // check parse stats for each
  const stats = await cdp.eval(`(function(){
    return [...document.querySelectorAll('span,div,p')].filter(e => e.children.length === 0 && /File Content Too Long|extract|%|token/i.test(e.textContent || '')).map(e => (e.textContent || '').replace(/\s+/g, ' ').slice(0, 140)).filter(Boolean).slice(0, 10);
  })()`);
  log('stats: ' + JSON.stringify(stats));

  // clear composer + type + send
  await cdp.clickEvents('textarea');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdp.wait(200);
  await cdp.typeChars('textarea', MSG, { delayMs: 14 });
  await cdp.enterKey();
  log('sent: ' + MSG);

  // wait for chat + finish (up to 160s)
  let chatBody = null, done = false;
  for (let i = 0; i < 80; i++) {
    await cdp.wait(2000);
    const lines = readNet();
    const chatReq = lines.find(e => e.e === 'req' && e.url.includes('/bot/chat'));
    if (chatReq) {
      if (!chatBody) { chatBody = chatReq.postData; log('chat request captured'); }
      const finish = lines.filter(e => e.e === 'sse' && e.id === chatReq.id && /finish/i.test(e.ev || ''));
      if (finish.length) { done = true; log('finish event seen'); break; }
    }
  }
  await cdp.screenshot(`E:/mimo-2-api-chat-continuation/captures/shots/${TAG}-reply.png`).catch(() => {});

  // final stats (post-send) + reply text
  const stats2 = await cdp.eval(`(function(){
    return [...document.querySelectorAll('span,div,p')].filter(e => e.children.length === 0 && /File Content Too Long|only proce|extract/i.test(e.textContent || '')).map(e => (e.textContent || '').replace(/\s+/g, ' ').slice(0, 140)).filter(Boolean).slice(0, 10);
  })()`);
  const lastTurns = await cdp.eval(`[...document.querySelectorAll('[class*=message],[class*=bubble],[class*=markdown]')].map(m => (m.innerText||'').replace(/\s+/g,' ').slice(0,300)).filter(Boolean).slice(-3)`);

  let reply = '';
  if (chatBody) {
    const lines = readNet();
    const chatReq = lines.find(e => e.e === 'req' && e.url.includes('/bot/chat'));
    for (const s of lines.filter(e => e.e === 'sse' && e.id === chatReq.id)) {
      try { const d = JSON.parse(s.d); if (d.type === 'text') reply += d.content || ''; } catch {}
    }
    reply = reply.replace(/\0/g, '');
  }
  console.log(JSON.stringify({
    status: chatBody ? (done ? 'ok' : 'timeout_no_finish') : 'no_chat_request',
    chatBody: chatBody ? JSON.parse(chatBody) : null,
    fileStats: stats2,
    reply: reply.slice(0, 700),
    uiLastTurns: lastTurns
  }, null, 1));
} finally { await cdp.close(); }
