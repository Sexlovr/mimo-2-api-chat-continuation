// Probe aistudio conversation state: chips, violations, last turns, composer.
import { CDP, listTargets } from './cdp.mjs';

const targets = await listTargets();
const pages = targets.filter(x => x.type === 'page' && x.url.includes('xiaomimimo'));
console.log('PAGES: ' + pages.map(p => p.id.slice(0, 8) + ' ' + p.url.slice(0, 50)).join(' | '));
const t = pages[0];
if (!t) { console.log('no aistudio page'); process.exit(0); }
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Runtime.enable');
try {
  const st = await cdp.eval(`(function(){
    const out = {};
    out.chips = [...document.querySelectorAll('[data-state]')].map(x => (x.innerText || '').replace(/\s+/g, ' ').slice(0, 120)).filter(Boolean).slice(0, 6);
    out.violation = [...document.querySelectorAll('span,div,p')].filter(e => e.children.length === 0 && /violation|violat|sensitive|review|reject/i.test(e.textContent || '')).map(e => (e.textContent || '').slice(0, 100)).slice(0, 8);
    out.lastTurns = [...document.querySelectorAll('[class*=message],[class*=bubble],[class*=markdown]')].map(m => (m.innerText || '').replace(/\s+/g, ' ').slice(0, 150)).filter(Boolean).slice(-4);
    out.taVal = (document.querySelector('textarea') || {}).value || '';
    return out;
  })()`);
  console.log(JSON.stringify(st, null, 1).slice(0, 2500));
} finally { await cdp.close(); }
