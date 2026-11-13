import { createWoff2CodecFromSource } from './woff2-codec.js';

let codecPromise = null;

function getCodec() {
  if (!codecPromise) {
    codecPromise = createWoff2CodecFromSource(new URL('woff2.wasm', import.meta.url)).catch((error) => {
      codecPromise = null;
      throw error;
    });
  }
  return codecPromise;
}

export function decodeWith(codec, bytes) {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x77 ||
    bytes[1] !== 0x4f ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x32
  ) {
    throw new Error('NOT_WOFF2');
  }
  return codec.decode(bytes).data;
}

export async function woff2ToSfnt(bytes) {
  return decodeWith(await getCodec(), bytes);
}
