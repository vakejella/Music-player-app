/* ===================================================================
   coverart.js — extract embedded album art from an audio File.

   Reads the ID3v2 tag at the start of MP3 files and pulls the picture
   out of the APIC (v2.3/2.4) or PIC (v2.2) frame. Returns an object
   URL for the image, or null if there's no embedded art. Pure client
   side — nothing is uploaded.
   =================================================================== */

function syncsafe(a, b, c, d) {
  return (a << 21) | (b << 14) | (c << 7) | d;
}

export async function extractCoverArt(file) {
  if (!file || typeof file.slice !== 'function') return null;
  try {
    const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    // "ID3"
    if (header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) return null;

    const ver = header[3];                         // 2, 3 or 4
    const tagSize = syncsafe(header[6], header[7], header[8], header[9]);
    const buf = new Uint8Array(await file.slice(0, 10 + tagSize).arrayBuffer());

    const isV2 = ver === 2;
    const frameHeader = isV2 ? 6 : 10;
    let o = 10;

    while (o + frameHeader <= buf.length) {
      let id, size;
      if (isV2) {
        id = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2]);
        size = (buf[o + 3] << 16) | (buf[o + 4] << 8) | buf[o + 5];
      } else {
        id = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
        size = ver === 4
          ? syncsafe(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7])
          : ((buf[o + 4] << 24) | (buf[o + 5] << 16) | (buf[o + 6] << 8) | buf[o + 7]) >>> 0;
      }
      if (size <= 0 || id.charCodeAt(0) === 0) break;

      if (id === 'APIC' || id === 'PIC') {
        const pic = parsePicture(buf.subarray(o + frameHeader, o + frameHeader + size), isV2);
        if (pic) return URL.createObjectURL(new Blob([pic.data], { type: pic.mime }));
      }
      o += frameHeader + size;
    }
  } catch {
    /* malformed tag — just fall back to no art */
  }
  return null;
}

function parsePicture(body, isV2) {
  let p = 0;
  const enc = body[p++];                           // text encoding
  let mime;

  if (isV2) {
    const fmt = String.fromCharCode(body[p], body[p + 1], body[p + 2]); p += 3;
    mime = fmt.toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg';
  } else {
    let end = p;
    while (end < body.length && body[end] !== 0) end++;
    mime = String.fromCharCode(...body.subarray(p, end)) || 'image/jpeg';
    p = end + 1;
  }

  p++;                                             // picture type byte

  // Skip the (encoding-dependent null-terminated) description.
  if (enc === 1 || enc === 2) {
    while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2;
    p += 2;
  } else {
    while (p < body.length && body[p] !== 0) p++;
    p += 1;
  }

  if (p >= body.length) return null;
  return { mime, data: body.subarray(p) };
}
