// Remove any flagged/old attachment chips, then upload a fresh file.
// Usage: node reupload.mjs <abs-file-path> [waitMs] [tag]
import { CDP, listTargets, hookNetwork } from './cdp.mjs';
import { readFileSync } from 'node:fs';

const FILE = process.argv[2];
const WAIT = parseInt(process.argv[3] || '9000', 10);
const TAG = process.argv[4] || 'reupload';
const NETFILE = `E:/mimo-2-api-chat-continuation/captures/net/${TAG}.jsonl`;
const log = (s) => process.stderr.write(`[${TAG}] ` + s + '\n');

const targets = await listTargets();
const t = targets.find(x => x.type === 'page' && x.url.includes('xiaomimimo'))
  || targets.find(x => x.type === 'page' && !x.url.startsWith('chrome'));
if (!t) throw new Error('no aistudio page target');
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('DOM.enable');
await hookNetwork(cdp, NETFILE);

try {
  await cdp.send('Page.bringToFront');

  // 1) remove existing attachment chips: hover the chip row, click any X/close buttons
  const removed = await cdp.eval(`(function(){
    // chips live in the horizontal scroll row above the textarea
    const chips = [...document.querySelectorAll('[data-state]')];
    let n = 0;
    for (const chip of chips) {
      // look for a close/remove control inside/near the chip (buttons only — SVG nodes lack .click())
      const close = [...chip.querySelectorAll('button')].find(b =>
        /remove|close|delete|cancel/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.className || '')));
      if (close && typeof close.click === 'function') { chip.dispatchEvent(new MouseEvent('mouseover', {bubbles: true})); close.click(); n++; }
    }
    return n;
  })()`);
  log('chips removed: ' + removed);
  await cdp.wait(1200);

  // verify composer clean
  const still = await cdp.eval(`[...document.querySelectorAll('[data-state]')].filter(x => (x.innerText||'').trim()).length`);
  log('chips remaining: ' + still);

  // 2) set the new file
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  if (!q.nodeId) { console.log(JSON.stringify({ status: 'no_file_input' })); process.exit(0); }
  await cdp.send('DOM.setFileInputFiles', { files: [FILE], nodeId: q.nodeId });
  log('file set: ' + FILE);
  await cdp.wait(WAIT);

  // 3) inspect chip state + violations
  const post = await cdp.eval(`(function(){
    const chips = [...document.querySelectorAll('[data-state]')].map(x => (x.innerText || '').replace(/\s+/g, ' ').slice(0, 120)).filter(Boolean);
    const viol = [...document.querySelectorAll('span,div,p')].filter(e => e.children.length === 0 && /violation|sensitive|reject/i.test(e.textContent || '')).map(e => (e.textContent || '').slice(0, 80));
    const ta = document.querySelector('textarea');
    // send button: look for a button that is enabled now
    const btns = [...document.querySelectorAll('button')].filter(b => !b.disabled && b.closest('form, [class*=composer], [class*=input]')).map(b => ({aria: b.getAttribute('aria-label'), html: b.innerHTML.slice(0, 120)}));
    return { chips: chips.slice(0, 6), viol: viol.slice(0, 5), taVal: ta ? ta.value.slice(0, 80) : null, nearbyBtns: btns.slice(0, 6) };
  })()`);
  await cdp.screenshot(`E:/mimo-2-api-chat-continuation/captures/shots/${TAG}.png`).catch(() => {});

  // 4) parse upload traffic
  const lines = readFileSync(NETFILE, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const reqs = lines.filter(e => e.e === 'req' && /genUploadInfo|fds\.api\.xiaomi\.com/.test(e.url));
  const out = [];
  for (const r of reqs) {
    const resp = lines.find(e => e.e === 'res' && e.id === r.id);
    const body = lines.find(e => e.e === 'body' && e.id === r.id);
    out.push({ url: r.url.slice(0, 140), method: r.method, status: resp ? resp.status : null, postData: r.postData ? String(r.postData).slice(0, 300) : null, respBody: body ? String(body.body).slice(0, 500) : null });
  }
  console.log(JSON.stringify({ status: 'done', ui: post, traffic: out }, null, 1));
} finally { await cdp.close(); }
