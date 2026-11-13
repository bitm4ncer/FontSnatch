import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileNameFor } from '../src/lib/format.js';

test('jeder Dateinamensteil wird bereinigt (Zip-Slip, Leerzeichen)', () => {
  const name = fileNameFor({
    family: 'Evil',
    weight: '../../evil',
    style: '/../x',
    subset: 'a b',
    ext: 'ttf',
  });
  assert.equal(name.includes('..'), false);
  assert.equal(name.includes('/'), false);
  assert.equal(name, 'Evil-evil-x-a-b.ttf');
});

test('variable Gewichtsbereiche werden zu einem sicheren Namen', () => {
  const name = fileNameFor({ family: 'Var', weight: '100 900', style: 'normal', ext: 'woff' });
  assert.equal(name, 'Var-100-900-normal.woff');
});
