// Identify a health export by its leading bytes, falling back to the object
// key's extension. Content wins because a pre-signed upload URL carries a fixed
// extension (e.g. ".zip") regardless of what the user actually PUTs — a JSON
// feed uploaded to a ".zip" key must still be parsed as JSON.

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]); // space, tab, LF, CR

// Returns "json" | "xml" | "zip" from the magic bytes, or null when unclear.
export function sniffContent(buf) {
  if (!buf || !buf.length) return null;
  let i = 0;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3; // UTF-8 BOM
  while (i < buf.length && WS.has(buf[i])) i++;
  const c = buf[i];
  if (c === 0x7b || c === 0x5b) return "json"; // { or [
  if (c === 0x50 && buf[i + 1] === 0x4b) return "zip"; // "PK" (zip local header)
  if (c === 0x3c) return "xml"; // <
  return null;
}

// Returns "json" | "xml" | "zip". A confident content sniff overrides the
// extension; otherwise the extension decides, defaulting to "zip".
export function resolveFormat(key, firstChunk) {
  const sniffed = sniffContent(firstChunk);
  if (sniffed) return sniffed;
  const lower = (key ?? "").toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".xml")) return "xml";
  return "zip";
}
