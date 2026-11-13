export const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
  '-apple-system',
  'blinkmacsystemfont',
]);

function maskNonStructure(css) {
  const chars = css.split('');
  let i = 0;
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      for (let j = i; j < stop; j++) chars[j] = ' ';
      i = stop;
    } else if (css[i] === '"' || css[i] === "'") {
      const quote = css[i];
      let j = i + 1;
      while (j < css.length) {
        if (css[j] === '\\') {
          j += 2;
          continue;
        }
        if (css[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      for (let k = i + 1; k < j - 1; k++) chars[k] = ' ';
      i = j;
    } else {
      i++;
    }
  }
  return chars.join('');
}

function splitTopLevel(text, separator) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (quote) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(text.slice(start));
  return parts;
}

function unquote(value) {
  let s = String(value ?? '').trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) s = s.slice(1, -1);
  }
  return s.trim();
}

function findBlocks(css, masked, name) {
  const re = new RegExp(`@${name}\\b`, 'gi');
  const blocks = [];
  let match;
  while ((match = re.exec(masked))) {
    let i = match.index + match[0].length;
    while (i < masked.length && masked[i] !== '{' && masked[i] !== ';') i++;
    if (masked[i] !== '{') continue;

    let depth = 0;
    let j = i;
    for (; j < masked.length; j++) {
      if (masked[j] === '{') depth++;
      else if (masked[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;
    blocks.push({ body: css.slice(i + 1, j), start: match.index, end: j + 1 });
    re.lastIndex = j + 1;
  }
  return blocks;
}

function declarations(body) {
  const map = new Map();
  for (const part of splitTopLevel(body, ';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (prop) map.set(prop, value);
  }
  return map;
}

function normalizeWeight(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return '400';
  if (s === 'normal') return '400';
  if (s === 'bold') return '700';
  return s;
}

function parseSources(value, baseUrl) {
  const sources = [];
  for (const part of splitTopLevel(value, ',')) {
    const trimmed = part.trim();
    if (!trimmed || /^local\s*\(/i.test(trimmed)) continue;
    const match = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)\s*([\s\S]*)$/i.exec(trimmed);
    if (!match) continue;
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!raw) continue;

    let url;
    try {
      url = new URL(raw, baseUrl).href;
    } catch {
      continue;
    }
    if (!/^(https?:|data:|chrome-extension:|moz-extension:)/i.test(url)) continue;

    const rest = match[4] || '';
    const formatMatch = /format\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/i.exec(rest);
    const format = formatMatch
      ? (formatMatch[1] ?? formatMatch[2] ?? formatMatch[3] ?? '').trim().toLowerCase()
      : null;

    sources.push({ url, format });
  }
  return sources;
}

export function normalizeFamily(name) {
  return unquote(name).replace(/\s+/g, ' ').trim().toLowerCase();
}

export function parseFontStack(stack) {
  const families = [];
  for (const part of splitTopLevel(String(stack ?? ''), ',')) {
    const family = unquote(part).replace(/\s+/g, ' ').trim();
    if (!family) continue;
    if (GENERIC_FAMILIES.has(family.toLowerCase())) continue;
    families.push(family);
  }
  return families;
}

export function extractFontFaces(css, baseUrl) {
  const masked = maskNonStructure(css);
  const rules = [];

  for (const block of findBlocks(css, masked, 'font-face')) {
    const decl = declarations(block.body);
    const family = unquote(decl.get('font-family'));
    if (!family) continue;
    const sources = parseSources(decl.get('src') || '', baseUrl);
    rules.push({
      family,
      familyKey: normalizeFamily(family),
      weight: normalizeWeight(decl.get('font-weight')),
      style: (decl.get('font-style') || 'normal').trim().toLowerCase(),
      stretch: (decl.get('font-stretch') || 'normal').trim().toLowerCase(),
      display: (decl.get('font-display') || 'auto').trim().toLowerCase(),
      unicodeRange: decl.get('unicode-range')?.trim() || null,
      sources,
    });
  }

  return rules;
}

export function extractImports(css, baseUrl) {
  const masked = maskNonStructure(css);
  const urls = [];
  const re = /@import\b/gi;
  let match;

  while ((match = re.exec(masked))) {
    let i = match.index + match[0].length;
    let depth = 0;
    let j = i;
    for (; j < masked.length; j++) {
      const c = masked[j];
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (c === ';' && depth === 0) break;
    }
    const value = css.slice(i, j).trim();
    const urlMatch = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/i.exec(value);
    let raw = null;
    if (urlMatch) raw = (urlMatch[1] ?? urlMatch[2] ?? urlMatch[3] ?? '').trim();
    else {
      const quoteMatch = /^(["'])([\s\S]*?)\1/.exec(value);
      if (quoteMatch) raw = quoteMatch[2].trim();
    }

    if (raw) {
      try {
        urls.push(new URL(raw, baseUrl).href);
      } catch {
        // ignore malformed import
      }
    }
    re.lastIndex = j;
  }

  return urls;
}
