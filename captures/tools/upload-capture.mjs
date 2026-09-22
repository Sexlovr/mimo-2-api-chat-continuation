// Upload probe: set a file on the aistudio file input via CDP, capture the wire.
// Usage: node upload-capture.mjs <abs-file-path> [waitMs] [tag]
import { CDP, listTargets, hookNetwork } from './cdp.mjs';
import { readFileSync } from 'node:fs';

const FILE = process.argv[2];
const WAIT = parseInt(process.argv[3] || '9000', 10);
const TAG = process.argv[4] || 'upload';
if (!FILE) { console.error('usage: node upload-capture.mjs <abs-file-path> [waitMs] [tag]'); process.exit(1); }
const NETFILE = `E:/mimo-2-api-chat-continuation/captures/net/${TAG}.jsonl`;
const log = (s) => process.stderr.write(`[${TAG}] ` + s + '\n');

const targets = await listTargets();
const t = targets.find(x => x.type === 'page' && x.url.includes('xiaomimimo'))
  || targets.find(x => x.type === 'page' && !x.url.startsWith('chrome'));
if (!t) throw new Error('no aistudio page target');
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
await cdp.send('DOM.enable');
await hookNetwork(cdp, NETFILE.replace(/\//g, '/'));

try {
  await cdp.send('Page.bringToFront');
  // find the file input node
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  // locate any input[type=file] via JS first for diagnostics
  const info = await cdp.eval(`(function(){const i=document.querySelector('input[type=file]');return i?{accept:i.accept,multiple:i.multiple}:{none:true}})()`);
  log('file input: ' + JSON.stringify(info));
  const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  if (!q.nodeId) { console.log(JSON.stringify({ status: 'no_file_input' })); process.exit(0); }

  await cdp.send('DOM.setFileInputFiles', { files: [FILE], nodeId: q.nodeId });
  log('files set: ' + FILE);
  await cdp.wait(WAIT);

  // post-state: toasts, errors, composer attachments
  const toast = await cdp.eval(`(function(){const els=[...document.querySelectorAll('[class*=toast],[class*=Toast],[class*=message],[class*=notice],[role=alert]')].map(x=>(x.innerText||'').trim()).filter(Boolean);return els.slice(0,5)})()`);
  const composer = await cdp.eval(`(function(){const imgs=[...document.querySelectorAll('img')].map(i=>i.src).filter(s=>s&&(s.includes('blob:')||s.includes('open-apis')));const chips=[...document.querySelectorAll('[class*=file],[class*=attach],[class*=upload]')].map(x=>(x.innerText||'').trim().slice(0,80)).filter(Boolean);return {imgs, chips: chips.slice(0,10)}})()`);
  await cdp.screenshot(`E:/mimo-2-api-chat-continuation/captures/shots/${TAG}.png`).catch(() => {});

  // parse the net log for upload-ish traffic
  const lines = readFileSync(NETFILE, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const reqs = lines.filter(e => e.e === 'req' && /upload|file|oss|media|multi|attach|presign/i.test(e.url));
  const allPosts = lines.filter(e => e.e === 'req' && e.method === 'POST');
  const out = [];
  for (const r of (reqs.length ? reqs : allPosts)) {
    const resp = lines.find(e => e.e === 'res' && e.id === r.id);
    const body = lines.find(e => e.e === 'body' && e.id === r.id);
    out.push({
      url: r.url, method: r.method, type: r.type,
      postData: r.postData ? String(r.postData).slice(0, 500) : null,
      postLen: r.postData ? String(r.postData).length : 0,
      status: resp ? resp.status : null,
      respBody: body ? String(body.body).slice(0, 700) : null
    });
  }
  console.log(JSON.stringify({ status: 'done', toast, composer, uploads: out, allPostCount: allPosts.length }, null, 1));
} finally { await cdp.close(); }
