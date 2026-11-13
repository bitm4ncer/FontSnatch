import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planExport } from '../src/lib/export-plan.js';

const variant = (weight, style, url) => ({
  weight,
  style,
  unicodeRange: null,
  isDefault: weight === '400' && style === 'normal',
  sources: [{ url, format: 'woff2' }],
});

const model = {
  families: [
    {
      family: 'Universal',
      key: 'universal',
      available: true,
      variants: [
        variant('400', 'normal', 'https://site.test/u400.woff2'),
        variant('400', 'italic', 'https://site.test/u400i.woff2'),
        variant('500', 'normal', 'https://site.test/u500.woff2'),
        variant('500', 'italic', 'https://site.test/u500i.woff2'),
      ],
    },
    { family: 'System', key: 'system', available: false, variants: [] },
  ],
};

test('plant jede Variante einer Familie, nicht nur den Standard-Schnitt', () => {
  const plans = planExport(model, 'native');
  assert.equal(plans.length, 4);
  assert.deepEqual(plans.map((plan) => `${plan.variant.weight}-${plan.variant.style}`), [
    '400-normal', '400-italic', '500-normal', '500-italic',
  ]);
  assert.ok(plans.every((plan) => plan.family.family === 'Universal'));
});

test('plant WOFF-Ziel und ordnet Quellen nach Format', () => {
  const variantMixed = {
    weight: '400',
    style: 'normal',
    unicodeRange: null,
    isDefault: true,
    sources: [
      { url: 'https://site.test/u.woff', format: 'woff' },
      { url: 'https://site.test/u.woff2', format: 'woff2' },
    ],
  };
  const plans = planExport(
    { families: [{ family: 'X', key: 'x', available: true, variants: [variantMixed] }] },
    'woff',
  );
  assert.equal(plans.length, 1);
  assert.equal(plans[0].target, 'woff');
  assert.equal(plans[0].sources[0].url, 'https://site.test/u.woff2');
});
