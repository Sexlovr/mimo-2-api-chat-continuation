// Generate a photo-like 800x600 landscape PNG (no deps) for upload testing.
import zlib from 'node:zlib';
import fs from 'node:fs';

const W = 800, H = 600;
const px = Buffer.alloc(W * H * 3);

const lerp = (a, b, t) => a + (b - a) * t;
// sky: blue -> warm orange near horizon (y ~ 380)
for (let y = 0; y < H; y++) {
  let r, g, b;
  if (y < 380) {
    const t = y / 380;
    r = lerp(110, 250, t); g = lerp(170, 200, t); b = lerp(245, 140, t);
  } else if (y < 420) {          // haze band
    r = 250; g = 215; b = 165;
  } else {                        // ground: warm -> dark
    const t = (y - 420) / (H - 420);
    r = lerp(150, 60, t); g = lerp(130, 55, t); b = lerp(95, 45, t);
  }
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    px[i] = r | 0; px[i + 1] = g | 0; px[i + 2] = b | 0;
  }
}
// sun disk at (620, 300)
for (let y = 260; y < 340; y++) for (let x = 580; x < 660; x++) {
  const dx = x - 620, dy = y - 300;
  if (dx * dx + dy * dy < 40 * 40) { const i = (y * W + x) * 3; px[i] = 255; px[i + 1] = 240; px[i + 2] = 200; }
}
// two mountain ridges (dark triangles)
const ridge = (pts, col) => {
  for (let x = 0; x < W; x++) {
    // find ridge height at x via linear interpolation between points
    let h = 0;
    for (let p = 0; p < pts.length - 1; p++) {
      if (x >= pts[p][0] && x <= pts[p + 1][0]) {
        const t = (x - pts[p][0]) / (pts[p + 1][0] - pts[p][0]);
        h = lerp(pts[p][1], pts[p + 1][1], t); break;
      }
    }
    for (let y = Math.floor(h); y < H; y++) {
      const i = (y * W + x) * 3;
      px[i] = Math.min(px[i], col[0]); px[i + 1] = Math.min(px[i + 1], col[1]); px[i + 2] = Math.min(px[i + 2], col[2]);
    }
  }
};
ridge([[0, 300], [180, 180], [320, 290], [470, 150], [620, 280], [800, 220]], [70, 60, 80]);
ridge([[0, 360], [150, 260], [350, 350], [560, 240], [800, 330]], [45, 38, 52]);
// subtle noise for photo feel
for (let i = 0; i < px.length; i++) { const n = (Math.random() * 10 - 5) | 0; px[i] = Math.max(0, Math.min(255, px[i] + n)); }

// PNG encode
const raw = Buffer.alloc(H * (1 + W * 3));
let o = 0;
for (let y = 0; y < H; y++) { raw[o++] = 0; px.copy(raw, o, y * W * 3, (y + 1) * W * 3); o += W * 3; }
const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcT[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync('E:/mimo-2-api-chat-continuation/captures/testfiles/landscape.png', png);
console.log('landscape.png written:', png.length, 'bytes');
