// Find the file-extraction stat in the conversation DOM (the '98.xx% extracted' badge).
import { CDP, listTargets } from './cdp.mjs';

const targets = await listTargets();
const t = targets.find(x => x.type === 'page' && x.url.includes('xiaomimimo')) || targets.find(x => x.type === 'page');
if (!t) { console.log('no page'); process.exit(0); }
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Runtime.enable');
try {
  const dump = await cdp.eval(`(function(){
    const out = {};
    // any element mentioning % or extract
    out.pct = [...document.querySelectorAll('span,div,p,td,li')]
      .filter(e => e.children.length === 0 && /%|extract|解析|提取|token/i.test(e.textContent || ''))
      .map(e => (e.textContent || '').replace(/\s+/g, ' ').slice(0, 120)).filter(Boolean).slice(0, 15);
    // file chip cards (contain filename)
    out.fileCards = [...document.querySelectorAll('[data-state]')]
      .map(x => (x.innerText || '').replace(/\s+/g, ' | ').slice(0, 200)).filter(Boolean).slice(0, 8);
    // tooltip-ish containers
    out.tooltips = [...document.querySelectorAll('[class*=tooltip],[class*=Tooltip],[role=tooltip]')]
      .map(x => (x.innerText || '').replace(/\s+/g, ' ').slice(0, 200)).filter(Boolean).slice(0, 5);
    return out;
  })()`);
  console.log(JSON.stringify(dump, null, 1).slice(0, 3500));
} finally { await cdp.close(); }
