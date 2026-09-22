// Direct-API upload ceiling prober: genUploadInfo -> PUT -> parse, with escalating sizes.
// Bypasses the browser entirely — reveals the SERVER-side ceiling.
import crypto from 'node:crypto';
import fs from 'node:fs';

const cookies = JSON.parse(fs.readFileSync('E:/mimo-2-api-chat-continuation/captures/cookies-rapid-grove.json', 'utf8'));
const PH = encodeURIComponent(cookies.phToken);
const COOKIE = `xiaomichatbot_serviceToken="${cookies.serviceToken}"; userId=${cookies.userId}; xiaomichatbot_ph="${cookies.phToken}"`;
const BASE = 'https://aistudio.xiaomimimo.com';
const H = {
  'accept': '*/*', 'accept-language': 'en-US,en;q=0.9', 'content-type': 'application/json',
  'cookie': COOKIE, 'origin': BASE, 'referer': BASE + '/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'x-timezone': 'UTC'
};

const SIZES = [1024 * 1024, 5 * 1024 * 1024, 20 * 1024 * 1024, 50 * 1024 * 1024, 100 * 1024 * 1024];

// realistic-ish text content (repeated filler)
const fillLine = () => 'The quick brown fox jumps over the lazy dog near the riverbank at dawn. ';

for (const size of SIZES) {
  const name = `probe-${(size / 1024 / 1024)}mb.txt`;
  // build content without holding two copies
  const line = fillLine();
  const reps = Math.ceil(size / line.length);
  let content = line.repeat(Math.min(reps, 10000));
  while (content.length < size) content += line.repeat(Math.min(10000, Math.ceil((size - content.length) / line.length)));
  content = content.slice(0, size);
  const buf = Buffer.from(content, 'utf8');
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  const tagged = `${name.replace(/\.txt$/, '')}-${crypto.randomBytes(16).toString('hex')}.txt`;
  console.log(`\n=== ${name} (${(buf.length / 1024 / 1024).toFixed(1)} MB) ===`);

  // 1) genUploadInfo
  let info;
  try {
    const r = await fetch(`${BASE}/open-apis/resource/genUploadInfo?xiaomichatbot_ph=${PH}`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ fileName: tagged, fileContentMd5: md5 })
    });
    const txt = await r.text();
    console.log(`genUploadInfo: HTTP ${r.status} → ${txt.slice(0, 300)}`);
    info = JSON.parse(txt);
    if (info.code !== 0) { console.log('→ genUploadInfo REJECTED at this size; stopping escalation if this persists'); }
  } catch (e) { console.log('genUploadInfo error: ' + e.message); continue; }
  if (info.code !== 0) continue;

  // 2) PUT the bytes to the signed URL
  try {
    const t0 = Date.now();
    const r2 = await fetch(info.data.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'content-md5': md5 },
      body: buf
    });
    const t2 = await r2.text();
    console.log(`PUT: HTTP ${r2.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${t2.slice(0, 200)}`);
    if (!r2.ok) continue;
  } catch (e) { console.log('PUT error: ' + e.message); continue; }

  // 3) parse (server-side ingestion)
  try {
    const r3 = await fetch(`${BASE}/open-apis/resource/parse?fileUrl=${encodeURIComponent(info.data.resourceUrl)}&xiaomichatbot_ph=${PH}`, {
      method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: '{}'
    });
    const t3 = await r3.text();
    console.log(`parse: HTTP ${r3.status} → ${t3.slice(0, 400)}`);
  } catch (e) { console.log('parse error: ' + e.message); }
}
console.log('\nDone.');
