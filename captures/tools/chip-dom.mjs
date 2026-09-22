// Find the violation chip by text, dump its ancestor chain.
import { CDP, listTargets } from './cdp.mjs';

const targets = await listTargets();
const t = targets.find(x => x.type === 'page' && x.url.includes('xiaomimimo')) || targets.find(x => x.type === 'page');
if (!t) { console.log('no page'); process.exit(0); }
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Runtime.enable');
try {
  const dump = await cdp.eval(`(function(){
    const leaf = [...document.querySelectorAll('span,div,p')].find(e => e.children.length === 0 && /Content violation/i.test(e.textContent || ''));
    if (!leaf) return { chip: 'not-found', textarea: !!document.querySelector('textarea') };
    // walk up to the chip card (the [data-state] ancestor)
    let chip = leaf;
    while (chip && !chip.hasAttribute('data-state') && chip.parentElement) chip = chip.parentElement;
    const chain = [];
    let el = leaf;
    for (let i = 0; i < 6 && el; i++) { chain.push(el.tagName + '.' + (el.className || '').toString().slice(0, 50)); el = el.parentElement; }
    const card = chip.parentElement ? chip.parentElement : chip;
    return {
      chipHTML: chip.outerHTML.slice(0, 3000),
      parentHTML: card.outerHTML.slice(0, 2500),
      chain
    };
  })()`);
  console.log(JSON.stringify(dump, null, 1).slice(0, 5500));
} finally { await cdp.close(); }
