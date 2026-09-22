// Probe the aistudio UI model dropdown for all model ids.
import { CDP, listTargets } from './cdp.mjs';

const targets = await listTargets();
const t = targets.find(x => x.type === 'page' && x.url.includes('xiaomimimo')) || targets.find(x => x.type === 'page' && !x.url.startsWith('chrome'));
if (!t) { console.log('no page'); process.exit(0); }
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Runtime.enable');
try {
  // find the model selector: button/trigger mentioning MiMo or model name
  const probe = await cdp.eval(`(function(){
    const out = {};
    // any element that looks like a model picker trigger
    const cands = [...document.querySelectorAll('button, [role=combobox], [class*=select], [class*=model]')]
      .map((el, i) => ({ i, tag: el.tagName, txt: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 60), cls: (el.className || '').toString().slice(0, 70), vis: !!el.offsetParent }))
      .filter(e => e.txt && /mimo|model|pro|flash|ultra/i.test(e.txt + ' ' + e.cls));
    out.cands = cands.slice(0, 12);
    out.bodyHas = /MiMo-V/.test(document.body.innerText) ? document.body.innerText.match(/MiMo-V[\d.-]+[a-z-]*/gi) : null;
    return out;
  })()`);
  console.log(JSON.stringify(probe, null, 1).slice(0, 2000));
} finally { await cdp.close(); }
