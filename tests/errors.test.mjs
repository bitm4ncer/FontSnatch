import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from '../src/lib/errors.js';

test('übersetzt HTTP-404 in eine verständliche Meldung', () => {
  const error = Object.assign(new Error('FONT_FETCH_FAILED:404'), {
    code: 'FONT_FETCH_FAILED',
    status: 404,
  });
  assert.equal(describeError(error), 'Datei fehlt auf dem Server (HTTP 404)');
});

test('unterscheidet andere HTTP-Fehler und Formate', () => {
  assert.equal(
    describeError(Object.assign(new Error('x'), { code: 'FONT_FETCH_FAILED', status: 403 })),
    'Download fehlgeschlagen (HTTP 403)',
  );
  assert.equal(
    describeError(Object.assign(new Error('x'), { code: 'UNSUPPORTED_FORMAT' })),
    'Format nicht unterstützt (EOT/SVG/TTC)',
  );
});
