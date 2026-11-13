const readU16 = (b, o) => (b[o] << 8) | b[o + 1];
const readU32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

const writeU16 = (b, o, v) => {
  b[o] = (v >>> 8) & 0xff;
  b[o + 1] = v & 0xff;
};

const writeU32 = (b, o, v) => {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
};

const readTag = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

const writeTag = (b, o, tag) => {
  for (let i = 0; i < 4; i++) b[o + i] = tag.charCodeAt(i);
};

export function tableChecksum(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const word =
      (((data[i] || 0) << 24) |
        ((data[i + 1] || 0) << 16) |
        ((data[i + 2] || 0) << 8) |
        (data[i + 3] || 0)) >>>
      0;
    sum = (sum + word) >>> 0;
  }
  return sum;
}

export function readSfnt(bytes) {
  if (bytes.length < 12) throw new Error('SFNT_TOO_SHORT');
  const flavor = readU32(bytes, 0);
  const numTables = readU16(bytes, 4);
  if (12 + numTables * 16 > bytes.length) throw new Error('SFNT_BAD_DIRECTORY');

  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = readTag(bytes, o);
    const checksum = readU32(bytes, o + 4);
    const offset = readU32(bytes, o + 8);
    const length = readU32(bytes, o + 12);
    if (offset + length > bytes.length) throw new Error(`SFNT_BAD_TABLE:${tag}`);
    tables.push({ tag, offset, length, checksum, data: bytes.subarray(offset, offset + length) });
  }
  return { flavor, numTables, tables };
}

export function writeSfnt(flavor, tables) {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const numTables = sorted.length;
  if (numTables === 0) throw new Error('SFNT_NO_TABLES');

  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 16 * 2 ** entrySelector;
  const rangeShift = numTables * 16 - searchRange;

  const prepared = sorted.map((table) => {
    const data = new Uint8Array(table.data);
    if (table.tag === 'head' && data.length >= 12) data.fill(0, 8, 12);
    return { tag: table.tag, data, checksum: tableChecksum(data), offset: 0 };
  });

  let offset = 12 + numTables * 16;
  for (const table of prepared) {
    table.offset = offset;
    offset += (table.data.length + 3) & ~3;
  }

  const out = new Uint8Array(offset);
  writeU32(out, 0, flavor);
  writeU16(out, 4, numTables);
  writeU16(out, 6, searchRange);
  writeU16(out, 8, entrySelector);
  writeU16(out, 10, rangeShift);

  prepared.forEach((table, index) => {
    const o = 12 + index * 16;
    writeTag(out, o, table.tag);
    writeU32(out, o + 4, table.checksum);
    writeU32(out, o + 8, table.offset);
    writeU32(out, o + 12, table.data.length);
    out.set(table.data, table.offset);
  });

  const head = prepared.find((table) => table.tag === 'head');
  if (head && head.data.length >= 12) {
    let sum = 0;
    for (let i = 0; i < out.length; i += 4) sum = (sum + readU32(out, i)) >>> 0;
    writeU32(out, head.offset + 8, (0xb1b0afba - sum) >>> 0);
  }

  return out;
}

export function sfntKind(flavor) {
  if (flavor === 0x00010000 || flavor === 0x74727565) return 'ttf';
  if (flavor === 0x4f54544f) return 'otf';
  if (flavor === 0x74746366) return 'collection';
  return 'unknown';
}

export function sniffContainer(bytes) {
  if (bytes.length < 4) return 'unknown';
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (sig === 'wOF2') return 'woff2';
  if (sig === 'wOFF') return 'woff';
  return sfntKind(readU32(bytes, 0));
}
