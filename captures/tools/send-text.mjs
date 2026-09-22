// Clear composer, type fresh message, send with staged attachment, capture /bot/chat wire.
import { CDP, listTargets, hookNetwork } from './cdp.mjs';
import { readFileSync } from 'node:fs';

const MSG = process.argv[2] || 'Summarize this file in one paragraph.';
const TAG = process.argv[3] || 'send-text';
const NETFILE = `E:/mimo-2-api-chat-continuation/captures/net/${TAG}.jsonl`;
const log = (s) => process.stderr.write(`[${TAG}] ` + s + '\n');

const targets = await listTargets();
const t = targets.find(x => x.type === 'page' && x.url.includes('xiaomimimo')) || targets.find(x => x.type === 'page' && !x.url.startsWith('chrome'));
if (!t) throw new Error('no page target');
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
await hookNetwork(cdp, NETFILE);

try {
  await cdp.send('Page.bringToFront');
  await cdp.setViewport(1300, 720);

  // chips present?
  const chips = await cdp.eval(`[...document.querySelectorAll('[data-state]')].map(x => (x.innerText||'').replace(/\s+/g,' ').slice(0,80)).filter(Boolean)`);
  log('chips: ' + JSON.stringify(chips));

  // clear textarea then type fresh message
  await cdp.clickEvents('textarea');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdp.wait(200);
  await cdp.typeChars('textarea', MSG, { delayMs: 14 });
  await cdp.wait(400);
  const taVal = await cdp.eval(`document.querySelector('textarea').value`);
  log('composer: ' + taVal);

  // send via Enter
  await cdp.enterKey();
  log('sent (Enter), waiting for chat SSE...');

  // wait for /bot/chat request + finish event
  let chatBody = null, done = false;
  for (let i = 0; i < 50; i++) {
    await cdp.wait(2000);
    try {
      const lines = readFileSync(NETFILE, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const chatReq = lines.find(e => e.e === 'req' && e.url.includes('/bot/chat'));
      if (chatReq) {
        if (!chatBody) { chatBody = chatReq.postData; log('chat request captured'); }
        const finish = lines.filter(e => e.e === 'sse' && e.id === chatReq.id && /finish/i.test(e.ev || ''));
        if (finish.length) { done = true; log('finish event seen'); break; }
      }
    } catch (e) { /* netlog not written yet */ }
  }
  await cdp.screenshot(`E:/mimo-2-api-chat-continuation/captures/shots/${TAG}-reply.png`).catch(() => {});

  if (!chatBody) { console.log(JSON.stringify({ status: 'no_chat_request' })); process.exit(0); }

  const lines = readFileSync(NETFILE, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const chatReq = lines.find(e => e.e === 'req' && e.url.includes('/bot/chat'));
  const ss = lines.filter(e => e.e === 'sse' && e.id === chatReq.id);
  const usage = ss.find(s => { try { return /prompt/i.test(JSON.parse(s.d).type || ''); } catch { return false; } });
  let text = '', usageData = null;
  for (const s of ss) {
    try {
      const d = JSON.parse(s.d);
      if (d.type === 'text') text += d.content || '';
      if (d.promptTokens) usageData = d;
    } catch {}
  }
  text = text.replace(/\0/g, '');
  console.log(JSON.stringify({
    status: done ? 'ok' : 'timeout_no_finish',
    chatBody: JSON.parse(chatBody),
    usage: usageData,
    reply: text.slice(0, 500),
    replyLen: text.length
  }, null, 1));
} finally { await cdp.close(); }
