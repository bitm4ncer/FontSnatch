import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = join(process.cwd(), 'src', 'icons');
const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling per axis

const BG = [20, 20, 20];
const FG = [255, 255, 255];
const ACCENT = [255, 90, 31];

const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([len, name, data, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundRect(x, y, radius) {
  const qx = Math.abs(x - 0.5) - (0.5 - radius);
  const qy = Math.abs(y - 0.5) - (0.5 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) <= radius;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function classify(x, y) {
  if (!insideRoundRect(x, y, 0.22)) return null;

  const stroke = 0.043;
  const isA =
    distanceToSegment(x, y, 0.5, 0.17, 0.27, 0.625) <= stroke ||
    distanceToSegment(x, y, 0.5, 0.17, 0.73, 0.625) <= stroke ||
    distanceToSegment(x, y, 0.365, 0.485, 0.635, 0.485) <= stroke;

  const inShaft = x >= 0.465 && x <= 0.535 && y >= 0.665 && y <= 0.775;
  const inHead = inTriangle(x, y, 0.395, 0.755, 0.605, 0.755, 0.5, 0.905);
  if (isA) return FG;
  if (inShaft || inHead) return ACCENT;
  return BG;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;
          const color = classify(px, py);
          if (!color) continue;
          hits++;
          r += color[0];
          g += color[1];
          b += color[2];
        }
      }
      const i = (y * size + x) * 4;
      if (hits === 0) continue;
      rgba[i] = Math.round(r / hits);
      rgba[i + 1] = Math.round(g / hits);
      rgba[i + 2] = Math.round(b / hits);
      rgba[i + 3] = Math.round((hits / (SS * SS)) * 255);
    }
  }
  return rgba;
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  writeFileSync(join(OUT, `icon${size}.png`), encodePng(size, size, render(size)));
}
console.log(`icons: ${SIZES.join(', ')}`);
