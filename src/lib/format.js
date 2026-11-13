const numberFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return `${bytes} B`;
  return `${numberFormat.format(bytes / 1024)} KB`;
}

export function sanitizeFamily(name) {
  const cleaned = String(name ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'font';
}

export function fileNameFor({ family, weight = '400', style = 'normal', subset = null, ext }) {
  return [sanitizeFamily(family), weight, style, subset]
    .filter((part) => part !== null && part !== undefined && part !== '')
    .join('-') + `.${ext}`;
}

export function mimeFor(kind) {
  if (kind === 'ttf') return 'font/ttf';
  if (kind === 'otf') return 'font/otf';
  if (kind === 'woff') return 'font/woff';
  return 'application/octet-stream';
}
