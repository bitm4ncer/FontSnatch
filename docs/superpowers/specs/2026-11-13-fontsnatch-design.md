# FontSnatch — Design Spec

Datum: 2026-11-13
Status: Entwurf zur Review

## 1. Ziel

Eine Browser-Extension für Chrome und Firefox, die auf der aktuellen Seite alle
verwendeten Fonts auflistet, sie im Popup in echter Schrift zeigt und als
TTF, OTF oder WOFF herunterlädt.

**Erfolgskriterien**

- Auf <https://www.dandad.org/> erscheint die Familie „Universal" mit ihren vier
  Schnitten (400/500 × normal/italic), jeweils mit Vorschau und ladbaren Dateien.
- TTF- und WOFF-Export der dortigen WOFF2-Dateien sind gültig und lassen sich
  installieren bzw. erneut auf einer Webseite einsetzen.
- OTF wird bei TrueType-basierten Fonts korrekt als nicht verfügbar erklärt
  (siehe 6), nicht stillschweigend falsch benannt.
- Läuft unverändert in aktuellem Chrome und Firefox.
- Unit-Tests für Konvertierung, CSS-Parsing und ZIP laufen mit `node --test`.

## 2. Scope

**In**

- Erkennung genutzter Fonts über berechnete Styles, `document.fonts` und
  `@font-face`-Regeln.
- Filter: genutzt / alle deklariert / nur herunterladbar; Suchfeld.
- Vorschau jedes Fonts im Popup mit echtem Fontfile.
- Download pro Datei (TTF/OTF/WOFF) und gesammelt als ZIP.
- Konvertierung WOFF→sfnt, WOFF2→sfnt, sfnt→WOFF.
- Ehrliche Formatkennzeichnung (TrueType/glyf vs. CFF/OTTO).

**Out**

- EOT- und SVG-Fonts, Font-Collections (`.ttc`).
- Echte Outline-Konvertierung glyf↔CFF (bräuchte einen Font-Compiler).
- Variable-Font-Instancing; variable Fonts werden als eine Datei behandelt.
- Herunterladen von System-Fonts.
- Automatisches Nachladen von Vollfonts für Subsets (z. B. Google Fonts).
- Pseudo-Elemente (`::before`/`::after`) als Nutzungsquelle.

## 3. Architektur

Kein Background-Script. Alles läuft im Popup bzw. im Export-Tab.

```
Popup (Extension-Page, host_permissions)
  ├─ scripting.executeScript(tabId, analyzePage)  → Rohdaten aus der Seite
  ├─ fetch(fremde CSS) + CSS-Parser               → @font-face-Regeln
  ├─ fetch(font-URL) + Konverter                  → sfnt/WOFF
  ├─ FontFace-API                                 → Vorschau
  └─ <a download>                                 → Einzeldatei
Export-Tab (export.html)
  └─ derselbe Konverter + ZIP-Writer              → ein Archiv
```

Warum Popup statt Service Worker: MV3-Service-Worker dürfen keine Blob-URLs für
Downloads erzeugen und werden nach kurzer Idle-Zeit beendet. Popup und
Export-Tab sind normale Extension-Pages mit vollem DOM- und Blob-Zugriff.

### Dateien

```
src/
  manifest.chrome.json      MV3, ohne background
  manifest.firefox.json     MV3, gecko.id, min. 109
  popup.html / popup.css / popup.js
  export.html / export.js
  lib/
    browser.js              browser/chrome-API + gemeinsame Helfer
    analyze.js              injizierte Funktion (vollständig selbstständig)
    css-fonts.js            @font-face-/@import-Parser, Familien-Normalisierung
    resolve.js              Nutzung + Regeln + Resource-Entries → Fontmodell
    sfnt.js                 sfnt lesen/schreiben, Checksummen, Flavor
    woff.js                 WOFF lesen/schreiben
    woff2.js + woff2.wasm   Decoder (Google woff2, vendored)
    zip.js                  Store-ZIP mit CRC32
    format.js               Byte-Größen, Dateinamen, MIME
scripts/build.mjs           kopiert src → dist/chrome bzw. dist/firefox,
                            wählt das passende Manifest, prüft Pflichtdateien
tests/                      node --test
demo/index.html             lokale Testseite (Google Fonts + lokaler Font)
```

## 4. Analyse im Tab

`analyzePage` wird per `chrome.scripting.executeScript({ func })` injiziert und
muss deshalb ohne Closures auskommen. Sie liefert:

```js
{
  url, title,
  used: [{ family, stack, byWeightStyle: { "400|normal": { elements, chars } } }],
  sheets: [{ href, cssText | null, mediaText }],
  fontFaces: [{ family, weight, style, status }],     // document.fonts
  resourceFonts: [url],                               // performance entries
  truncated: boolean
}
```

**Nutzung:** `TreeWalker` über Textknoten mit nicht-leerem, sichtbarem Text
(`display:none`, `visibility:hidden`, `hidden` werden übersprungen). Pro Element
einmal `getComputedStyle`; Familienliste wird geparst, die erste nicht-generische
Familie zählt. Cache pro Font-Stack. Obergrenze 10 000 Elemente bzw. 150 ms
Zeitbudget, danach `truncated: true` und Hinweis im Popup.

**Stylesheets:** vom selben Origin wird `cssRules` gelesen und als Text
serialisiert; bei `SecurityError` bleibt `cssText: null`, der `href` wird im
Popup nachgeladen. `@import`-Ketten werden im Popup bis Tiefe 2 verfolgt.

**Fallback:** `performance.getEntriesByType("resource")` mit Font-Endung liefert
Dateien, die keiner Regel zugeordnet werden konnten (z. B. wenn das CSS nicht
lesbar ist). Sie erscheinen als eigener Abschnitt „Nicht zugeordnete Dateien".

## 5. Fontmodell

```js
FontFamily {
  family: string,            // Anzeigename
  key: string,               // normalisiert
  available: boolean,        // mind. eine ladbare Datei
  isSystem: boolean,         // genutzt, aber keine @font-face-Regel
  usedChars: number, usedElements: number, weightsUsed: string[],
  variants: [{
    weight, style, unicodeRange,
    sources: [{ url, format, size? }],
    kind: 'ttf' | 'otf' | 'unknown',   // nach Fetch ermittelt
    state: 'idle' | 'loading' | 'ready' | 'error',
    error?: string
  }]
}
```

Zuordnung: Familie normalisiert (Anführungszeichen, Whitespace, Groß/Klein)
gegen `@font-face`. `local()`-Quellen werden ignoriert, aber als Hinweis
„lokale Installation möglich" vermerkt.

**Subsets:** Quellen mit unterschiedlichem `unicode-range` werden gruppiert. Als
Standard-Datei gilt die Quelle, deren Bereich U+0041 enthält; ohne Bereich die
erste. Weitere Subsets stehen aufklappbar zur Verfügung.

## 6. Formate und Konvertierung

Erkennung über die ersten vier Bytes:

| Signatur | Bedeutung |
|---|---|
| `wOF2` | WOFF2, Flavor im Header (0x00010000 oder `OTTO`) |
| `wOFF` | WOFF 1.0, Flavor im Header |
| `\0\1\0\0`, `true` | sfnt mit glyf-Outlines → **TTF** |
| `OTTO` | sfnt mit CFF-Outlines → **OTF** |
| `ttcf` | Collection → nicht unterstützt |

**WOFF lesen:** Header (44 B) und Table Directory (20 B/Eintrag) parsen, jede
Tabelle mit `DecompressionStream("deflate")` entpacken (nur wenn
`compLength < origLength`), sfnt neu aufbauen, `checkSumAdjustment` korrigieren.

**WOFF schreiben:** Tabellen mit `CompressionStream("deflate")` komprimieren,
roh speichern, wenn das Ergebnis nicht kleiner ist; Header, Directory,
4-Byte-Padding, `totalSfntSize` korrekt setzen.

**WOFF2 lesen:** vendored Google-WOFF2-WASM (Brotli fehlt den Browsern nativ).
Decoder wird lazy geladen, ~1 MB. `'wasm-unsafe-eval'` ist in der CSP erlaubt.

**Exportregel:** Der Outline-Typ ist bindend.

- glyf → Button **TTF** aktiv, **OTF** deaktiviert mit Tooltip
  „Dieser Font enthält TrueType-Outlines; eine echte OTF-Konvertierung ist nicht
  möglich."
- CFF → Button **OTF** aktiv, **TTF** deaktiviert (analog).
- **WOFF** ist immer aktiv.

Erweiterte Einstellung `allowMismatchedExtension` (Default aus): erlaubt den
Download mit der „falschen" Endung, Dateiinhalt bleibt unverändert; die UI weist
darauf hin.

**Dateiname:** `Familie-Weight-Style[-subset].<ext>`, Familie auf
`[A-Za-z0-9._-]` reduziert, Leerzeichen → `-`.

## 7. UI

Popup, 400 px breit, max. 600 px hoch, hell/dunkel über `prefers-color-scheme`.

```
┌ FontSnatch · dandad.org                 ⟳ ┐
│ [Genutzt] [Alle] [Nur ladbar]   [Suche…] │
│ Vorschautext: [The quick brown fox…]      │
├───────────────────────────────────────────┤
│ Universal            [TrueType] 4 Dateien │
│ The quick brown fox jumps over…           │
│ 400 · 500 · normal · italic · 2 431 Zeichen│
│ [TTF] [OTF] [WOFF]            ▸ Dateien 4 │
├───────────────────────────────────────────┤
│ Arial (System-Font)          [nicht ladbar]│
└───────────────────────────────────────────┘
```

- Vorschau lädt Fonts nur für sichtbare Karten (`IntersectionObserver`) über
  `new FontFace(name, buffer)`; ein Fehlschlag zeigt den System-Fallback und
  einen Hinweis, blockiert aber nicht.
- Aufklappbare Dateiliste: Weight/Style, Subset, Größe, Formate, Fehlerstatus,
  Retry.
- Leerzustand: „Keine Fonts gefunden" bzw. „Auf dieser Seite nicht verfügbar"
  für `chrome://`, Add-on-Store und PDF-Viewer.
- Footer: Lizenzhinweis („Nur Fonts verwenden, für die du Rechte hast") und
  Zahnrad für Einstellungen.
- Alle Downloads laufen als `<a download>` mit Blob-URL; kein
  `downloads`-Permission nötig.
- „Alles als ZIP" öffnet `export.html?tabId=…`. Der Tab zeigt Fortschritt pro
  Datei, sammelt Fehler und startet am Ende einen Download
  `fontsnatch-<host>-<datum>.zip`. Er schließt sich nicht automatisch, damit
  Fehler lesbar bleiben.

## 8. Berechtigungen und Kompatibilität

```json
"permissions": ["activeTab", "scripting", "storage"],
"host_permissions": ["<all_urls>"],
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

`<all_urls>` ist nötig, um fremde Stylesheets (CDN-Fonts) zu lesen und Fontdateien
von anderen Origins ohne CORS-Probleme zu laden. Die Installation zeigt dafür die
Warnung „Daten aller Websites lesen". Bewusste Entscheidung für ein lokales
Werkzeug; Alternative wäre der Verzicht auf CDN-Font-Zuordnung.

Firefox-Manifest ergänzt `browser_specific_settings.gecko.id`
(`fontsnatch@local`), `strict_min_version: "109.0"` und kein `background`.
API-Zugriff über `globalThis.browser ?? globalThis.chrome` mit Promises.

**Build:** `node scripts/build.mjs` kopiert `src/` nach `dist/chrome` und
`dist/firefox`, legt das jeweilige Manifest als `manifest.json` ab und bricht bei
fehlenden Dateien ab. Keine Abhängigkeiten, kein Bundler.

## 9. Fehlerfälle

| Fall | Verhalten |
|---|---|
| Kein Zugriff auf den Tab | Hinweis, Retry-Button |
| Stylesheet nicht lesbar/nicht abrufbar | Regeln fehlen, Dateien über Resource-Entries |
| Font-URL 403/Hotlink-Schutz | Fehler an der Datei, Retry; übrige Fonts bleiben nutzbar |
| CORS/CSP blockiert | identisch, mit Ursache im Tooltip |
| Unbekanntes Format (EOT/SVG/TTC) | Datei gelistet, Download deaktiviert + Grund |
| WOFF2-Decoder lädt nicht | WOFF2-Dateien nicht konvertierbar, Rohdownload als Hinweis |
| Sehr große Seite | Analyse nach Limit abgebrochen, Banner „unvollständig" |

## 10. Testplan

**Unit (`node --test tests/`)**

- `sfnt`: Tabellen aus `C:\Windows\Fonts\arial.ttf` lesen, neu schreiben,
  Tabelleninhalte identisch.
- `woff`: sfnt → WOFF → sfnt, Tabellen byte-gleich; Header-Felder geprüft.
- `woff2`: `https://www.dandad.org/fonts/universal-400.woff2` zur Laufzeit laden
  (nicht committen, kommerzieller Font), dekodieren, Flavor und Tabellen prüfen;
  Test wird bei fehlendem Netz übersprungen.
- `css-fonts`: `@font-face` mit mehreren `url()`/`format()`/`unicode-range`,
  `@import`, Quoting-Varianten, Cross-Origin-Basis-URLs.
- `zip`: Archiv mit zwei Dateien schreiben, Signaturen/CRC prüfen.
- `resolve`: Nutzung + Regeln + Resource-Entries zu Familien zusammenführen,
  Subset-Auswahl, System-Font-Erkennung.

**Manuell**

1. Chrome: `dist/chrome` entpackt laden, <https://www.dandad.org/> öffnen.
   Erwartung: „Universal", 4 Dateien, TrueType-Badge, Vorschau korrekt,
   OTF deaktiviert, TTF/WOFF laden und installieren.
2. Firefox: `dist/firefox` über `about:debugging` laden, gleicher Test.
3. `demo/index.html` mit Google Fonts und lokalem Font: Filter, Suche,
   ZIP-Export, System-Font-Kennzeichnung.
4. Fehlerfall: Seite mit `file://`-URL ohne Dateizugriff.

## 11. Risiken

- **WOFF2-WASM-Größe** (~1 MB) und CSP: früh im Plan verifizieren, bevor die UI
  darauf aufbaut.
- **Firefox-CSSOM**: `CSSFontFaceRule.cssText` kann je nach Version anders
  serialisieren; Parser deshalb tolerant und mit Testfällen abgesichert.
- **Subset-Fonts**: heruntergeladene Dateien enthalten nur die Glyphen des
  Subsets. Wird in der UI an der Datei angezeigt.
- **Rechtliches**: Download bedeutet nicht Nutzungsrecht; Hinweis im Footer.
