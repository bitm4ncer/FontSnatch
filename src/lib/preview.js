import { fetchBytes } from './browser.js';
import { toSfnt } from './convert.js';

const cache = new Map();
let counter = 0;

export async function loadFontFile(url) {
  const cached = cache.get(url);
  if (cached) {
    if (cached.error) throw cached.error;
    return { bytes: cached.bytes, kind: cached.kind };
  }

  try {
    const raw = await fetchBytes(url);
    const { sfnt, kind } = await toSfnt(raw);
    cache.set(url, { bytes: sfnt, kind });
    return { bytes: sfnt, kind };
  } catch (error) {
    cache.set(url, { error });
    throw error;
  }
}

export function forgetFontFile(url) {
  cache.delete(url);
}

export async function registerPreview(bytes) {
  const name = `__fns_${++counter}`;
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const face = new FontFace(name, copy);
  await face.load();
  document.fonts.add(face);
  return name;
}
