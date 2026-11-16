export function describeError(error) {
  if (!error) return 'Unknown error';

  if (error.code === 'UNSUPPORTED_FORMAT') return 'Unsupported format (EOT/SVG/TTC)';
  if (error.code === 'FORMAT_MISMATCH') return 'Format cannot be converted';
  if (error.code === 'WOFF2_DECODE_FAILED') return 'WOFF2 could not be unpacked';
  if (error.code === 'WOFF2_DECODER_LOAD_FAILED') return 'WOFF2 decoder could not be loaded';

  if (error.code === 'FONT_FETCH_FAILED') {
    if (error.status === 404) return 'File missing on server (HTTP 404)';
    if (error.status) return `Download failed (HTTP ${error.status})`;
    return 'Download failed';
  }

  return error.message || 'Unknown error';
}
