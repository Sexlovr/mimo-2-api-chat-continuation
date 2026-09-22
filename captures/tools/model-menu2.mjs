// Real-mouse click on the model pill (synthetic .click() doesn't open the Radix menu),
// then dump the menu options and each option's model id from the DOM.
import { CDP, listTargets } from './cdp.mjs';

const targets = await listTargets();
const t = targets.find(x => x.type === 'page' && x.url.includes('xiaomimimo')) || targets.find(x => x.type === 'page' && !x.url.startsWith('chrome'));
if (!t) { console.log('no page'); process.exit(0); }
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Runtime.enable');
try {
  await cdp.send('Page.bringToFront');
  const box = await cdp.eval("(function(){const el=[...document.querySelectorAll('div,button')].find(e=>e.children.length>0&&/^MiMo-V/.test((e.innerText||'').trim())&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().width<300);if(!el)return null;const r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()");
  if (!box) { console.log('pill not found'); process.exit(0); }
  console.error('pill at', JSON.stringify(box));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await cdp.wait(200);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await cdp.wait(1800);

  // Radix/portal menu options — look for [role=menuitem], [cmdk-item], or data-highlighted
  const dump = await cdp.eval("(function(){const out=[];document.querySelectorAll('[role=menuitem],[cmdk-item],[data-highlighted],[class*=command],[class*=item]').forEach(e=>{if(!e.offsetParent)return;const txt=(e.innerText||'').trim();if(txt&&txt.length<200)out.push({txt:txt,cls:(e.className||'').toString().slice(0,60)})});const seen=new Set();return out.filter(o=>{const k=o.txt.slice(0,50);if(seen.has(k))return false;seen.add(k);return true})})()");
  console.log(JSON.stringify(dump, null, 1).slice(0, 3000));
  await cdp.screenshot('E:/mimo-2-api-chat-continuation/captures/shots/model-menu.png').catch(() => {});
} finally { await cdp.close(); }
