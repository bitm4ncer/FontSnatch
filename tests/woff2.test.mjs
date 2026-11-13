import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { decodeWith } from '../src/lib/woff2.js';
import { readSfnt } from '../src/lib/sfnt.js';

const require = createRequire(import.meta.url);
const decoder = require('../src/lib/woff2-decoder.js');
const ready = new Promise((resolve) => {
  decoder.onRuntimeInitialized = resolve;
});

test('vendorter Decoder enthält kein new Function (MV3-CSP)', () => {
  const src = readFileSync('src/lib/woff2-decoder.js', 'utf8');
  assert.ok(!/new\s+Function/.test(src));
});

test('dekodiert echte Google-Fonts-WOFF2-Datei', async (t) => {
  let bytes;
  try {
    const res = await fetch('https://www.dandad.org/fonts/universal-400.woff2');
    if (!res.ok) throw new Error(String(res.status));
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return t.skip('Testseite nicht erreichbar');
  }
  await ready;
  const sfnt = decodeWith(decoder, bytes);
  assert.ok(sfnt.length > 50000);
  const font = readSfnt(sfnt);
  assert.equal(font.flavor, 0x00010000);
  const tags = font.tables.map((x) => x.tag);
  for (const tag of ['glyf', 'head', 'hmtx', 'cmap']) assert.ok(tags.includes(tag), tag);
});
