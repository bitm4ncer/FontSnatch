import { readSfnt, writeSfnt } from './sfnt.js';

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

const w16 = (b, o, v) => {
  b[o] = (v >>> 8) & 0xff;
  b[o + 1] = v & 0xff;
};

const w32 = (b, o, v) => {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
};

const pad4 = (n) => (n + 3) & ~3;

async function deflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function woffToSfnt(bytes) {
  if (bytes.length < 44) throw new Error('WOFF_TOO_SHORT');
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'wOFF') {
    throw new Error('NOT_WOFF');
  }
  const flavor = u32(bytes, 4);
  const length = u32(bytes, 8);
  const numTables = u16(bytes, 12);
  if (length !== bytes.length) throw new Error('WOFF_BAD_LENGTH');
  if (44 + numTables * 20 > bytes.length) throw new Error('WOFF_BAD_DIRECTORY');

  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const tag = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    const offset = u32(bytes, o + 4);
    const compLength = u32(bytes, o + 8);
    const origLength = u32(bytes, o + 12);
    if (offset + compLength > bytes.length) throw new Error(`WOFF_BAD_TABLE:${tag}`);
    const chunk = bytes.subarray(offset, offset + compLength);
    const data = compLength < origLength ? await inflate(chunk) : chunk;
    if (data.length !== origLength) throw new Error(`WOFF_BAD_ORIG_LENGTH:${tag}`);
    tables.push({ tag, data });
  }

  return writeSfnt(flavor, tables);
}

export async function sfntToWoff(bytes) {
  const font = readSfnt(bytes);
  const entries = [];

  for (const table of font.tables) {
    const compressed = await deflate(table.data);
    const data = compressed.length < table.data.length ? compressed : table.data;
    entries.push({
      tag: table.tag,
      data,
      origLength: table.data.length,
      checksum: table.checksum,
      offset: 0,
    });
  }

  let offset = 44 + entries.length * 20;
  for (const entry of entries) {
    entry.offset = offset;
    offset = pad4(offset + entry.data.length);
  }

  const totalSfntSize =
    12 +
    font.numTables * 16 +
    font.tables.reduce((sum, table) => sum + pad4(table.data.length), 0);

  const out = new Uint8Array(offset);
  out.set([0x77, 0x4f, 0x46, 0x46], 0);
  w32(out, 4, font.flavor);
  w32(out, 8, out.length);
  w16(out, 12, entries.length);
  w16(out, 14, 0);
  w32(out, 16, totalSfntSize);
  w16(out, 20, 0);
  w16(out, 22, 0);
  w32(out, 24, 0);
  w32(out, 28, 0);
  w32(out, 32, 0);
  w32(out, 36, 0);
  w32(out, 40, 0);

  entries.forEach((entry, index) => {
    const o = 44 + index * 20;
    for (let i = 0; i < 4; i++) out[o + i] = entry.tag.charCodeAt(i);
    w32(out, o + 4, entry.offset);
    w32(out, o + 8, entry.data.length);
    w32(out, o + 12, entry.origLength);
    w32(out, o + 16, entry.checksum);
    out.set(entry.data, entry.offset);
  });

  return out;
}
