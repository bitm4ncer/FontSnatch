<div align="center">

<img src="docs/icon.svg" width="112" height="112" alt="FontSnatch" />

# FontSnatch

**Every font on the page, ready to download.**

List, preview, and export the fonts a website actually uses — as TTF, OTF, or WOFF.

[![Chrome](https://img.shields.io/badge/Chrome-Brave-Vivaldi-252525?style=flat-square&logo=googlechrome&logoColor=ff0500)](#chromium-browsers-chrome-brave-vivaldi-edge)
[![Firefox](https://img.shields.io/badge/Firefox-252525?style=flat-square&logo=firefoxbrowser&logoColor=ff0500)](#firefox)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-252525?style=flat-square)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-252525?style=flat-square)](#license)

</div>

---

FontSnatch is a Manifest V3 extension for Chrome, Brave, Vivaldi, Edge, and Firefox.
Open it on any page and it shows every font the page uses, renders a live preview in
the real typeface, and downloads the files — one at a time or as a ZIP.

No account, no server, no telemetry. Everything happens locally in your browser.

![FontSnatch popup](docs/screenshot-popup.png)

## Features

- Finds the fonts actually used on the page via computed styles and maps them to
  the page's `@font-face` rules — including cross-origin stylesheets and `@import`
  chains.
- Live preview in the real font, with an editable sample text.
- Filters for **Used**, **All**, and **With source**, plus instant search.
- Download individual cuts as **TTF**, **OTF**, or **WOFF**.
- **Download ZIP** for every cut at once (original format or everything as WOFF).
- Honest format labels: TrueType outlines become TTF, CFF outlines become OTF.
  Missing cuts (for example a CSS reference that returns 404) are reported per file.
- System fonts are listed so the page's typography is complete, but marked as not
  downloadable.

## Install

The built extension is included in [`dist/`](dist), so no build step is required.

### Chromium browsers (Chrome, Brave, Vivaldi, Edge)

1. Download this repository: **Code → Download ZIP**, then unzip it.
2. Open the extensions page for your browser:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Vivaldi: `vivaldi://extensions`
   - Edge: `edge://extensions`
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `dist/chrome` folder from the unzipped repo.
5. Pin **FontSnatch** to the toolbar.

> Chrome and Edge may show a "Disable developer mode extensions" notice after a
> restart. Keep the extension enabled; the notice only affects unpacked extensions.

### Firefox

1. Download and unzip this repository as above.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…**.
4. Select `dist/firefox/manifest.json`.

> Firefox loads unpacked add-ons as **temporary** extensions: they disappear when
> Firefox restarts, and you load them again with the same three steps. A permanent
> install requires a signed add-on distributed through Mozilla Add-ons.

### Permissions

The install prompt mentions access to all websites. FontSnatch needs this to read
cross-origin stylesheets (CDN fonts such as Google Fonts) and to fetch the font
files the page already uses. It does not upload or transmit anything.

## Usage

1. Open any website.
2. Click the FontSnatch icon.
3. Pick a font, check the preview, and press **TTF**, **OTF**, or **WOFF**.
4. Use **Download ZIP** below the list to save every cut at once. The export opens
   in a tab, shows per-file progress, and keeps a log of anything that failed.

Use **All** to include declared but unused `@font-face` families, and **With source**
to hide system fonts. The gear opens one advanced option: allow a mismatched file
extension (the content never changes).

## How it works

1. A small injected function walks the page, reads computed `font-family`,
   `font-weight`, and `font-style` values, and collects the page's stylesheets.
2. The popup parses `@font-face` rules, follows `@import` chains, and matches
   families to files. Fonts declared but never used are marked separately.
3. Font files are fetched by the extension itself, so CORS and page CSP do not get
   in the way.
4. WOFF and WOFF2 are unpacked to a real sfnt; WOFF is rebuilt with
   `CompressionStream`. TTF/OTF are detected from the outline format, never guessed
   from the file extension.

## Formats

| Input | Output |
| --- | --- |
| WOFF2, WOFF, TTF, OTF | TTF (TrueType outlines) |
| WOFF2, WOFF, TTF, OTF | OTF (CFF outlines) |
| WOFF2, WOFF, TTF, OTF | WOFF |

The outline format is preserved. Converting between TrueType and CFF outlines is a
different job than renaming a file, so the incompatible button is disabled and
explains why. The advanced option can still save the file with the requested
extension; the bytes stay unchanged.

## Limitations

- EOT, SVG fonts, and font collections (`.ttc`) are not supported.
- Subset fonts stay subsets. Google Fonts, for example, serves one file per
  `unicode-range`; the file row shows which subset you are looking at.
- Variable fonts are treated as one file.
- System fonts cannot be downloaded.
- If a stylesheet points to a file the server does not have (404), the extension can
  only report it. Downloading cannot invent missing files.
- Downloading a font is not a license to use it. Check the font's license.

## Development

Requirements: Node.js 22 or newer for the build and tests. The extension itself has
no runtime dependencies.

```sh
node scripts/build.mjs      # rebuild dist/chrome and dist/firefox
node --test                 # unit tests
node scripts/make-icons.mjs # regenerate PNG icons from .design/AppIcon.svg
```

Tests read system fonts from `C:\Windows\Fonts` and fetch one WOFF2 file from
`dandad.org`; the WOFF2 test is skipped when offline. Font binaries are never
committed.

`demo/index.html` is a local test page with Google Fonts (including real italic
cuts), a self-hosted font, a system font, and an intentionally unused `@font-face`
rule. Serve it over HTTP:

```sh
python -m http.server 8123 --directory demo
```

Place the local font at `demo/fonts/demo.woff2` (not checked in).

### Project layout

```
src/
  manifest.chrome.json / manifest.firefox.json
  popup.html / popup.css / popup.js      font list, filters, preview, downloads
  export.html / export.css / export.js   bulk ZIP export
  lib/
    analyze.js        injected page analysis
    browser.js        extension APIs, fetch, download
    convert.js        container detection and export
    css-fonts.js      tolerant @font-face / @import parser
    errors.js         user-facing error messages
    export-plan.js    plans one export per cut
    format.js         file names, byte sizes, MIME types
    pipeline.js       analysis → rules → model
    preview.js        font cache and FontFace previews
    resolve.js        builds the font model
    select.js         source ranking and subset labels
    sfnt.js           sfnt reader/writer
    woff.js           WOFF reader/writer
    woff2.js          WOFF2 decoder wrapper
    zip.js            store-only ZIP writer
scripts/build.mjs     dependency-free build
tests/                node --test
```

## Third-party

- `src/lib/woff2.wasm`, `woff2-codec.js`, and `font-codecs-core.js` wrap Google's
  WOFF2 codec and Brotli, compiled to WebAssembly. They come from
  [`woff2-codec`](https://www.npmjs.com/package/woff2-codec) and
  `web-font-codecs-core`, both MIT. Licenses:
  `src/lib/woff2-codec-license.txt` and `src/lib/woff2-notices.md`. The vendored
  files were only adjusted for relative imports.

## License

MIT. See [LICENSE](LICENSE).
