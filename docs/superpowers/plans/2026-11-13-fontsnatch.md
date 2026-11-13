# FontSnatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Chrome-/Firefox-Extension, die alle Fonts der aktuellen Seite auflistet, sie in echter Schrift zeigt und als TTF, OTF oder WOFF herunterlädt.

**Architecture:** Popup-Extension ohne Background-Script. Eine injizierte, selbstständige Funktion sammelt Font-Stacks und Stylesheets; das Popup lädt fremde CSS nach, parst `@font-face`, baut daraus ein Fontmodell und lädt Dateien direkt (Host-Permission). Konvertierung läuft in reinem JS: WOFF über `DecompressionStream`, WOFF2 über einen vendorten Emscripten-Decoder. Sammeldownload erzeugt ein ZIP in einem eigenen Export-Tab.

**Tech Stack:** Vanilla JavaScript (ES-Module, keine Abhängigkeiten), WebExtensions MV3, Node 22 (nur Build/Tests), `node --test`, `CompressionStream`/`DecompressionStream`, vendorter Google-WOFF2-Decoder (MIT, als klassisches Script, gepatcht).

**Spec:** `docs/superpowers/specs/2026-11-13-fontsnatch-design.md`

## Global Constraints

- Zwei Manifeste: `manifest.chrome.json` und `manifest.firefox.json`; Firefox `strict_min_version: "109.0"`, `browser_specific_settings.gecko.id: "fontsnatch@local"`. Kein `background`-Eintrag.
- Permissions exakt: `["activeTab", "scripting", "storage"]`, `host_permissions: ["<all_urls>"]`, `content_security_policy.extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"`.
- Keine Laufzeit-Abhängigkeiten, kein Bundler, kein npm-Paket im Produktcode. Node ≥ 22 nur für Build und Tests.
- ES-Module in `src/`, einzige Ausnahme: `src/lib/woff2-decoder.js` ist ein klassisches Script und darf kein `new Function` enthalten.
- UI-Texte deutsch, Code-Bezeichner englisch.
- Niemals `innerHTML`, `outerHTML` oder `insertAdjacentHTML` mit seitenstämmigen Strings. Nur `createElement` + `textContent`.
- Keine Font-Binaries aus `C:\Windows\Fonts` oder von der Testseite committen; Tests lesen sie zur Laufzeit.
- Kommerzielle Fonts nur zum Testen laden, nie ins Repo.
- Downloads ausschließlich über Blob-URL + `<a download>`; kein `downloads`-Permission.
- Commits klein und konventionell (`feat:`, `test:`, `docs:`, `chore:`).

## Review Focus

Diese Fälle sind wahrscheinlich und von keinem Spec-Satz abgedeckt; jeder bekommt unten einen Test in der zuständigen Task.

1. `@font-face` mit `local(...)` vor mehreren `url()`-Quellen: der Download muss die Netzwerk-URL nehmen, nie den lokalen Namen. (Task 5)
2. Familiennamen mit Anführungszeichen, mehrfachem Leerraum oder Unicode: `"Universal"`, `Universal ` und `universal` müssen dieselbe Familie treffen. (Task 5/6)
3. Nicht lesbares Cross-Origin-CSS: Familien müssen trotzdem aus den berechneten Styles erscheinen, Dateien wenigstens als „nicht zugeordnet". (Task 6)
4. WOFF2 mit transformierten `glyf`/`hmtx`-Tabellen (Google Fonts): Ergebnis muss ein vollständiges, installierbares sfnt sein. (Task 4)
5. CFF- vs. TrueType-Outlines: `OTTO` darf nur OTF freischalten, `glyf` nur TTF; falsche Endung wird ohne Opt-in verweigert. (Task 8)
6. Zwei Familien mit gleichem Dateinamen im ZIP: nichts darf überschrieben werden. (Task 11)

---

### Task 1: Projektgerüst, Icons, Build

**Files:**
- Create: `src/manifest.chrome.json`, `src/manifest.firefox.json`
- Create: `src/popup.html`, `src/popup.css`, `src/popup.js` (leeres Gerüst)
- Create: `scripts/build.mjs`, `scripts/make-icons.mjs`
- Create: `src/icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` (generiert)
- Create: `.gitignore`, `README.md`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Produces: `node scripts/build.mjs` erzeugt `dist/chrome/` und `dist/firefox/`, jeweils mit `manifest.json` (aus dem passenden Manifest) und allen Dateien aus `src/`.
- Produces: `scripts/make-icons.mjs` schreibt vier PNGs (RGBA, quadratisch) nach `src/icons/`.

- [ ] **Step 1: Test für den Build schreiben**

```js
// tests/build.test.mjs
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
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `node --test tests/build.test.mjs`
Expected: FAIL (`scripts/build.mjs` bzw. `dist/` fehlt).

- [ ] **Step 3: Manifeste, Gerüst, Build und Icon-Generator schreiben**

`src/manifest.chrome.json`: `name: "FontSnatch"`, `version: "1.0.0"`, `description: "Alle Fonts der aktuellen Seite anzeigen und als TTF, OTF oder WOFF speichern."`, `permissions`, `host_permissions`, CSP wie oben, `action.default_popup: "popup.html"`, `icons` 16/32/48/128, `minimum_chrome_version: "103"`.
`src/manifest.firefox.json`: identisch plus `browser_specific_settings` (Gecko-ID, `strict_min_version: "109.0"`) und ohne `minimum_chrome_version`.

`scripts/build.mjs`: `dist/` rekursiv löschen, `src/` nach `dist/<target>` kopieren, `manifest.<target>.json` als `manifest.json` schreiben, beide `.json`-Quellen nicht mitkopieren, danach prüfen, dass `popup.html`, `popup.js`, `icons/icon128.png`, `manifest.json` existieren; bei Fehler `process.exit(1)` mit Meldung. Ausgabe: `built chrome, firefox`.

`scripts/make-icons.mjs`: quadratisches RGBA-Raster mit 4×4-Supersampling, Hintergrund `#141414` mit 22 % Radius, weißes „A" aus drei Linienzügen, darunter orange (`#ff5a1f`) Download-Pfeil. PNG selbst kodieren: `zlib.deflateSync` über gefilterte Scanlines (Filter 0), CRC32, IHDR/IDAT/IEND. Aufruf über `node scripts/make-icons.mjs`.

`src/popup.js` vorerst: `document.getElementById('status').textContent = 'bereit';`
`src/popup.html`: Grundgerüst mit `<div id="status"></div>` und `<script type="module" src="popup.js"></script>`.
`src/popup.css`: leer bis Task 9.

`.gitignore`: `dist/`, `node_modules/`, `*.zip`, `.DS_Store`.
`README.md`: Titel, Ein-Satz-Beschreibung, Status „in Arbeit"; Ausbau in Task 12.

Icons einmalig erzeugen: `node scripts/make-icons.mjs` (die PNGs werden committet, damit der Build ohne Generator läuft).

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test tests/build.test.mjs`
Expected: PASS (2 Tests).

- [ ] **Step 5: Commit**

```bash
git add src scripts tests .gitignore README.md
git commit -m "chore: project scaffold, manifests and build"
```

---

### Task 2: sfnt lesen, schreiben, erkennen

**Files:**
- Create: `src/lib/sfnt.js`
- Test: `tests/sfnt.test.mjs`, `tests/helpers.mjs`

**Interfaces:**
- Produces:
  - `readSfnt(bytes: Uint8Array) → { flavor: number, numTables: number, tables: Array<{ tag: string, offset: number, length: number, checksum: number, data: Uint8Array }> }`
  - `writeSfnt(flavor: number, tables: Array<{ tag: string, data: Uint8Array }>) → Uint8Array`
  - `tableChecksum(data: Uint8Array) → number`
  - `sfntKind(flavor: number) → 'ttf' | 'otf' | 'collection' | 'unknown'`
  - `sniffContainer(bytes: Uint8Array) → 'woff' | 'woff2' | 'ttf' | 'otf' | 'collection' | 'unknown'`

- [ ] **Step 1: Tests schreiben**

`tests/helpers.mjs`:

```js
import { readFileSync, existsSync } from 'node:fs';

const CANDIDATES = ['arial.ttf', 'segoeui.ttf', 'calibri.ttf', 'AGENCYR.TTF'];
export function systemSfnt() {
  for (const name of CANDIDATES) {
    const p = `C:/Windows/Fonts/${name}`;
    if (existsSync(p)) return readFileSync(p);
  }
  return null;
}

export function systemCff() {
  const p = 'C:/Windows/Fonts/ABCDiatypeRounded-Black.otf';
  return existsSync(p) ? readFileSync(p) : null;
}
```

`tests/sfnt.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSfnt, writeSfnt, sfntKind, sniffContainer } from '../src/lib/sfnt.js';
import { systemSfnt, systemCff } from './helpers.mjs';

const zeroHead = (data) => {
  const copy = new Uint8Array(data);
  copy.fill(0, 8, 12); // checkSumAdjustment
  return copy;
};

test('readSfnt liest echte TTF-Tabellen', (t) => {
  const bytes = systemSfnt();
  if (!bytes) return t.skip('keine System-TTF');
  const font = readSfnt(bytes);
  assert.equal(sfntKind(font.flavor), 'ttf');
  const tags = font.tables.map((x) => x.tag);
  for (const tag of ['cmap', 'head', 'hhea', 'hmtx', 'maxp']) assert.ok(tags.includes(tag), tag);
});

test('writeSfnt erhält alle Tabelleninhalte', (t) => {
  const bytes = systemSfnt();
  if (!bytes) return t.skip('keine System-TTF');
  const font = readSfnt(bytes);
  const rebuilt = writeSfnt(font.flavor, font.tables.map(({ tag, data }) => ({ tag, data })));
  const again = readSfnt(rebuilt);
  assert.deepEqual(again.tables.map((x) => x.tag), font.tables.map((x) => x.tag));
  for (const table of font.tables) {
    const other = again.tables.find((x) => x.tag === table.tag);
    assert.deepEqual(other.data, table.tag === 'head' ? zeroHead(table.data) : table.data);
  }
});

test('sniffContainer und sfntKind erkennen alle Container', (t) => {
  const ttf = systemSfnt();
  if (!ttf) return t.skip('keine System-TTF');
  assert.equal(sniffContainer(ttf), 'ttf');
  assert.equal(sfntKind(0x4f54544f), 'otf');
  assert.equal(sfntKind(0x74746366), 'collection');
  assert.equal(sniffContainer(new Uint8Array([0x77, 0x4f, 0x46, 0x32])), 'woff2');
  assert.equal(sniffContainer(new Uint8Array([0x77, 0x4f, 0x46, 0x46])), 'woff');
  const cff = systemCff();
  if (cff) assert.equal(sniffContainer(cff), 'otf');
});
```

Der Testhelfer `zeroHead` ist im Test zu implementieren (Offset 8 innerhalb der head-Tabelle ist `checkSumAdjustment`).

- [ ] **Step 2: Test laufen lassen**

Run: `node --test tests/sfnt.test.mjs`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: `src/lib/sfnt.js` implementieren**

Header: 12 Bytes (`flavor`, `numTables`, `searchRange`, `entrySelector`, `rangeShift`); Directory 16 Bytes je Tabelle, sortiert nach Tag. `writeSfnt` berechnet Checksummen neu, setzt `checkSumAdjustment` in `head` auf 0, baut die Datei, summiert alle 32-Bit-Wörter und schreibt `0xB1B0AFBA - sum` an die Stelle des Feldes. Tabellen auf 4 Bytes padden. `readSfnt` gibt `data` als Subarray-View zurück.

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test tests/sfnt.test.mjs`
Expected: PASS (ggf. 3 Tests mit Skips).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sfnt.js tests
git commit -m "feat: sfnt reader/writer with checksums"
```

---

### Task 3: WOFF lesen und schreiben

**Files:**
- Create: `src/lib/woff.js`
- Test: `tests/woff.test.mjs`

**Interfaces:**
- Consumes: `readSfnt`, `writeSfnt` aus `src/lib/sfnt.js`.
- Produces: `woffToSfnt(bytes: Uint8Array) → Promise<Uint8Array>`, `sfntToWoff(bytes: Uint8Array) → Promise<Uint8Array>`.

- [ ] **Step 1: Tests schreiben**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { woffToSfnt, sfntToWoff } from '../src/lib/woff.js';
import { readSfnt, writeSfnt } from '../src/lib/sfnt.js';
import { systemSfnt } from './helpers.mjs';

test('sfnt -> woff -> sfnt erhält alle Tabellen', async (t) => {
  const bytes = systemSfnt();
  if (!bytes) return t.skip('keine System-TTF');
  const woff = await sfntToWoff(bytes);
  assert.equal(woff.subarray(0, 4).toString('ascii'), 'wOFF');
  assert.equal(woff.readUInt32BE(8), woff.length);
  assert.equal(woff.readUInt16BE(12), readSfnt(bytes).numTables);
  const back = await woffToSfnt(woff);
  const a = readSfnt(bytes), b = readSfnt(back);
  assert.deepEqual(b.tables.map((x) => x.tag), a.tables.map((x) => x.tag));
  for (const table of a.tables) {
    const other = b.tables.find((x) => x.tag === table.tag);
    if (table.tag === 'head') {
      assert.deepEqual(other.data.subarray(8), table.data.subarray(8));
    } else {
      assert.deepEqual(other.data, table.data);
    }
  }
});

test('komprimierbare Tabellen werden kleiner gespeichert', async () => {
  const tables = [
    { tag: 'AAAA', data: new Uint8Array(4000).fill(65) },
    { tag: 'BBBB', data: new Uint8Array([1, 2, 3, 4]) },
  ];
  const sfnt = writeSfnt(0x00010000, tables);
  const woff = await sfntToWoff(sfnt);
  assert.ok(woff.length < sfnt.length + 400);
  const back = readSfnt(await woffToSfnt(woff));
  assert.deepEqual(back.tables.find((x) => x.tag === 'AAAA').data, tables[0].data);
});
```

- [ ] **Step 2: Test laufen lassen**

Run: `node --test tests/woff.test.mjs`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: `src/lib/woff.js` implementieren**

Header 44 Bytes, Directory 20 Bytes je Eintrag. Beim Lesen `signature`, `length`, `numTables` und `totalSfntSize` validieren; Tabelle nur dekomprimieren, wenn `compLength < origLength`, sonst roh übernehmen; `origLength` prüfen. Schreiben mit `CompressionStream('deflate')`, Ergebnis nur verwenden, wenn kürzer; `totalSfntSize` ist die Länge des mit `writeSfnt` erzeugten sfnt. Helfer: `deflate(bytes)`, `inflate(bytes)` über `Response(stream).arrayBuffer()`.

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test tests/woff.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/woff.js tests/woff.test.mjs
git commit -m "feat: woff encoder and decoder"
```

---

### Task 4: WOFF2-Decoder vendorn

**Files:**
- Create: `src/lib/woff2-decoder.js` (vendort und gepatcht)
- Create: `src/lib/woff2-license.txt`
- Create: `src/lib/woff2.js`
- Test: `tests/woff2.test.mjs`

**Interfaces:**
- Produces: `woff2ToSfnt(bytes: Uint8Array) → Promise<Uint8Array>` (Browser-Loader) und `decodeWith(mod, bytes: Uint8Array) → Uint8Array` (pure Dekodierung, in Tests und vom Loader genutzt).
- Das Script definiert nach dem Laden `globalThis.Module.decompress(Uint8Array)` und ruft `Module.onRuntimeInitialized` auf.

- [ ] **Step 1: Test schreiben**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { decodeWith } from '../src/lib/woff2.js';
import { readSfnt } from '../src/lib/sfnt.js';

const require = createRequire(import.meta.url);
const decoder = require('../src/lib/woff2-decoder.js');
const ready = new Promise((resolve) => { decoder.onRuntimeInitialized = resolve; });

test('vendorter Decoder enthält kein new Function (MV3-CSP)', () => {
  const src = readFileSync('src/lib/woff2-decoder.js', 'utf8');
  assert.ok(!/new\s+Function/.test(src));
});

test('dekodiert echte Google-Fonts-WOFF2-Datei', async (t) => {
  let bytes;
  try {
    const res = await fetch('https://www.dandad.org/fonts/universal-400.woff2');
    if (!res.ok) throw new Error(String(res.status));
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return t.skip('Testseite nicht erreichbar');
  }
  await ready;
  const sfnt = decodeWith(decoder, bytes);
  assert.ok(sfnt.length > 50000);
  const font = readSfnt(sfnt);
  assert.equal(font.flavor, 0x00010000);
  const tags = font.tables.map((x) => x.tag);
  for (const tag of ['glyf', 'head', 'hmtx', 'cmap']) assert.ok(tags.includes(tag), tag);
});
```

- [ ] **Step 2: Test laufen lassen**

Run: `node --test tests/woff2.test.mjs`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: Decoder beschaffen, patchen, Loader schreiben**

`npm pack wawoff2@2.0.1` in ein Temporärverzeichnis, `package/build/decompress_binding.js` nach `src/lib/woff2-decoder.js` kopieren, Lizenz nach `src/lib/woff2-license.txt`.

Patch: `createNamedFunction` ersetzt `new Function(...)` durch eine normale Funktion mit `Object.defineProperty(f, "name", …)` in `try/catch`. Sicherstellen, dass `new Function` danach nirgends mehr vorkommt.

`src/lib/woff2.js`:

```js
let ready = null;
function loadDecoder() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    if (globalThis.Module?.decompress && globalThis.Module.calledRun) return resolve(globalThis.Module);
    globalThis.Module = { onRuntimeInitialized: () => resolve(globalThis.Module) };
    const script = document.createElement('script');
    script.src = new URL('woff2-decoder.js', import.meta.url).href;
    script.onerror = () => reject(new Error('WOFF2-Decoder konnte nicht geladen werden'));
    document.head.append(script);
  });
  return ready;
}

export function decodeWith(mod, bytes) {
  if (bytes[0] !== 0x77 || bytes[1] !== 0x4f || bytes[2] !== 0x46 || bytes[3] !== 0x32) {
    throw new Error('NOT_WOFF2');
  }
  const out = mod.decompress(bytes);
  if (out === false) throw new Error('WOFF2_DECODE_FAILED');
  return new Uint8Array(out.buffer ?? out, out.byteOffset ?? 0, out.length);
}

export async function woff2ToSfnt(bytes) {
  return decodeWith(await loadDecoder(), bytes);
}
```

Der Node-Test umgeht nur den Browser-Loader (`document` existiert dort nicht) und ruft `decodeWith` mit dem per `createRequire` geladenen Modul auf; der Loader selbst wird im manuellen Browser-Test in Task 12 geprüft.

Bei `Module.decompress(...) === false` Fehler `WOFF2_DECODE_FAILED` werfen. Timeout 15 s.

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test tests/woff2.test.mjs`
Expected: PASS (WOFF2-Test läuft mit Netz; sonst Skip).

- [ ] **Step 5: Commit**

```bash
git add src/lib/woff2-decoder.js src/lib/woff2.js src/lib/woff2-license.txt tests/woff2.test.mjs
git commit -m "feat: vendor patched woff2 decoder"
```

---

### Task 5: CSS-Font-Parser

**Files:**
- Create: `src/lib/css-fonts.js`
- Test: `tests/css-fonts.test.mjs`

**Interfaces:**
- Produces:
  - `normalizeFamily(name) → string` (Anführungszeichen weg, Whitespace kollabieren, lowercase)
  - `parseFontStack(stack) → string[]` (Reihenfolge, Generics entfernt)
  - `extractImports(css, baseUrl) → string[]`
  - `extractFontFaces(css, baseUrl) → Array<{ family, familyKey, weight, style, stretch, display, unicodeRange, sources: Array<{ url, format }> }>`
  - `GENERIC_FAMILIES: Set<string>`

- [ ] **Step 1: Tests schreiben**

```js
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
```

- [ ] **Step 2: Test laufen lassen**

Run: `node --test tests/css-fonts.test.mjs`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: `src/lib/css-fonts.js` implementieren**

Scanner, der Kommentare und Strings korrekt überspringt und `@font-face`-Blöcke mit balancierten Klammern liest. `src` an Top-Level-Kommas splitten, `url(...)` mit und ohne Quotes sowie `format(...)`/`tech(...)` tolerieren. Relative URLs gegen `baseUrl` mit `new URL(...)` auflösen (Fehler → Quelle verwerfen). `parseFontStack` mit Kommas außerhalb von Quotes; Generics (`serif`, `sans-serif`, `monospace`, `cursive`, `fantasy`, `system-ui`, `ui-sans-serif`, `emoji`, `math`, `fangsong` und `-apple-system`, `BlinkMacSystemFont`) entfernen; leere Strings verwerfen.

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test tests/css-fonts.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/css-fonts.js tests/css-fonts.test.mjs
git commit -m "feat: tolerant css font-face parser"
```

---

### Task 6: Fontmodell aufbauen

**Files:**
- Create: `src/lib/resolve.js`
- Test: `tests/resolve.test.mjs`

**Interfaces:**
- Consumes: `normalizeFamily`, `parseFontStack`, `extractFontFaces`, `extractImports`.
- Produces:
  - `collectRules(sheets, loadCss) → Promise<{ rules, failed }>`; `sheets: Array<{ href: string|null, cssText: string|null }>`, `loadCss: (url) => Promise<string|null>`, Imports bis Tiefe 2.
  - `buildModel(analysis, rules, opts = { includeUnused: false }) → model`.

```js
model = {
  families: [{
    family, key, isSystem, available, usedChars, usedElements,
    weightsUsed: ['400', '500'],
    variants: [{ weight, style, unicodeRange, isDefault,
      sources: [{ url, format }] }],
  }],
  unassigned: [{ url, name }],
  stats: { sheetsTotal, sheetsFailed, truncated },
}
```

- [ ] **Step 1: Tests schreiben**

```js
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
  const rules = await collectRules(
    [{ href: 'https://site.test/a.css', cssText: css }],
    async (url) => (url.endsWith('/more.css') ? '@font-face{font-family:Y;src:url(/y.woff2)}' : null),
  );
  assert.equal(rules.failed, 0);
  assert.deepEqual(rules.rules.map((r) => r.family).sort(), ['X', 'Y']);
});
```

- [ ] **Step 2: Test laufen lassen**

Run: `node --test tests/resolve.test.mjs`
Expected: FAIL.

- [ ] **Step 3: `src/lib/resolve.js` implementieren**

`collectRules`: jede Sheet mit Text parsen, `cssText === null` über `loadCss(href)` nachladen, Imports rekursiv bis Tiefe 2, Duplikate über `familyKey|weight|style|url` entfernen, Fehlschläge zählen.
`buildModel`: Stacks parsen, erste Familie je Stack, Zählungen über gleiche Familien summieren, `weightsUsed` sortiert numerisch. Regeln nach `familyKey` gruppieren. `isSystem = keine Regel && keine passende FontFace in analysis.fontFaces`. `available = variants.length > 0`. Default-Variante: `unicodeRange` enthält `U+0041` bzw. `U+0000-00FF`, sonst die erste ohne Range, sonst die erste. `unassigned` = Resource-URLs, die in keiner Regel vorkommen; Name aus dem letzten Pfadsegment, URL-dekodiert.

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test tests/resolve.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/resolve.js tests/resolve.test.mjs
git commit -m "feat: build font model from page data"
```

---

### Task 7: Seitenanalyse, Browser-Helfer, Pipeline

**Files:**
- Create: `src/lib/analyze.js`
- Create: `src/lib/browser.js`
- Create: `src/lib/pipeline.js`
- Modify: `src/popup.js` (Statuszeile zeigt Anzahl Familien)
- Test: `tests/pipeline.test.mjs`

**Interfaces:**
- Produces:
  - `analyzePage() → { url, title, used, sheets, fontFaces, resourceFonts, truncated }` — **vollständig selbstständig**, keine Referenzen außerhalb des Funktionskörpers.
  - `getActiveTab() → Promise<{ id, url, title }>`
  - `runInTab(tabId, func) → Promise<any>`
  - `fetchBytes(url) → Promise<Uint8Array>`
  - `downloadBytes(bytes, filename, mime) → void`
  - `loadSettings() / saveSettings(patch)`
  - `analyzeTab(tabId) → Promise<{ model, analysis }>`

- [ ] **Step 1: Test für die Pipeline schreiben**

```js
// tests/pipeline.test.mjs
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
```

- [ ] **Step 2: Test laufen lassen**

Run: `node --test tests/pipeline.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Module implementieren**

`analyze.js`: TreeWalker über Textknoten, pro Element `getComputedStyle`, Stack und `fontWeight`/`fontStyle` zählen, Skip bei `display:none`, `visibility:hidden`, Vorfahren `hidden`, `SCRIPT`, `STYLE`, `TEMPLATE`, `NOSCRIPT`, `TEXTAREA`. Budget: 10 000 Elemente oder 150 ms (`performance.now()`), dann `truncated = true`. `document.styleSheets` in `{href, cssText}` umwandeln: `sheet.cssRules` in `try/catch`, `Array.from(rules).map(r => r.cssText).join('\n')`. `document.fonts` in `{family, weight, style, status}`. Resource-Entries mit `.woff2/.woff/.ttf/.otf` (Query-String abschneiden).

`browser.js`: `const api = globalThis.browser ?? globalThis.chrome`; `runInTab` nutzt `api.scripting.executeScript({ target: { tabId }, func, args: [] })` und gibt `results[0].result` zurück. `fetchBytes` prüft `res.ok` und wirft `FONT_FETCH_FAILED` mit Status. `downloadBytes` erzeugt Blob, Anchor, `click()`, URL nach 10 s freigeben. Settings-Defaults: `{ previewText: 'The quick brown fox jumps over the lazy dog', allowMismatchedExtension: false }`.

`pipeline.js`: `buildPipeline({ analyze, loadCss })` exportieren (testbar); `analyzeTab(tabId)` ruft `buildPipeline` mit echten Implementierungen auf: `analyze = () => runInTab(tabId, analyzePage)`, `loadCss = (url) => fetch(url).then(r => r.ok ? r.text() : null)`; `collectRules(analysis.sheets, loadCss)`; `buildModel(analysis, rules, { includeUnused: true })`.

`popup.js`: Tab holen, `analyzeTab`, Statuszeile `„<n> Familien gefunden"`; Fehler als Text anzeigen.

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test tests/pipeline.test.mjs`
Expected: PASS.

- [ ] **Step 5: Manuell prüfen (Chrome)**

`node scripts/build.mjs`, `dist/chrome` in `chrome://extensions` laden, <https://www.dandad.org/> öffnen, Popup: Statuszeile zeigt „1 Familien gefunden" (oder mehr, falls System-Fonts mitzählen). Konsole ohne Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/lib src/popup.js tests/pipeline.test.mjs
git commit -m "feat: page analysis pipeline"
```

---

### Task 8: Konvertierung und Export

**Files:**
- Create: `src/lib/format.js`
- Create: `src/lib/convert.js`
- Test: `tests/convert.test.mjs`, `tests/format.test.mjs`

**Interfaces:**
- Consumes: `sniffContainer`, `readSfnt` aus `sfnt.js`, `woffToSfnt`/`sfntToWoff`, `woff2ToSfnt`.
- Produces:
  - `toSfnt(bytes) → Promise<{ sfnt: Uint8Array, kind: 'ttf'|'otf' }>`
  - `exportFont(bytes, target, opts) → Promise<{ data: Uint8Array, kind: 'ttf'|'otf'|'woff', renamed: boolean }>`
  - `formatBytes(n) → string`
  - `sanitizeFamily(name) → string`
  - `fileNameFor({ family, weight, style, subset, ext }) → string`
  - `mimeFor(kind) → string`

- [ ] **Step 1: Tests schreiben**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportFont, toSfnt } from '../src/lib/convert.js';
import { fileNameFor, formatBytes, sanitizeFamily } from '../src/lib/format.js';
import { systemSfnt, systemCff } from './helpers.mjs';

test('TTF bleibt TTF, OTF bleibt OTF', async (t) => {
  const ttf = systemSfnt();
  if (!ttf) return t.skip('keine System-TTF');
  const a = await toSfnt(new Uint8Array(ttf));
  assert.equal(a.kind, 'ttf');
  const b = await exportFont(new Uint8Array(ttf), 'ttf');
  assert.equal(b.kind, 'ttf');
  const cff = systemCff();
  if (cff) {
    const c = await toSfnt(new Uint8Array(cff));
    assert.equal(c.kind, 'otf');
    assert.equal((await exportFont(new Uint8Array(cff), 'otf')).kind, 'otf');
  }
});

test('falsche Endung wird ohne Opt-in verweigert', async (t) => {
  const ttf = systemSfnt();
  if (!ttf) return t.skip('keine System-TTF');
  await assert.rejects(() => exportFont(new Uint8Array(ttf), 'otf'), /FORMAT_MISMATCH/);
  const forced = await exportFont(new Uint8Array(ttf), 'otf', { allowMismatchedExtension: true });
  assert.equal(forced.renamed, true);
});

test('WOFF-Export liefert wOFF', async (t) => {
  const ttf = systemSfnt();
  if (!ttf) return t.skip('keine System-TTF');
  const woff = await exportFont(new Uint8Array(ttf), 'woff');
  assert.equal(Buffer.from(woff.data.subarray(0, 4)).toString('ascii'), 'wOFF');
  assert.equal(woff.kind, 'woff');
});

test('Dateinamen und Größen', () => {
  assert.equal(sanitizeFamily('  Noto Sans / Display '), 'Noto-Sans-Display');
  assert.equal(fileNameFor({ family: 'Noto Sans', weight: '400', style: 'italic', subset: 'latin', ext: 'woff2' }), 'Noto-Sans-400-italic-latin.woff2');
  assert.equal(fileNameFor({ family: 'X', weight: '400', style: 'normal', subset: null, ext: 'ttf' }), 'X-400-normal.ttf');
  assert.equal(formatBytes(22636), '22,1 KB');
});
```

- [ ] **Step 2: Tests laufen lassen**

Run: `node --test tests/convert.test.mjs tests/format.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Module implementieren**

`toSfnt`: `sniffContainer` → `woff` → `woffToSfnt`, `woff2` → `woff2ToSfnt`, `ttf`/`otf` → unverändert, sonst Fehler `UNSUPPORTED_FORMAT`. `exportFont`: Ziel `woff` → `sfntToWoff`; Ziel `ttf`/`otf` → `toSfnt`, bei abweichendem `kind` und ohne Opt-in Fehler mit Code `FORMAT_MISMATCH` und `err.kind`, sonst Bytes unverändert mit `renamed: true`.
`format.js`: `Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })`; `sanitizeFamily` ersetzt Nicht-`[A-Za-z0-9._-]` durch `-`, kollabiert Wiederholungen, trimmt `-`; `fileNameFor` baut die Teile mit `-` und hängt `.${ext}` an; `mimeFor` liefert `font/ttf`, `font/otf`, `font/woff`.

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test tests/convert.test.mjs tests/format.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/convert.js src/lib/format.js tests
git commit -m "feat: font conversion and export naming"
```

---

### Task 9: Popup — Liste, Filter, Suche

**Files:**
- Modify: `src/popup.html`, `src/popup.css`, `src/popup.js`

**Interfaces:**
- Consumes: `analyzeTab`, `buildModel`-Ergebnis, `formatBytes`, `fileNameFor`.
- Produces: DOM-Gerüst mit stabilen IDs: `#status`, `#search`, `#filters`, `#font-list`, `#empty`, `#preview-text`, `#settings`, `#zip-format`, `#zip-button`.

- [ ] **Step 1: HTML/CSS-Gerüst ersetzen**

Struktur (IDs exakt): Kopfzeile mit `#site` und `#reload`; Filterleiste `#filters` mit drei Buttons (`data-filter="used|all|downloadable"`); `#search` (type=search); `#preview-text`; scrollbare `#font-list`; `#empty`; Footer mit Lizenzhinweis, `#settings` (Zahnrad), `#zip-format` (select: `native`, `woff`) und `#zip-button`.

CSS: Breite 400 px, `max-height: 600px`, `display:flex; flex-direction:column`, Liste `overflow:auto`, Karten mit 1 px Rahmen, `color-scheme: light dark`, `@media (prefers-color-scheme: dark)` mit eigenen Variablen. Keine externen Fonts.

- [ ] **Step 2: Rendering implementieren**

`render()` erzeugt Karten aus `state.model.families`. Filter:
- `used`: alle Familien mit `usedChars > 0`
- `all`: alle Familien inkl. `includeUnused`-Modell (beim Laden einmal mit `includeUnused: true` bauen)
- `downloadable`: nur `available === true`

Suche: case-insensitive Substring auf `family`, debounced 150 ms. Karte enthält Familienname, Badges (Variante, `System`), Meta-Zeile (`400 · 500 · 2 431 Zeichen`), Platzhalter für Vorschau und Buttons sowie ein `<details>` mit einer Zeile pro Variante (Weight, Style, `unicode-range` oder „latin", Dateigröße sobald geladen, Buttons aus Task 10). `#empty` zeigt je nach Lage „Keine Fonts gefunden" oder den Fehlertext. Unter der Liste erscheint bei `model.unassigned.length > 0` der Abschnitt „Nicht zugeordnete Dateien" mit je einer Zeile (Dateiname aus der URL, vollständige URL als `title`). Alle Textknoten über `textContent`.

- [ ] **Step 3: Manuell prüfen**

`node scripts/build.mjs`, Extension neu laden, dandad.org: vier Dateien unter „Universal" sichtbar, Filter wechseln, Suche „uni" filtert, „Arial" erscheint grau als System-Font (sofern auf der Seite genutzt). Keine Konsolenfehler.

- [ ] **Step 4: Commit**

```bash
git add src/popup.html src/popup.css src/popup.js
git commit -m "feat: popup font list with filters and search"
```

---

### Task 10: Vorschau, Downloads, Einstellungen

**Files:**
- Modify: `src/popup.js`, `src/popup.css`, `src/popup.html`
- Create: `src/lib/preview.js`

**Interfaces:**
- Produces:
  - `loadFontFile(url) → Promise<{ bytes: Uint8Array, kind: 'ttf'|'otf' }>` (Cache pro Popup-Lebensdauer)
  - `registerPreview(bytes) → Promise<string>` liefert einen eindeutigen CSS-Familiennamen `__fns_<n>`.
  - Karten-Buttons `TTF`, `OTF`, `WOFF` mit `data-target`.

- [ ] **Step 1: `src/lib/preview.js` implementieren**

`loadFontFile`: `fetchBytes` + `toSfnt`, Ergebnis in einer `Map` cachen; Fehler mit `err.code` weiterreichen.
`registerPreview`: `new FontFace(name, bytes.buffer.slice(...))`, `await face.load()`, `document.fonts.add(face)`, Name zurückgeben.

- [ ] **Step 2: Vorschau und Buttons in die Karten einbauen**

Pro Karte `IntersectionObserver` (root = `#font-list`, `rootMargin: '100px'`): beim Sichtbarwerden Default-Variante laden, `kind` an der Karte vermerken, Vorschau-Div mit `font-family: <name>` und dem Text aus `#preview-text` füllen, Größe der Datei anzeigen. Fehler: Vorschau bleibt System-Font, Badge „Vorschau nicht verfügbar", Buttons bleiben nutzbar.

Buttons: das zum `kind` passende Format aktiv, das falsche deaktiviert mit `title`-Erklärung („Enthält TrueType-Outlines; echte OTF-Konvertierung nicht möglich."); `WOFF` bleibt immer aktiv. Klick: `exportFont`, dann `downloadBytes(data, fileNameFor(...), mimeFor(exported.kind))`, danach kurzes „Gespeichert"-Feedback am Button.

Dateizeilen im `<details>`: beim Aufklappen jede Quelle einmal laden (`loadFontFile`), dann `kind`, Größe und Format-Badge anzeigen und dieselben drei Buttons pro Zeile rendern. Schlägt der Fetch fehl, erscheint die Fehlermeldung („Nicht ladbar (HTTP 403)") mit `Retry`-Button, der den Cache-Eintrag verwirft und neu lädt; die übrigen Zeilen bleiben nutzbar. Für `model.unassigned` dieselbe Zeilenbehandlung mit reinem Download ohne Formatwahl (Originaldatei).

`#preview-text`-Änderung (debounced 300 ms) aktualisiert alle Vorschauen und wird in `storage.local` gespeichert. Zahnrad öffnet ein `#settings-panel` mit Checkbox „Falsche Dateiendung erlauben (Inhalt bleibt unverändert)".

- [ ] **Step 3: Manuell prüfen**

dandad.org: Vorschau zeigt „Universal" in der echten Schrift; TTF herunterladen, Datei in Windows installieren (Doppelklick → „Installieren") und Namen prüfen; WOFF herunterladen und in `demo/index.html` (Task 12) per `@font-face` laden; OTF-Button ist deaktiviert und erklärt sich. Auf einer Seite mit Google Fonts (z. B. <https://fonts.google.com/specimen/Roboto>) erscheint die Familie mit korrekter Vorschau.

- [ ] **Step 4: Commit**

```bash
git add src/lib/preview.js src/popup.js src/popup.css src/popup.html
git commit -m "feat: live preview and downloads"
```

---

### Task 11: ZIP und Export-Tab

**Files:**
- Create: `src/lib/zip.js`
- Create: `src/export.html`, `src/export.js`
- Modify: `src/popup.js` (`#zip-button`)
- Test: `tests/zip.test.mjs`

**Interfaces:**
- Produces:
  - `createZip(entries: Array<{ name: string, data: Uint8Array }>) → Uint8Array`
  - `crc32(data: Uint8Array) → number`
  - Popup: `#zip-button` schreibt `{ model, format, host }` unter einem Schlüssel `export:<uuid>` nach `storage.local` und öffnet `export.html?key=<uuid>`.
  - `export.html` liest den Eintrag, löscht ihn, zeigt Fortschritt und lädt `fontsnatch-<host>-<YYYY-MM-DD>.zip`.

- [ ] **Step 1: ZIP-Test schreiben**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZip, crc32 } from '../src/lib/zip.js';

test('ZIP hat lokale Header, zentrale Verzeichnisse und CRC', () => {
  const zip = createZip([
    { name: 'a.txt', data: new TextEncoder().encode('hallo') },
    { name: 'ordner/b.bin', data: new Uint8Array([1, 2, 3]) },
  ]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  assert.equal(zip.readUInt16LE(eocd + 10), 2);
  assert.equal(crc32(new TextEncoder().encode('hallo')), 0xb97231d1);
});

test('doppelte Namen werden eindeutig gemacht', () => {
  const zip = createZip([
    { name: 'x.ttf', data: new Uint8Array([1]) },
    { name: 'x.ttf', data: new Uint8Array([2]) },
  ]);
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 2);
  const names = new TextDecoder().decode(zip).match(/x(-\d+)?\.ttf/g);
  assert.deepEqual([...new Set(names)], ['x.ttf', 'x-2.ttf']);
});
```

- [ ] **Step 2: Test laufen lassen**

Run: `node --test tests/zip.test.mjs`
Expected: FAIL.

- [ ] **Step 3: `src/lib/zip.js` implementieren**

Store-Verfahren (Methode 0), lokale Header mit Version 20, UTF-8-Flag `0x0800`, DOS-Zeit aus `new Date()`, zentrale Verzeichnisse, EOCD. CRC32-Tabelle einmal aufbauen. Namen vor dem Schreiben eindeutig machen (`-2`, `-3` vor der Endung).

- [ ] **Step 4: Export-Tab implementieren**

`export.js`: Schlüssel lesen, Eintrag löschen, Fortschritt `n/m` und Liste der Fehler rendern. Für jede Familie mit `available` die Default-Variante laden (`loadFontFile`), Ziel über `format` (`native` → `ttf` bzw. `otf` je `kind`; `woff` → `woff`) über `exportFont`, in `createZip` sammeln. Dateiname aus `fileNameFor` mit `ext` passend zum Ergebnis. Download am Ende; bei 0 Dateien Fehlermeldung. Tab bleibt offen, Button „Schließen" ruft `window.close()`.
`popup.js`: `#zip-button` deaktiviert, solange keine ladbare Datei existiert; Klick schreibt den Eintrag.

- [ ] **Step 5: Tests und Build**

Run: `node --test tests/zip.test.mjs` → PASS
Run: `node scripts/build.mjs` → `built chrome, firefox`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/zip.js src/export.html src/export.js src/popup.js tests/zip.test.mjs
git commit -m "feat: zip export tab"
```

---

### Task 12: Demo-Seite, End-to-End-Test, Feinschliff

**Files:**
- Create: `demo/index.html`, `demo/fonts/.gitkeep`
- Modify: `README.md`, `src/popup.css`, `src/popup.js` (nur Politur)
- Test: manuell

**Interfaces:**
- Consumes: alle vorherigen Tasks.

- [ ] **Step 1: Demo-Seite bauen**

`demo/index.html` mit drei Abschnitten:
1. `@font-face` „Local Demo" aus `fonts/demo.woff2` (Datei legt der Nutzer selbst ab; fehlt sie, fällt der Browser zurück).
2. Google-Fonts-Einbindung per `<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap">`.
3. Absatz in `Georgia, serif` als System-Font-Fall.
Dazu eine kurze Anleitung im HTML-Kommentar, wie man die Datei über `file://` oder einen lokalen Server öffnet.

- [ ] **Step 2: End-to-End in Chrome**

1. `node scripts/build.mjs`, `chrome://extensions` → Entwicklermodus → `dist/chrome` laden.
2. <https://www.dandad.org/>: Popup öffnen. Erwartung: „Universal", vier Dateien, TrueType-Badge, Vorschau in Universal, TTF+WOFF aktiv, OTF deaktiviert mit Erklärung.
3. TTF herunterladen, installieren, Schriftname „Universal" in Windows prüfen; WOFF in `demo/index.html` einbinden und Anzeige prüfen.
4. „Alles als ZIP" → Export-Tab → Archiv enthält vier Dateien, `unzip -l` (oder Windows-Explorer) zeigt keine Fehler.
5. Filter „Alle" zeigt zusätzlich deklarierte, ungenutzte Fonts; Suche filtert; Vorschautext ändern aktualisiert alle Karten.
6. Fehlerfall: `chrome://extensions` öffnen und Popup starten → freundliche Meldung, kein Absturz.

- [ ] **Step 3: End-to-End in Firefox**

`about:debugging#/runtime/this-firefox` → „Temporäre Erweiterung laden" → `dist/firefox/manifest.json`. Schritte 2–4 aus Step 2 wiederholen. Zusätzlich `about:config` → `privacy.resistFingerprinting` unangetastet lassen; prüfen, dass die WOFF2-Konvertierung ohne CSP-Fehler läuft (Browser-Konsole des Popups).

- [ ] **Step 4: README schreiben**

Kurzbeschreibung, Installation für beide Browser (`dist/*` laden), Build-Befehl, Test-Befehl, bekannte Grenzen (EOT/TTC, Subsets, System-Fonts, Rechte), Hinweis auf die Berechtigung `<all_urls>` und warum sie nötig ist, Danksagung/Lizenz des vendorten Decoders.

- [ ] **Step 5: Alle Tests und Build laufen lassen**

Run: `node --test tests` → alle Tests PASS (oder begründete Skips)
Run: `node scripts/build.mjs` → `built chrome, firefox`

- [ ] **Step 6: Commit**

```bash
git add demo README.md src
git commit -m "docs: demo page and end-to-end verification"
```

---

## Self-Review Notes

- Spec-Abdeckung: Erkennung (T5–T7), Formate (T2–T4, T8), UI (T9–T10), ZIP (T11), Rechte/Build (T1), Tests (durchgehend), Testseite (T7, T10, T12).
- Bewusste Abweichung zur Spec: `analysis.used` ist nach Font-Stack gruppiert statt nach Familie; die Familienauswahl passiert in `buildModel`. Grund: der injizierte Code bleibt minimal und die Auswahl ist unit-testbar.
- ZIP-Format ist im Popup wählbar (`native` = TTF/OTF je Outline-Typ, `woff` = alles als WOFF); die Spec legte nur „alles als ZIP" fest.
