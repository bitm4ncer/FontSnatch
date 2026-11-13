import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, collectRules } from '../src/lib/resolve.js';

const rule = (family, weight, style, url, unicodeRange = null) => ({
  family, familyKey: family.toLowerCase(), weight, style, stretch: 'normal',
  display: 'auto', unicodeRange, sources: [{ url, format: 'woff2' }],
});

const analysis = (used, resourceFonts = []) => ({
  url: 'https://site.test/', title: 't',
  used, fontFaces: [], resourceFonts, truncated: false,
});

test('gruppiert Varianten und Subsets einer Familie', () => {
  const model = buildModel(
    analysis([{ stack: '"Universal", sans-serif', elements: 3, chars: 120,
      byWeightStyle: { '400|normal': { elements: 3, chars: 120 } } }]),
    [
      rule('Universal', '400', 'normal', 'https://site.test/u400-latin.woff2', 'U+0000-00FF'),
      rule('Universal', '400', 'normal', 'https://site.test/u400-cyr.woff2', 'U+0400-045F'),
      rule('Universal', '500', 'normal', 'https://site.test/u500.woff2'),
    ],
  );
  assert.equal(model.families.length, 1);
  const f = model.families[0];
  assert.equal(f.family, 'Universal');
  assert.equal(f.available, true);
  assert.deepEqual(f.weightsUsed, ['400', '500']);
  const latin = f.variants.find((v) => v.unicodeRange === 'U+0000-00FF');
  assert.equal(latin.isDefault, true);
  assert.equal(f.variants.find((v) => v.unicodeRange === 'U+0400-045F').isDefault, false);
});

test('System-Fonts und webfonts ohne Regel werden unterschieden', () => {
  const model = buildModel(
    analysis([{ stack: 'Arial, sans-serif', elements: 1, chars: 10, byWeightStyle: {} }]),
    [],
  );
  assert.equal(model.families[0].isSystem, true);
  assert.equal(model.families[0].available, false);
});

test('ungenutzte @font-face-Regeln nur mit includeUnused', () => {
  const rules = [rule('Icons', '400', 'normal', 'https://site.test/i.woff2')];
  assert.equal(buildModel(analysis([]), rules).families.length, 0);
  assert.equal(buildModel(analysis([]), rules, { includeUnused: true }).families.length, 1);
});

test('nicht lesbares CSS: Familie bleibt, Datei wird unassigned', () => {
  const a = analysis(
    [{ stack: '"Mystery Sans", sans-serif', elements: 2, chars: 40, byWeightStyle: {} }],
    ['https://cdn.test/fonts/mystery-400.woff2'],
  );
  a.fontFaces = [{ family: 'Mystery Sans', weight: '400', style: 'normal', status: 'loaded' }];
  const model = buildModel(a, []);
  assert.equal(model.families[0].isSystem, false);
  assert.equal(model.families[0].available, false);
  assert.deepEqual(model.unassigned.map((u) => u.name), ['mystery-400.woff2']);
});

test('collectRules folgt Imports und meldet Fehler', async () => {
  const css = '@import url(/more.css); @font-face{font-family:X;src:url(/x.woff2) format("woff2")}';
  const result = await collectRules(
    [{ href: 'https://site.test/a.css', cssText: css }],
    async (url) => (url.endsWith('/more.css') ? '@font-face{font-family:Y;src:url(/y.woff2)}' : null),
  );
  assert.equal(result.failed, 0);
  assert.deepEqual(result.rules.map((r) => r.family).sort(), ['X', 'Y']);
});
