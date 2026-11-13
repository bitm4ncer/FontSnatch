import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFontFaces, extractImports, normalizeFamily, parseFontStack } from '../src/lib/css-fonts.js';

test('wählt Netzwerk-URL, ignoriert local()', () => {
  const css = `@font-face{font-family:"Universal";font-weight:400;font-style:normal;
    src:local("Universal"),url(/fonts/u.woff2) format("woff2"),url("/fonts/u.woff") format("woff");}`;
  const [rule] = extractFontFaces(css, 'https://x.test/assets/site.css');
  assert.equal(rule.family, 'Universal');
  assert.equal(rule.weight, '400');
  assert.deepEqual(rule.sources.map((s) => s.format), ['woff2', 'woff']);
  assert.deepEqual(rule.sources.map((s) => s.url), [
    'https://x.test/fonts/u.woff2', 'https://x.test/fonts/u.woff',
  ]);
});

test('normalisiert Familiennamen und Font-Stacks', () => {
  assert.equal(normalizeFamily('  "Universal"  '), 'universal');
  assert.equal(normalizeFamily("'Noto   Sans'"), 'noto sans');
  assert.deepEqual(parseFontStack('"Helvetica Neue", Helvetica, Arial, sans-serif'), ['Helvetica Neue', 'Helvetica', 'Arial']);
  assert.deepEqual(parseFontStack('system-ui, -apple-system, sans-serif'), []);
});

test('ignoriert @font-face in Kommentaren und Strings', () => {
  const css = `/* @font-face{font-family:Boese;src:url(/b.woff2)} */
    .x::before{content:"@font-face{font-family:AuchBoese}"}`;
  assert.equal(extractFontFaces(css, 'https://x.test/a.css').length, 0);
});

test('liest @import in url()- und String-Form', () => {
  const css = `@import url("/a.css"); @import "https://fonts.googleapis.com/css2?family=Roboto";`;
  assert.deepEqual(extractImports(css, 'https://x.test/css/site.css'), [
    'https://x.test/a.css', 'https://fonts.googleapis.com/css2?family=Roboto',
  ]);
});

test('erhält unicode-range und mehrere Subsets', () => {
  const css = `@font-face{font-family:Roboto;font-weight:400;unicode-range:U+0000-00FF;
      src:url(https://f.test/latin.woff2) format("woff2");}
    @font-face{font-family:Roboto;font-weight:400;unicode-range:U+0400-045F;
      src:url(https://f.test/cyr.woff2) format("woff2");}`;
  const rules = extractFontFaces(css, 'https://x.test/');
  assert.equal(rules.length, 2);
  assert.equal(rules[0].unicodeRange, 'U+0000-00FF');
});
