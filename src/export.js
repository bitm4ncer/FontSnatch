import { api, downloadBytes } from './lib/browser.js';
import { exportFont } from './lib/convert.js';
import { describeError } from './lib/errors.js';
import { fileNameFor, formatBytes } from './lib/format.js';
import { planExport } from './lib/export-plan.js';
import { loadPreferredFont } from './lib/preview.js';
import { subsetLabel } from './lib/select.js';
import { createZip } from './lib/zip.js';

const summary = document.getElementById('summary');
const bar = document.getElementById('bar-fill');
const log = document.getElementById('log');
const closeButton = document.getElementById('close');

function line(text, kind = '') {
  const item = document.createElement('li');
  if (kind) item.className = kind;
  item.textContent = text;
  log.append(item);
}

function fail(message) {
  summary.textContent = message;
  line(message, 'err');
  closeButton.disabled = false;
}

async function main() {
  const key = new URLSearchParams(location.search).get('key');
  if (!key) {
    fail('No export key provided.');
    return;
  }

  const stored = await api.storage.local.get(key);
  const payload = stored[key];
  await api.storage.local.remove(key);

  if (!payload) {
    fail('Export data not found. Start the export again from the popup.');
    return;
  }

  const { model, format, host } = payload;
  const plans = planExport(model, format);
  if (!plans.length) {
    fail('No downloadable fonts found.');
    return;
  }

  summary.textContent = `Preparing ${plans.length} ${plans.length === 1 ? 'file' : 'files'}…`;
  const entries = [];
  let errors = 0;

  for (let index = 0; index < plans.length; index++) {
    const { family, variant, target } = plans[index];

    try {
      const { bytes, kind } = await loadPreferredFont(variant);
      const result = await exportFont(bytes, target === 'woff' ? 'woff' : kind);
      const ext = result.renamed ? target : result.kind;
      const name = fileNameFor({
        family: family.family,
        weight: variant.weight,
        style: variant.style,
        subset: subsetLabel(variant.unicodeRange),
        ext,
      });
      entries.push({ name, data: result.data });
      line(`✓ ${name} · ${formatBytes(result.data.length)}`, 'ok');
    } catch (error) {
      errors++;
      line(`✗ ${family.family} ${variant.weight} ${variant.style}: ${describeError(error)}`, 'err');
    }

    const done = index + 1;
    bar.style.width = `${Math.round((done / plans.length) * 100)}%`;
    summary.textContent = `File ${done} of ${plans.length}…`;
  }

  if (!entries.length) {
    fail('No file could be loaded.');
    return;
  }

  const zip = createZip(entries);
  const date = new Date().toISOString().slice(0, 10);
  const safeHost = (host || 'export').replace(/[^a-z0-9.-]+/gi, '-');
  downloadBytes(zip, `fontsnatch-${safeHost}-${date}.zip`, 'application/zip');

  bar.style.width = '100%';
  summary.textContent = `${entries.length} ${entries.length === 1 ? 'file' : 'files'} saved as ZIP${errors ? ` · ${errors} ${errors === 1 ? 'error' : 'errors'}` : ''}`;
  closeButton.disabled = false;
}

closeButton.addEventListener('click', () => window.close());

main().catch((error) => {
  console.error(error);
  fail(error.message);
});
