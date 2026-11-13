let ready = null;

function loadDecoder() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    if (globalThis.Module?.decompress && globalThis.Module.calledRun) {
      resolve(globalThis.Module);
      return;
    }
    const timer = setTimeout(() => reject(new Error('WOFF2_DECODER_TIMEOUT')), 15000);
    globalThis.Module = {
      onRuntimeInitialized: () => {
        clearTimeout(timer);
        resolve(globalThis.Module);
      },
    };
    const script = document.createElement('script');
    script.src = new URL('woff2-decoder.js', import.meta.url).href;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('WOFF2_DECODER_LOAD_FAILED'));
    };
    document.head.append(script);
  });
  return ready;
}

export function decodeWith(mod, bytes) {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x77 ||
    bytes[1] !== 0x4f ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x32
  ) {
    throw new Error('NOT_WOFF2');
  }
  const out = mod.decompress(bytes);
  if (out === false) throw new Error('WOFF2_DECODE_FAILED');
  return new Uint8Array(out.buffer ?? out, out.byteOffset ?? 0, out.length);
}

export async function woff2ToSfnt(bytes) {
  return decodeWith(await loadDecoder(), bytes);
}
