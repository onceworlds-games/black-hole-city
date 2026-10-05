// The eaten set of a round travels as a bitset in base64 (a 1700 object city is about 290 characters).
// Pure and strict: a malformed string from another page decodes to null, never throws.

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ABC.length; i++) LOOKUP[ABC.charCodeAt(i)] = i;

/** One byte per object (0 or 1) to a packed base64 string, trailing zero bytes trimmed. */
export function encodeEaten(flags, n = flags.length) {
  const bytes = new Uint8Array((n + 7) >> 3);
  for (let i = 0; i < n; i++) if (flags[i]) bytes[i >> 3] |= 1 << (i & 7);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return toBase64(bytes, end);
}

/** Packed base64 back to flags for `n` objects. Null when the text isn't a valid set for that size. */
export function decodeEaten(text, n) {
  if (typeof text !== 'string' || text.length > 4 * ((n + 7) >> 3) / 3 + 8) return null;
  const bytes = fromBase64(text);
  if (!bytes || bytes.length > ((n + 7) >> 3)) return null;
  const flags = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const byte = i >> 3;
    if (byte < bytes.length && bytes[byte] & (1 << (i & 7))) flags[i] = 1;
  }
  return flags;
}

export function toBase64(bytes, length = bytes.length) {
  let out = '';
  for (let i = 0; i < length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < length ? bytes[i + 1] : 0;
    const c = i + 2 < length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += ABC[(triple >> 18) & 63] + ABC[(triple >> 12) & 63];
    out += i + 1 < length ? ABC[(triple >> 6) & 63] : '=';
    out += i + 2 < length ? ABC[triple & 63] : '=';
  }
  return out;
}

export function fromBase64(text) {
  if (typeof text !== 'string' || text.length % 4 !== 0) return null;
  let pad = 0;
  if (text.endsWith('==')) pad = 2;
  else if (text.endsWith('=')) pad = 1;
  const bytes = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let triple = 0;
    for (let k = 0; k < 4; k++) {
      const ch = text.charCodeAt(i + k);
      let v;
      if (ch === 61) {
        if (i + k < text.length - pad) return null;
        v = 0;
      } else {
        v = ch < 128 ? LOOKUP[ch] : -1;
        if (v < 0) return null;
      }
      triple = (triple << 6) | v;
    }
    if (o < bytes.length) bytes[o++] = (triple >> 16) & 255;
    if (o < bytes.length) bytes[o++] = (triple >> 8) & 255;
    if (o < bytes.length) bytes[o++] = triple & 255;
  }
  return bytes;
}
