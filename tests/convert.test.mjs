import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportFont, toSfnt } from '../src/lib/convert.js';
import { fileNameFor, formatBytes, sanitizeFamily } from '../src/lib/format.js';
import { systemSfnt, systemCff } from './helpers.mjs';

test('TTF bleibt TTF, OTF bleibt OTF', async (t) => {
  const ttf = systemSfnt();
  if (!ttf) return t.skip('no system TTF');
  const a = await toSfnt(new Uint8Array(ttf));
  assert.equal(a.kind, 'ttf');
  const b = await exportFont(new Uint8Array(ttf), 'ttf');
  assert.equal(b.kind, 'ttf');
  const cff = systemCff();
  if (cff) {
    const c = await toSfnt(new Uint8Array(cff));
    assert.equal(c.kind, 'otf');
    assert.equal((await exportFont(new Uint8Array(cff), 'otf')).kind, 'otf');
  }
});

test('falsche Endung wird ohne Opt-in verweigert', async (t) => {
  const ttf = systemSfnt();
  if (!ttf) return t.skip('no system TTF');
  await assert.rejects(() => exportFont(new Uint8Array(ttf), 'otf'), /FORMAT_MISMATCH/);
  const forced = await exportFont(new Uint8Array(ttf), 'otf', { allowMismatchedExtension: true });
  assert.equal(forced.renamed, true);
});

test('WOFF-Export liefert wOFF', async (t) => {
  const ttf = systemSfnt();
  if (!ttf) return t.skip('no system TTF');
  const woff = await exportFont(new Uint8Array(ttf), 'woff');
  assert.equal(Buffer.from(woff.data.subarray(0, 4)).toString('ascii'), 'wOFF');
  assert.equal(woff.kind, 'woff');
});

test('Dateinamen und Größen', () => {
  assert.equal(sanitizeFamily('  Noto Sans / Display '), 'Noto-Sans-Display');
  assert.equal(fileNameFor({ family: 'Noto Sans', weight: '400', style: 'italic', subset: 'latin', ext: 'woff2' }), 'Noto-Sans-400-italic-latin.woff2');
  assert.equal(fileNameFor({ family: 'X', weight: '400', style: 'normal', subset: null, ext: 'ttf' }), 'X-400-normal.ttf');
  assert.equal(formatBytes(22636), '22.1 KB');
});
