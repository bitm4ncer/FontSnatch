const SUBSET_NAMES = [
  ['U+0000-00FF', 'latin'],
  ['U+0400-045F', 'cyrillic'],
  ['U+0370-03FF', 'greek'],
  ['U+0600-06FF', 'arabic'],
  ['U+0900-097F', 'devanagari'],
  ['U+3040-30FF', 'japanese'],
  ['U+4E00-9FFF', 'cjk'],
  ['U+AC00-D7AF', 'korean'],
];

export function formatLabel(source) {
  if (source.format) return source.format;
  const ext = source.url.split('?')[0].split('.').pop().toLowerCase();
  return ['woff2', 'woff', 'ttf', 'otf'].includes(ext) ? ext : 'font';
}

export function subsetLabel(range) {
  if (!range) return null;
  for (const [needle, name] of SUBSET_NAMES) {
    if (range.toLowerCase().includes(needle.toLowerCase())) return name;
  }
  return null;
}

export function preferredSource(variant) {
  if (!variant?.sources.length) return null;
  const rank = (source) => {
    const format = (source.format || formatLabel(source)).toLowerCase();
    if (format === 'woff2') return 0;
    if (format === 'woff') return 1;
    if (format === 'truetype' || format === 'ttf') return 2;
    if (format === 'opentype' || format === 'otf') return 3;
    return 4;
  };
  return [...variant.sources].sort((a, b) => rank(a) - rank(b))[0];
}
