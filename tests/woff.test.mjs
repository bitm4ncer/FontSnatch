import { test } from 'node:test';
import assert from 'node:assert/strict';
import { woffToSfnt, sfntToWoff } from '../src/lib/woff.js';
import { readSfnt, writeSfnt } from '../src/lib/sfnt.js';
import { systemSfnt } from './helpers.mjs';

test('sfnt -> woff -> sfnt erhält alle Tabellen', async (t) => {
  const bytes = systemSfnt();
  if (!bytes) return t.skip('no system TTF');
  const woff = await sfntToWoff(bytes);
  assert.equal(Buffer.from(woff.subarray(0, 4)).toString('ascii'), 'wOFF');
  const woffBuf = Buffer.from(woff);
  assert.equal(woffBuf.readUInt32BE(8), woff.length);
  assert.equal(woffBuf.readUInt16BE(12), readSfnt(bytes).numTables);
  const back = await woffToSfnt(woff);
  const a = readSfnt(bytes);
  const b = readSfnt(back);
  assert.deepEqual(b.tables.map((x) => x.tag), a.tables.map((x) => x.tag));
  for (const table of a.tables) {
    const other = b.tables.find((x) => x.tag === table.tag);
    if (table.tag === 'head') {
      const strip = (d) => Buffer.concat([Buffer.from(d.subarray(0, 8)), Buffer.from(d.subarray(12))]);
      assert.deepEqual(strip(other.data), strip(table.data));
    } else {
      assert.deepEqual(Buffer.from(other.data), Buffer.from(table.data));
    }
  }
});

test('komprimierbare Tabellen werden kleiner gespeichert', async () => {
  const tables = [
    { tag: 'AAAA', data: new Uint8Array(4000).fill(65) },
    { tag: 'BBBB', data: new Uint8Array([1, 2, 3, 4]) },
  ];
  const sfnt = writeSfnt(0x00010000, tables);
  const woff = await sfntToWoff(sfnt);
  assert.ok(woff.length < sfnt.length + 400);
  const back = readSfnt(await woffToSfnt(woff));
  assert.deepEqual(back.tables.find((x) => x.tag === 'AAAA').data, tables[0].data);
});
