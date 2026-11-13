import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

test('build erzeugt beide Distributionen mit gültigem Manifest', () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: process.cwd() });
  for (const target of ['chrome', 'firefox']) {
    const dir = `dist/${target}`;
    assert.ok(existsSync(`${dir}/popup.html`), `${dir}/popup.html fehlt`);
    const m = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
    assert.equal(m.manifest_version, 3);
    assert.equal(m.action.default_popup, 'popup.html');
    assert.deepEqual(m.permissions, ['activeTab', 'scripting', 'storage']);
    assert.deepEqual(m.host_permissions, ['<all_urls>']);
    assert.ok(m.content_security_policy.extension_pages.includes("'wasm-unsafe-eval'"));
    if (target === 'firefox') {
      assert.equal(m.browser_specific_settings.gecko.id, 'fontsnatch@local');
      assert.ok(!('background' in m));
    }
  }
  assert.ok(!existsSync('dist/chrome/manifest.chrome.json'));
  assert.ok(existsSync('dist/chrome/icons/icon128.png'));
});

test('icons haben 128x128 Pixel und PNG-Signatur', () => {
  const png = readFileSync('src/icons/icon128.png');
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(png.readUInt32BE(16), 128);
  assert.equal(png.readUInt32BE(20), 128);
});
