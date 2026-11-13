import { api, downloadBytes } from './lib/browser.js';
import { exportFont } from './lib/convert.js';
import { fileNameFor, formatBytes } from './lib/format.js';
import { loadFontFile } from './lib/preview.js';
import { preferredSource, subsetLabel } from './lib/select.js';
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
    fail('Kein Export-Schlüssel übergeben.');
    return;
  }

  const stored = await api.storage.local.get(key);
  const payload = stored[key];
  await api.storage.local.remove(key);

  if (!payload) {
    fail('Exportdaten nicht gefunden. Bitte den Export im Popup erneut starten.');
    return;
  }

  const { model, format, host } = payload;
  const families = (model.families || []).filter((family) => family.available);
  if (!families.length) {
    fail('Keine ladbaren Fonts gefunden.');
    return;
  }

  summary.textContent = `${families.length} ${families.length === 1 ? 'Familie' : 'Familien'} werden vorbereitet …`;
  const entries = [];
  let errors = 0;

  for (let index = 0; index < families.length; index++) {
    const family = families[index];
    const variant = family.variants.find((item) => item.isDefault) || family.variants[0];
    const source = preferredSource(variant);

    if (!source) {
      errors++;
      line(`✗ ${family.family}: keine Quelle`, 'err');
    } else {
      try {
        const { bytes, kind } = await loadFontFile(source.url);
        const target = format === 'woff' ? 'woff' : kind;
        const result = await exportFont(bytes, target);
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
        line(`✗ ${family.family}: ${error.message}`, 'err');
      }
    }

    const done = index + 1;
    bar.style.width = `${Math.round((done / families.length) * 100)}%`;
    summary.textContent = `Datei ${done} von ${families.length} …`;
  }

  if (!entries.length) {
    fail('Keine Datei konnte geladen werden.');
    return;
  }

  const zip = createZip(entries);
  const date = new Date().toISOString().slice(0, 10);
  const safeHost = (host || 'export').replace(/[^a-z0-9.-]+/gi, '-');
  downloadBytes(zip, `fontsnatch-${safeHost}-${date}.zip`, 'application/zip');

  bar.style.width = '100%';
  summary.textContent = `${entries.length} ${entries.length === 1 ? 'Datei' : 'Dateien'} als ZIP gespeichert${errors ? ` · ${errors} Fehler` : ''}`;
  closeButton.disabled = false;
}

closeButton.addEventListener('click', () => window.close());

main().catch((error) => {
  console.error(error);
  fail(error.message);
});
