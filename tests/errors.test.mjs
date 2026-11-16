import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from '../src/lib/errors.js';

test('translates HTTP 404 into a clear message', () => {
  const error = Object.assign(new Error('FONT_FETCH_FAILED:404'), {
    code: 'FONT_FETCH_FAILED',
    status: 404,
  });
  assert.equal(describeError(error), 'File missing on server (HTTP 404)');
});

test('distinguishes other HTTP errors and unsupported formats', () => {
  assert.equal(
    describeError(Object.assign(new Error('x'), { code: 'FONT_FETCH_FAILED', status: 403 })),
    'Download failed (HTTP 403)',
  );
  assert.equal(
    describeError(Object.assign(new Error('x'), { code: 'UNSUPPORTED_FORMAT' })),
    'Unsupported format (EOT/SVG/TTC)',
  );
});
