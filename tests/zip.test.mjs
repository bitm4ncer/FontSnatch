import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZip, crc32 } from '../src/lib/zip.js';

test('ZIP hat lokale Header, zentrale Verzeichnisse und CRC', () => {
  const zip = createZip([
    { name: 'a.txt', data: new TextEncoder().encode('hallo') },
    { name: 'ordner/b.bin', data: new Uint8Array([1, 2, 3]) },
  ]);
  const buf = Buffer.from(zip);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50);
  assert.equal(buf.readUInt16LE(eocd + 10), 2);
  assert.equal(crc32(new TextEncoder().encode('hallo')), 0xb97231d1);
});

test('doppelte Namen werden eindeutig gemacht', () => {
  const zip = createZip([
    { name: 'x.ttf', data: new Uint8Array([1]) },
    { name: 'x.ttf', data: new Uint8Array([2]) },
  ]);
  const buf = Buffer.from(zip);
  assert.equal(buf.readUInt16LE(buf.length - 22 + 10), 2);
  const names = new TextDecoder().decode(zip).match(/x(-\d+)?\.ttf/g);
  assert.deepEqual([...new Set(names)], ['x.ttf', 'x-2.ttf']);
});

test('Pfad-Traversal und Groß-/Kleinschreibung werden entschärft', () => {
  const zip = createZip([
    { name: '../evil.ttf', data: new Uint8Array([1]) },
    { name: 'X.TTF', data: new Uint8Array([2]) },
    { name: 'x.ttf', data: new Uint8Array([3]) },
    { name: 'ordner/../boese.ttf', data: new Uint8Array([4]) },
  ]);
  const text = new TextDecoder().decode(zip);
  assert.equal(text.includes('../'), false);
  const names = [...new Set(text.match(/[A-Za-z0-9._-]+\.ttf/gi))];
  assert.equal(names.length, 4);
  assert.ok(names.includes('X.TTF'));
  assert.ok(names.includes('x-2.ttf'));
  assert.ok(names.includes('boese.ttf'));
});
