import { getActiveTab, loadSettings } from './lib/browser.js';
import { analyzeTab } from './lib/pipeline.js';

const numberFormat = new Intl.NumberFormat('de-DE');

const state = {
  model: null,
  analysis: null,
  filter: 'used',
  query: '',
  settings: null,
  loading: false,
  error: null,
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

function createFileRow(variant) {
  const row = el('div', 'file');
  const meta = el('div', 'file-meta');
  meta.append(el('span', 'file-title', `${variant.weight} · ${variant.style}`));
  const sub = [];
  if (variant.isDefault) sub.push('Standard');
  sub.push(variant.unicodeRange || 'alle Zeichen');
  meta.append(el('span', 'file-sub', sub.join(' · ')));
  row.append(meta);
  row.append(el('div', 'file-actions'));
  return row;
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

  card.append(el('div', 'actions'));

  if (family.variants.length) {
    const details = el('details', 'files');
    const count = family.variants.length;
    details.append(el('summary', null, `${count} ${count === 1 ? 'Datei' : 'Dateien'} anzeigen`));
    for (const variant of family.variants) details.append(createFileRow(variant));
    card.append(details);
  }

  return card;
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

function render() {
  els.status.textContent = statusText();
  els.list.textContent = '';
  els.reload.disabled = state.loading;

  const families = visibleFamilies();
  for (const family of families) els.list.append(createCard(family));

  renderEmpty(families);

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

async function init() {
  state.settings = await loadSettings();
  els.previewText.value = state.settings.previewText;
  els.allowMismatch.checked = state.settings.allowMismatchedExtension;
  await load();
}

init();
