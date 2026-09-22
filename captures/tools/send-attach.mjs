// Send a chat message with the staged attachment; capture the /bot/chat multiMedias wire.
import { CDP, listTargets, hookNetwork } from './cdp.mjs';
import { readFileSync } from 'node:fs';

const MSG = process.argv[2] || 'What is in this file? Describe it.';
const TAG = process.argv[3] || 'send-attach';
const NETFILE = `E:/mimo-2-api-chat-continuation/captures/net/${TAG}.jsonl`;
const log = (s) => process.stderr.write(`[${TAG}] ` + s + '\n');

const targets = await listTargets();
const t = targets.find(x => x.type === 'page' && x.url.includes('xiaomimimo'))
  || targets.find(x => x.type === 'page' && !x.url.startsWith('chrome'));
if (!t) throw new Error('no aistudio page target');
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
await hookNetwork(cdp, NETFILE);

try {
  await cdp.send('Page.bringToFront');
  await cdp.setViewport(1300, 720);

  // focus composer textarea and type the message
  const taSel = 'textarea';
  const has = await cdp.eval(`!!document.querySelector('textarea')`);
  if (!has) { console.log(JSON.stringify({ status: 'no_textarea' })); process.exit(0); }
  await cdp.typeChars(taSel, MSG, { delayMs: 15 });
  await cdp.wait(400);

  // click the send button (icon button near composer, or Enter key)
  const sendBtn = await cdp.eval(`(function(){const btns=[...document.querySelectorAll('button')];const b=btns.find(b=>{/send|submit|paper plane|arrow/i.test((b.getAttribute('aria-label')||'')+(b.title||'')+' '+(b.className||'')+' '+b.innerHTML.slice(0,200))});return b?{found:true,aria:b.getAttribute('aria-label'),title:b.title,disabled:b.disabled}:{found:false}})()`);
  log('send button: ' + JSON.stringify(sendBtn));

  let sent = false;
  if (sendBtn && sendBtn.found && !sendBtn.disabled) {
    try {
      await cdp.eval(`(function(){const btns=[...document.querySelectorAll('button')];const b=btns.find(b=>{/send|submit|paper plane|arrow/i.test((b.getAttribute('aria-label')||'')+(b.title||'')+' '+(b.className||'')+' '+b.innerHTML.slice(0,200))});if(b){b.click();return true}return false})()`);
      sent = true;
    } catch (e) { log('send click failed: ' + e.message); }
  }
  if (!sent) {
    log('falling back to Enter key');
    await cdp.enterKey();
  }
  log('message sent, waiting for SSE...');

  // wait for the chat request + stream to finish
  for (let i = 0; i < 45; i++) {
    await cdp.wait(2000);
    try {
      const lines = readFileSync(NETFILE, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const chatReq = lines.find(e => e.e === 'req' && e.url.includes('/bot/chat'));
      if (chatReq) {
        const sseCount = lines.filter(e => e.e === 'sse' && e.id === chatReq.id).length;
        const finish = lines.filter(e => e.e === 'sse' && e.id === chatReq.id && /finish/.test(e.ev));
        if (finish.length || sseCount > 5) { log('chat stream done (sse blocks: ' + sseCount + ')'); break; }
      }
    } catch (e) { /* file may not exist yet */ }
  }
  await cdp.screenshot(`E:/mimo-2-api-chat-continuation/captures/shots/${TAG}-reply.png`).catch(() => {});

  // extract the bot/chat request + response from the net log
  const lines = readFileSync(NETFILE, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const chatReq = lines.find(e => e.e === 'req' && e.url.includes('/bot/chat'));
  if (!chatReq) { console.log(JSON.stringify({ status: 'no_chat_request', msg: MSG })); process.exit(0); }
  const ss = lines.filter(e => e.e === 'sse' && e.id === chatReq.id);
  const resp = lines.find(e => e.e === 'res' && e.id === chatReq.id);
  // reconstruct the assistant text from SSE message events
  let text = '', thinking = '';
  for (const s of ss) {
    try { const d = JSON.parse(s.d); if (d.type === 'text') text += d.content || ''; if (d.type === 'thinking') thinking += d.content || ''; } catch {}
  }
  text = text.replace(/\0/g, '');
  console.log(JSON.stringify({
    status: 'ok',
    chatBody: JSON.parse(chatReq.postData),
    httpStatus: resp ? resp.status : null,
    reply: text.slice(0, 600),
    replyLen: text.length
  }, null, 1));
} finally { await cdp.close(); }
