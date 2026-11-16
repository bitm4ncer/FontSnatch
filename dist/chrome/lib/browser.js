export const api = globalThis.browser ?? globalThis.chrome;

export async function getActiveTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function runInTab(tabId, func) {
  const results = await api.scripting.executeScript({ target: { tabId }, func, args: [] });
  return results?.[0]?.result;
}

export async function fetchBytes(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) {
    const error = new Error(`FONT_FETCH_FAILED:${res.status}`);
    error.code = 'FONT_FETCH_FAILED';
    error.status = res.status;
    throw error;
  }
  return new Uint8Array(await res.arrayBuffer());
}

export function downloadBytes(bytes, filename, mime = 'application/octet-stream') {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const DEFAULTS = {
  previewText: 'The quick brown fox jumps over the lazy dog',
  allowMismatchedExtension: false,
};

export async function loadSettings() {
  const stored = await api.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(patch) {
  await api.storage.local.set(patch);
}
