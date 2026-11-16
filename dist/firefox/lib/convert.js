import { sniffContainer } from './sfnt.js';
import { sfntToWoff, woffToSfnt } from './woff.js';
import { woff2ToSfnt } from './woff2.js';

export async function toSfnt(bytes) {
  const container = sniffContainer(bytes);

  if (container === 'ttf' || container === 'otf') return { sfnt: bytes, kind: container };

  if (container === 'woff' || container === 'woff2') {
    const sfnt = container === 'woff' ? await woffToSfnt(bytes) : await woff2ToSfnt(bytes);
    const kind = sniffContainer(sfnt);
    if (kind !== 'ttf' && kind !== 'otf') throw new Error(`UNSUPPORTED_FORMAT:${kind}`);
    return { sfnt, kind };
  }

  const error = new Error(`UNSUPPORTED_FORMAT:${container}`);
  error.code = 'UNSUPPORTED_FORMAT';
  throw error;
}

export async function exportFont(bytes, target, opts = {}) {
  if (!['ttf', 'otf', 'woff'].includes(target)) throw new Error(`BAD_TARGET:${target}`);

  const { sfnt, kind } = await toSfnt(bytes);

  if (target === 'woff') {
    return { data: await sfntToWoff(sfnt), kind: 'woff', renamed: false };
  }

  if (kind !== target) {
    if (!opts.allowMismatchedExtension) {
      const error = new Error(`FORMAT_MISMATCH:${kind}`);
      error.code = 'FORMAT_MISMATCH';
      error.kind = kind;
      throw error;
    }
    return { data: sfnt, kind, renamed: true };
  }

  return { data: sfnt, kind, renamed: false };
}
