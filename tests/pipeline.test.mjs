import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPipeline } from '../src/lib/pipeline.js';

test('Pipeline verbindet Analyse, CSS-Laden und Modell', async () => {
  const fakeAnalysis = {
    url: 'https://site.test/', title: 'Test', truncated: false,
    used: [{ stack: 'Universal, sans-serif', elements: 2, chars: 50,
      byWeightStyle: { '400|normal': { elements: 2, chars: 50 } } }],
    fontFaces: [], resourceFonts: [],
    sheets: [{ href: 'https://site.test/a.css', cssText: '@font-face{font-family:Universal;src:url(/u.woff2)}' }],
  };
  const { model } = await buildPipeline({
    analyze: async () => fakeAnalysis,
    loadCss: async () => null,
  });
  assert.equal(model.families[0].family, 'Universal');
  assert.equal(model.families[0].variants[0].sources[0].url, 'https://site.test/u.woff2');
});
