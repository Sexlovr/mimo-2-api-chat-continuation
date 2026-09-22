// Diff the DOM after clicking the model pill to find the menu (it may render as
// generic divs, not role=menu), and list any element that mentions other models.
import { CDP, listTargets } from './cdp.mjs';

const targets = await listTargets();
const t = targets.find(x => x.type === 'page' && x.url.includes('xiaomimimo')) || targets.find(x => x.type === 'page' && !x.url.startsWith('chrome'));
if (!t) { console.log('no page'); process.exit(0); }
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Runtime.enable');
try {
  // click the model pill
  const clicked = await cdp.eval("(function(){const el=[...document.querySelectorAll('div,button')].find(e=>e.children.length>0&&/^MiMo-V/.test((e.innerText||'').trim())&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().width<300);if(!el)return 'not found';el.scrollIntoView({block:'center'});el.click();return 'clicked';})()");
  console.error('trigger: ' + clicked);
  await cdp.wait(1800);

  // everything visible mentioning model-ish text, with class hints
  const dump = await cdp.eval("(function(){const out=[];document.querySelectorAll('div,section').forEach(e=>{if(!e.offsetParent)return;const txt=(e.innerText||'').trim();if(!txt)return;const cls=(e.className||'').toString();if(/mimo-v|ultraspeed|mimo claw|mimo chat|flash|ultra|lite|air|max/i.test(txt)&&txt.length<900){out.push({cls:cls.slice(0,80),txt:txt.slice(0,300)})}});const seen=new Set();return out.filter(o=>{const k=o.txt.slice(0,60);if(seen.has(k))return false;seen.add(k);return true})})()");
  console.log(JSON.stringify(dump, null, 1).slice(0, 3500));
  await cdp.screenshot('E:/mimo-2-api-chat-continuation/captures/shots/model-menu.png').catch(() => {});
} finally { await cdp.close(); }
