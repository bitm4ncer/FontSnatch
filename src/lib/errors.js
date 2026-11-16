export function describeError(error) {
  if (!error) return 'Unbekannter Fehler';

  if (error.code === 'UNSUPPORTED_FORMAT') return 'Format nicht unterstützt (EOT/SVG/TTC)';
  if (error.code === 'FORMAT_MISMATCH') return 'Format nicht konvertierbar';
  if (error.code === 'WOFF2_DECODE_FAILED') return 'WOFF2 konnte nicht entpackt werden';
  if (error.code === 'WOFF2_DECODER_LOAD_FAILED') return 'WOFF2-Decoder konnte nicht geladen werden';

  if (error.code === 'FONT_FETCH_FAILED') {
    if (error.status === 404) return 'Datei fehlt auf dem Server (HTTP 404)';
    if (error.status) return `Download fehlgeschlagen (HTTP ${error.status})`;
    return 'Download fehlgeschlagen';
  }

  return error.message || 'Unbekannter Fehler';
}
