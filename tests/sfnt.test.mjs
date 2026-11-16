import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSfnt, writeSfnt, sfntKind, sniffContainer } from '../src/lib/sfnt.js';
import { systemSfnt, systemCff } from './helpers.mjs';

test('readSfnt liest echte TTF-Tabellen', (t) => {
  const bytes = systemSfnt();
  if (!bytes) return t.skip('no system TTF');
  const font = readSfnt(bytes);
  assert.equal(sfntKind(font.flavor), 'ttf');
  const tags = font.tables.map((x) => x.tag);
  for (const tag of ['cmap', 'head', 'hhea', 'hmtx', 'maxp']) assert.ok(tags.includes(tag), tag);
});

test('writeSfnt erhält alle Tabelleninhalte', (t) => {
  const bytes = systemSfnt();
  if (!bytes) return t.skip('no system TTF');
  const font = readSfnt(bytes);
  const rebuilt = writeSfnt(font.flavor, font.tables.map(({ tag, data }) => ({ tag, data })));
  const again = readSfnt(rebuilt);
  assert.deepEqual(again.tables.map((x) => x.tag), font.tables.map((x) => x.tag));
  for (const table of font.tables) {
    const other = again.tables.find((x) => x.tag === table.tag);
    const actualBytes = Buffer.from(other.data);
    const expectedBytes = Buffer.from(table.data);
    if (table.tag === 'head') {
      actualBytes.fill(0, 8, 12);
      expectedBytes.fill(0, 8, 12);
    }
    assert.deepEqual(actualBytes, expectedBytes);
  }
});

test('sniffContainer und sfntKind erkennen alle Container', (t) => {
  const ttf = systemSfnt();
  if (!ttf) return t.skip('no system TTF');
  assert.equal(sniffContainer(ttf), 'ttf');
  assert.equal(sfntKind(0x4f54544f), 'otf');
  assert.equal(sfntKind(0x74746366), 'collection');
  assert.equal(sniffContainer(new Uint8Array([0x77, 0x4f, 0x46, 0x32])), 'woff2');
  assert.equal(sniffContainer(new Uint8Array([0x77, 0x4f, 0x46, 0x46])), 'woff');
  const cff = systemCff();
  if (cff) assert.equal(sniffContainer(cff), 'otf');
});
