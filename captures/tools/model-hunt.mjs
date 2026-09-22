// Find model ids: (1) all loaded JS chunks via performance entries, grep offline;
// (2) real-mouse click the composer model pill, dump menu items.
import { CDP, listTargets } from './cdp.mjs';

const targets = await listTargets();
const t = targets.find(x => x.type === 'page' && x.url.includes('xiaomimimo')) || targets.find(x => x.type === 'page' && !x.url.startsWith('chrome'));
if (!t) { console.log('no page'); process.exit(0); }
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Runtime.enable');
try {
  // 1) all loaded JS resources (plain string filter — no regex escaping)
  const urls = await cdp.eval("(function(){return performance.getEntriesByType('resource').map(function(r){return r.name}).filter(function(u){return u.indexOf('.js')>-1})})()");
  console.error('js chunks: ' + (Array.isArray(urls) ? urls.length : 0));
  const models = new Set();
  for (const u of (urls || []).slice(0, 300)) {
    try {
      const js = await (await fetch(u)).text();
      for (const m of js.matchAll(/mimo-[a-zA-Z0-9.-]{2,40}/g)) models.add(m[0]);
    } catch (e) {}
  }
  console.log('BUNDLE_MODELS: ' + JSON.stringify([...models].sort(), null, 1));

  // 2) real-mouse click on the COMPOSER model pill (cursor-pointer variant)
  const box = await cdp.eval("(function(){const el=[...document.querySelectorAll('div')].find(function(e){return (e.className||'').toString().indexOf('cursor-pointer')>-1 && /^MiMo-V/.test((e.innerText||'').trim()) && e.getBoundingClientRect().width>0});if(!el)return null;const r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),txt:(el.innerText||'').trim()}})()");
  console.error('pill: ' + JSON.stringify(box));
  if (box) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await cdp.wait(300);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await cdp.wait(1800);
    const menu = await cdp.eval("(function(){const out=[];document.querySelectorAll('div,section,li').forEach(function(e){if(!e.offsetParent)return;const txt=(e.innerText||'').trim();if(!txt||txt.length>300)return;const cls=(e.className||'').toString();if(/mimo|model|pro|flash|ultra|lite|air|think|claw|speed/i.test(txt)){out.push({txt:txt.split('\\n').filter(Boolean).slice(0,4),cls:cls.slice(0,50)})}});const seen=new Set();return out.filter(function(o){const k=o.txt.join('|');if(seen.has(k))return false;seen.add(k);return true}).slice(0,25)})()");
    console.log('MENU: ' + JSON.stringify(menu, null, 1).slice(0, 2500));
    await cdp.screenshot('E:/mimo-2-api-chat-continuation/captures/shots/model-menu.png').catch(() => {});
  }
} finally { await cdp.close(); }
