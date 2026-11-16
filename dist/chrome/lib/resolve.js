import { extractFontFaces, extractImports, normalizeFamily, parseFontStack } from './css-fonts.js';

function rangeCoversA(range) {
  if (!range) return true;
  for (const part of range.split(',')) {
    const match = /^\s*U\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?\s*$/i.exec(part);
    if (!match) continue;
    const startRaw = match[1];
    if (startRaw.includes('?')) {
      const pattern = new RegExp(`^${startRaw.replace(/\?/g, '[0-9a-f]')}$`, 'i');
      if (pattern.test('41')) return true;
      continue;
    }
    const start = Number.parseInt(startRaw, 16);
    const end = match[2] ? Number.parseInt(match[2], 16) : start;
    if (start <= 0x41 && 0x41 <= end) return true;
  }
  return false;
}

const weightNumber = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 400;
};

function buildVariants(rules) {
  const groups = new Map();
  for (const rule of rules) {
    for (const source of rule.sources) {
      const key = `${rule.weight}|${rule.style}|${rule.unicodeRange || ''}`;
      let variant = groups.get(key);
      if (!variant) {
        groups.set(
          key,
          (variant = {
            weight: rule.weight,
            style: rule.style,
            unicodeRange: rule.unicodeRange || null,
            isDefault: false,
            sources: [],
          }),
        );
      }
      if (!variant.sources.some((entry) => entry.url === source.url)) {
        variant.sources.push({ url: source.url, format: source.format });
      }
    }
  }
  return [...groups.values()];
}

function pickDefault(variants, weightUsage) {
  if (!variants.length) return;
  let targetWeight = '400';
  let bestUsage = -1;
  for (const [weight, chars] of weightUsage) {
    if (chars > bestUsage) {
      bestUsage = chars;
      targetWeight = weight;
    }
  }
  if (!weightUsage.size) {
    targetWeight = variants.some((v) => v.weight === '400') ? '400' : variants[0].weight;
  }

  let best = null;
  let bestScore = null;
  for (const variant of variants) {
    const chars = variant.weight === targetWeight ? weightUsage.get(variant.weight) || 0 : 0;
    const score = [
      chars,
      rangeCoversA(variant.unicodeRange) ? 1 : 0,
      -Math.abs(weightNumber(variant.weight) - weightNumber(targetWeight)),
    ];
    if (!bestScore || compareScore(score, bestScore) > 0) {
      bestScore = score;
      best = variant;
    }
  }
  if (best) best.isDefault = true;
}

function compareScore(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function sortWeights(weights) {
  return [...weights].sort((a, b) => {
    const diff = weightNumber(a) - weightNumber(b);
    return diff !== 0 ? diff : String(a).localeCompare(String(b));
  });
}

export async function collectRules(sheets, loadCss) {
  const rules = [];
  const seenSheets = new Set();
  let failed = 0;

  async function visit(url, cssText, depth) {
    let css = cssText;
    const base = url || 'about:blank';

    if (css == null) {
      if (!url) return;
      if (seenSheets.has(url)) return;
      seenSheets.add(url);
      try {
        css = await loadCss(url);
      } catch {
        css = null;
      }
      if (css == null) {
        failed++;
        return;
      }
    }

    rules.push(...extractFontFaces(css, base));
    if (depth >= 2) return;

    for (const imp of extractImports(css, base)) {
      if (seenSheets.has(imp)) continue;
      await visit(imp, null, depth + 1);
    }
  }

  for (const sheet of sheets || []) {
    await visit(sheet.href, sheet.cssText, 0);
  }

  const unique = [];
  const keys = new Set();
  for (const rule of rules) {
    const key = [
      rule.familyKey,
      rule.weight,
      rule.style,
      rule.unicodeRange || '',
      rule.sources.map((source) => source.url).join(','),
    ].join('|');
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(rule);
  }

  return { rules: unique, failed };
}

export function buildModel(analysis, rules, opts = {}) {
  const used = analysis.used || [];
  const faces = analysis.fontFaces || [];
  const ruleGroups = new Map();

  for (const rule of rules || []) {
    let list = ruleGroups.get(rule.familyKey);
    if (!list) ruleGroups.set(rule.familyKey, (list = []));
    list.push(rule);
  }

  const usedFamilies = new Map();
  for (const entry of used) {
    const families = parseFontStack(entry.stack);
    if (!families.length) continue;
    const family = families[0];
    const key = normalizeFamily(family);
    let record = usedFamilies.get(key);
    if (!record) {
      usedFamilies.set(
        key,
        (record = { family, key, usedChars: 0, usedElements: 0, weights: new Map() }),
      );
    }
    record.usedChars += entry.chars || 0;
    record.usedElements += entry.elements || 0;
    for (const [weightStyle, counts] of Object.entries(entry.byWeightStyle || {})) {
      const prev = record.weights.get(weightStyle) || { chars: 0, elements: 0 };
      record.weights.set(weightStyle, {
        chars: prev.chars + (counts.chars || 0),
        elements: prev.elements + (counts.elements || 0),
      });
    }
  }

  const families = [];

  for (const [key, record] of usedFamilies) {
    const familyRules = ruleGroups.get(key) || [];
    const variants = buildVariants(familyRules);
    const weightUsage = new Map();
    for (const [weightStyle, counts] of record.weights) {
      const weight = weightStyle.split('|')[0];
      weightUsage.set(weight, (weightUsage.get(weight) || 0) + (counts.chars || 0));
    }
    pickDefault(variants, weightUsage);
    const hasFace = faces.some((face) => normalizeFamily(face.family) === key);

    families.push({
      family: record.family,
      key,
      isSystem: familyRules.length === 0 && !hasFace,
      available: variants.length > 0,
      usedChars: record.usedChars,
      usedElements: record.usedElements,
      weightsUsed: sortWeights(
        new Set([...weightUsage.keys(), ...variants.map((variant) => variant.weight)]),
      ),
      variants,
    });
  }

  if (opts.includeUnused) {
    for (const [key, familyRules] of ruleGroups) {
      if (usedFamilies.has(key)) continue;
      const variants = buildVariants(familyRules);
      if (!variants.length) continue;
      pickDefault(variants, new Map());
      families.push({
        family: familyRules[0].family,
        key,
        isSystem: false,
        available: true,
        usedChars: 0,
        usedElements: 0,
        weightsUsed: sortWeights(variants.map((variant) => variant.weight)),
        variants,
      });
    }
  }

  families.sort((a, b) => b.usedChars - a.usedChars || a.family.localeCompare(b.family));

  const known = new Set();
  for (const rule of rules || []) {
    for (const source of rule.sources) known.add(source.url);
  }
  const unassigned = [];
  const seenUnassigned = new Set();
  for (const url of analysis.resourceFonts || []) {
    if (known.has(url) || seenUnassigned.has(url)) continue;
    seenUnassigned.add(url);
    let name = url.split('/').pop().split('?')[0];
    try {
      name = decodeURIComponent(name);
    } catch {
      // keep encoded name
    }
    unassigned.push({ url, name: name || url });
  }

  return {
    families,
    unassigned,
    stats: {
      sheetsTotal: opts.sheetsTotal ?? (analysis.sheets ? analysis.sheets.length : 0),
      sheetsFailed: opts.sheetsFailed ?? 0,
      truncated: Boolean(analysis.truncated),
    },
  };
}
