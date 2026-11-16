const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return `${bytes} B`;
  return `${numberFormat.format(bytes / 1024)} KB`;
}

export function sanitizePart(value) {
  const cleaned = String(value ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned;
}

export function sanitizeFamily(name) {
  return sanitizePart(name) || 'font';
}

export function safeFileName(name) {
  const segments = String(name ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[\u0000-\u001f]/g, ''))
    .filter(Boolean);
  return segments.join('/').replace(/^\/+/, '') || 'font';
}

export function fileNameFor({ family, weight = '400', style = 'normal', subset = null, ext = 'ttf' }) {
  const parts = [sanitizeFamily(family), weight, style, subset]
    .filter((part) => part !== null && part !== undefined && part !== '')
    .map((part) => sanitizePart(part))
    .filter(Boolean);
  return `${parts.join('-')}.${sanitizePart(ext) || 'bin'}`;
}

export function mimeFor(kind) {
  if (kind === 'ttf') return 'font/ttf';
  if (kind === 'otf') return 'font/otf';
  if (kind === 'woff') return 'font/woff';
  return 'application/octet-stream';
}
