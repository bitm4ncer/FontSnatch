import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWoff2CodecFromSource } from '../src/lib/woff2-codec.js';
import { decodeWith } from '../src/lib/woff2.js';
import { readSfnt } from '../src/lib/sfnt.js';

let codec = null;
async function getCodec() {
  if (!codec) codec = await createWoff2CodecFromSource(readFileSync('src/lib/woff2.wasm'));
  return codec;
}

test('vendorter Codec enthält kein new Function (MV3-CSP)', () => {
  for (const file of ['font-codecs-core.js', 'woff2-codec.js']) {
    const src = readFileSync(`src/lib/${file}`, 'utf8');
    assert.ok(!/new\s+Function/.test(src), file);
  }
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
  const sfnt = decodeWith(await getCodec(), bytes);
  assert.ok(sfnt.length > 50000);
  const font = readSfnt(sfnt);
  assert.equal(font.flavor, 0x00010000);
  const tags = font.tables.map((x) => x.tag);
  for (const tag of ['glyf', 'head', 'hmtx', 'cmap']) assert.ok(tags.includes(tag), tag);
});
