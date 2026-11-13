import { api, downloadBytes, fetchBytes, getActiveTab, loadSettings, saveSettings } from './lib/browser.js';
import { exportFont } from './lib/convert.js';
import { fileNameFor, formatBytes, mimeFor } from './lib/format.js';
import { analyzeTab } from './lib/pipeline.js';
import { forgetFontFile, loadFontFile, registerPreview } from './lib/preview.js';
import { formatLabel, preferredSource, subsetLabel } from './lib/select.js';

const numberFormat = new Intl.NumberFormat('de-DE');

const state = {
  model: null,
  analysis: null,
  filter: 'used',
  query: '',
  settings: null,
  loading: false,
  error: null,
  previewNames: new Map(),
};

const els = {
  site: document.getElementById('site'),
  status: document.getElementById('status'),
  list: document.getElementById('font-list'),
  empty: document.getElementById('empty'),
  filters: document.getElementById('filters'),
  search: document.getElementById('search'),
  previewText: document.getElementById('preview-text'),
  reload: document.getElementById('reload'),
  settings: document.getElementById('settings'),
  settingsPanel: document.getElementById('settings-panel'),
  allowMismatch: document.getElementById('allow-mismatch'),
  zipButton: document.getElementById('zip-button'),
  zipFormat: document.getElementById('zip-format'),
  unassigned: document.getElementById('unassigned'),
  unassignedList: document.getElementById('unassigned-list'),
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function visibleFamilies() {
  const query = state.query.trim().toLowerCase();
  return (state.model?.families || []).filter((family) => {
    if (state.filter === 'used' && !family.usedChars) return false;
    if (state.filter === 'downloadable' && !family.available) return false;
    if (query && !family.family.toLowerCase().includes(query)) return false;
    return true;
  });
}

function fileCount(families) {
  return families.reduce((sum, family) => sum + family.variants.length, 0);
}

function statusText() {
  if (state.loading) return 'Analysiere Seite …';
  if (state.error) return '';
  if (!state.model) return '';
  const families = state.model.families;
  const files = fileCount(families);
  let text = `${families.length} ${families.length === 1 ? 'Familie' : 'Familien'} · ${files} ${files === 1 ? 'Datei' : 'Dateien'}`;
  if (state.model.stats.truncated) text += ' · Seite zu groß, Liste unvollständig';
  return text;
}

function updateButtons(container, kind) {
  if (!container) return;
  if (kind) container.dataset.kind = kind;
  const effective = container.dataset.kind || '';
  const allow = state.settings?.allowMismatchedExtension;

  for (const button of container.querySelectorAll('[data-target]')) {
    const target = button.dataset.target;
    if (target === 'woff') {
      button.disabled = false;
      button.title = 'Als WOFF speichern';
      continue;
    }
    if (!effective) {
      button.disabled = false;
      button.title = '';
      continue;
    }
    const mismatch = target !== effective;
    button.disabled = mismatch && !allow;
    button.title = mismatch
      ? allow
        ? `Inhalt bleibt ${effective.toUpperCase()}, nur die Endung wird umbenannt.`
        : effective === 'ttf'
          ? 'Enthält TrueType-Outlines; eine echte OTF-Konvertierung ist nicht möglich.'
          : 'Enthält CFF-Outlines; eine echte TTF-Konvertierung ist nicht möglich.'
      : '';
  }
}

function makeDownloadButtons(family, variant, source) {
  const actions = el('div', 'file-actions');
  for (const target of ['ttf', 'otf', 'woff']) {
    const button = el('button', 'pill', target.toUpperCase());
    button.type = 'button';
    button.dataset.target = target;
    button.addEventListener('click', () => downloadSource(family, variant, source, target, button));
    actions.append(button);
  }
  return actions;
}

async function downloadSource(family, variant, source, target, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '…';

  try {
    const { bytes } = await loadFontFile(source.url);
    const result = await exportFont(bytes, target, {
      allowMismatchedExtension: state.settings.allowMismatchedExtension,
    });
    const ext = result.renamed ? target : result.kind;
    const filename = fileNameFor({
      family: family.family,
      weight: variant.weight,
      style: variant.style,
      subset: subsetLabel(variant.unicodeRange),
      ext,
    });
    downloadBytes(result.data, filename, mimeFor(result.kind));
    button.textContent = 'Gespeichert';
    setTimeout(() => {
      button.textContent = original;
      updateButtons(button.parentElement);
    }, 1200);
  } catch (error) {
    console.error(error);
    button.textContent = error.code === 'FORMAT_MISMATCH' ? 'Format' : 'Fehler';
    if (error.code === 'FORMAT_MISMATCH') updateButtons(button.parentElement, error.kind);
    setTimeout(() => {
      button.textContent = original;
      updateButtons(button.parentElement);
    }, 1500);
  }
}

function createFileRow(family, variant, source) {
  const row = el('div', 'file');
  const meta = el('div', 'file-meta');
  meta.append(el('span', 'file-title', `${variant.weight} · ${variant.style}`));
  const sub = el('span', 'file-sub', `${formatLabel(source)} · ${variant.unicodeRange || 'alle Zeichen'}`);
  meta.append(sub);
  row.append(meta);

  const actions = makeDownloadButtons(family, variant, source);
  row.append(actions);

  let loaded = false;
  async function ensure() {
    if (loaded) return;
    loaded = true;
    sub.classList.remove('error');
    try {
      const { bytes, kind } = await loadFontFile(source.url);
      sub.textContent = `${formatLabel(source)} · ${formatBytes(bytes.length)}${variant.isDefault ? ' · Standard' : ''}`;
      updateButtons(actions, kind);
    } catch (error) {
      loaded = false;
      sub.textContent = `Nicht ladbar${error.status ? ` (HTTP ${error.status})` : ''}`;
      sub.classList.add('error');
      for (const button of actions.querySelectorAll('[data-target]')) button.disabled = true;

      const retry = el('button', 'pill', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', () => {
        retry.remove();
        forgetFontFile(source.url);
        ensure();
      });
      actions.append(retry);
    }
  }

  return { row, ensure };
}

function createCard(family) {
  const card = el('article', 'card');
  card.dataset.family = family.key;

  const head = el('div', 'card-head');
  head.append(el('h2', 'family', family.family));
  const badges = el('div', 'badges');
  if (family.isSystem) {
    badges.append(el('span', 'badge system', 'System'));
  } else if (!family.available) {
    badges.append(el('span', 'badge warn', 'Keine Quelle'));
  } else {
    const count = family.variants.length;
    badges.append(el('span', 'badge', `${count} ${count === 1 ? 'Datei' : 'Dateien'}`));
  }
  head.append(badges);
  card.append(head);

  const meta = [];
  if (family.weightsUsed.length) meta.push(family.weightsUsed.join(' · '));
  if (family.usedChars) meta.push(`${numberFormat.format(family.usedChars)} Zeichen`);
  else if (!family.isSystem) meta.push('nicht genutzt');
  if (meta.length) card.append(el('p', 'meta', meta.join(' · ')));

  const preview = el('div', 'preview', state.settings?.previewText || '');
  card.append(preview);

  const defaultVariant = family.variants.find((variant) => variant.isDefault) || family.variants[0];
  const defaultSource = preferredSource(defaultVariant);

  const actions = el('div', 'actions');
  card.append(actions);

  if (defaultSource) {
    card.dataset.defaultUrl = defaultSource.url;
    for (const target of ['ttf', 'otf', 'woff']) {
      const button = el('button', 'pill', target.toUpperCase());
      button.type = 'button';
      button.dataset.target = target;
      button.addEventListener('click', () =>
        downloadSource(family, defaultVariant, defaultSource, target, button),
      );
      actions.append(button);
    }
  }

  if (family.variants.length) {
    const details = el('details', 'files');
    const count = family.variants.length;
    details.append(el('summary', null, `${count} ${count === 1 ? 'Datei' : 'Dateien'} anzeigen`));

    const loaders = [];
    for (const variant of family.variants) {
      for (const source of variant.sources) {
        const { row, ensure } = createFileRow(family, variant, source);
        loaders.push(ensure);
        details.append(row);
      }
    }

    details.addEventListener('toggle', () => {
      if (details.open) loaders.forEach((ensure) => ensure());
    });
    card.append(details);
  }

  return card;
}

function renderUnassigned() {
  const items = state.model?.unassigned || [];
  els.unassigned.hidden = items.length === 0;
  els.unassignedList.textContent = '';

  for (const item of items) {
    const row = el('div', 'file');
    const meta = el('div', 'file-meta');
    meta.append(el('span', 'file-title', item.name));
    const sub = el('span', 'file-sub', item.url);
    sub.title = item.url;
    meta.append(sub);
    row.append(meta);

    const actions = el('div', 'file-actions');
    const button = el('button', 'pill', 'Laden');
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = '…';
      try {
        const bytes = await fetchBytes(item.url);
        downloadBytes(bytes, item.name);
        button.textContent = 'Gespeichert';
      } catch (error) {
        console.error(error);
        button.textContent = 'Fehler';
      }
      setTimeout(() => {
        button.textContent = 'Laden';
        button.disabled = false;
      }, 1400);
    });
    actions.append(button);
    row.append(actions);
    els.unassignedList.append(row);
  }
}

function renderEmpty(families) {
  if (state.loading) {
    els.empty.hidden = true;
    return;
  }
  if (state.error) {
    els.empty.hidden = false;
    els.empty.textContent =
      'Auf dieser Seite nicht verfügbar. Öffne eine normale Website (kein chrome://, Add-on-Store oder PDF).';
    return;
  }
  if (!state.model) {
    els.empty.hidden = true;
    return;
  }
  if (!state.model.families.length) {
    els.empty.hidden = false;
    els.empty.textContent = 'Keine Fonts auf dieser Seite gefunden.';
    return;
  }
  if (!families.length) {
    els.empty.hidden = false;
    els.empty.textContent = state.query
      ? `Kein Treffer für „${state.query}“.`
      : 'Keine Fonts für diesen Filter.';
    return;
  }
  els.empty.hidden = true;
}

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const card = entry.target.closest('.card');
      const url = card?.dataset.defaultUrl;
      if (url) loadPreview(card, url);
    }
  },
  { root: els.list, rootMargin: '120px' },
);

async function loadPreview(card, url) {
  const preview = card.querySelector('.preview');
  try {
    const { bytes, kind } = await loadFontFile(url);
    let name = state.previewNames.get(url);
    if (!name) {
      name = await registerPreview(bytes);
      state.previewNames.set(url, name);
    }
    preview.style.fontFamily = `"${name}", sans-serif`;
    updateButtons(card.querySelector('.actions'), kind);
  } catch (error) {
    console.error(error);
    preview.title = 'Vorschau nicht verfügbar';
    preview.classList.add('preview-failed');
    const badges = card.querySelector('.badges');
    if (badges && !badges.querySelector('.preview-warn')) {
      badges.append(el('span', 'badge warn preview-warn', 'Vorschau n. v.'));
    }
  }
}

function render() {
  els.status.textContent = statusText();
  els.list.textContent = '';
  els.reload.disabled = state.loading;

  const families = visibleFamilies();
  for (const family of families) {
    const card = createCard(family);
    els.list.append(card);
    const preview = card.querySelector('.preview');
    if (preview && card.dataset.defaultUrl) observer.observe(preview);
  }

  renderEmpty(families);
  renderUnassigned();

  const hasDownloadable = (state.model?.families || []).some((family) => family.available);
  els.zipButton.disabled = !hasDownloadable || state.loading || Boolean(state.error);
}

async function load() {
  state.loading = true;
  state.error = null;
  state.model = null;
  render();

  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error('NO_TAB');
    els.site.textContent = hostOf(tab.url || '');
    els.site.title = tab.title || '';

    const { model, analysis } = await analyzeTab(tab.id);
    state.model = model;
    state.analysis = analysis;
    els.site.textContent = hostOf(analysis.url || tab.url || '');
    els.site.title = analysis.title || tab.title || '';
  } catch (error) {
    console.error(error);
    state.error = error;
  } finally {
    state.loading = false;
    render();
  }
}

function setFilter(filter) {
  state.filter = filter;
  for (const chip of els.filters.querySelectorAll('.chip')) {
    chip.classList.toggle('active', chip.dataset.filter === filter);
  }
  render();
}

let searchTimer = null;
els.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = els.search.value;
    render();
  }, 150);
});

els.filters.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (chip) setFilter(chip.dataset.filter);
});

els.reload.addEventListener('click', load);

els.settings.addEventListener('click', () => {
  els.settingsPanel.hidden = !els.settingsPanel.hidden;
});

els.allowMismatch.addEventListener('change', async () => {
  state.settings.allowMismatchedExtension = els.allowMismatch.checked;
  await saveSettings({ allowMismatchedExtension: els.allowMismatch.checked });
  for (const container of document.querySelectorAll('.actions, .file-actions')) {
    updateButtons(container);
  }
});

let previewTimer = null;
els.previewText.addEventListener('input', () => {
  const value = els.previewText.value;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    state.settings.previewText = value;
    for (const preview of document.querySelectorAll('.preview')) preview.textContent = value;
    await saveSettings({ previewText: value });
  }, 300);
});

els.zipButton.addEventListener('click', async () => {
  if (!state.model) return;
  const key = `export:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    model: state.model,
    format: els.zipFormat.value,
    host: hostOf(state.analysis?.url || ''),
  };
  const original = els.zipButton.textContent;
  els.zipButton.disabled = true;

  try {
    await api.storage.local.set({ [key]: payload });
    await api.tabs.create({
      url: `${api.runtime.getURL('export.html')}?key=${encodeURIComponent(key)}`,
    });
  } catch (error) {
    console.error(error);
    els.zipButton.textContent = 'Fehler';
    setTimeout(() => {
      els.zipButton.textContent = original;
    }, 1500);
  } finally {
    els.zipButton.disabled = !(state.model?.families || []).some((family) => family.available);
  }
});

async function init() {
  state.settings = await loadSettings();
  els.previewText.value = state.settings.previewText;
  els.allowMismatch.checked = state.settings.allowMismatchedExtension;
  await load();
}

init();
