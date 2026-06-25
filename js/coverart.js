/* ===================================================================
   coverart.js — extract embedded album art straight from the audio file.

   Supports the common containers, detected by signature (not extension):
     • MP3   — ID3v2.2/2.3/2.4  (APIC / PIC frame)
     • M4A/MP4/AAC — moov>udta>meta>ilst>covr atom
     • FLAC  — METADATA_BLOCK_PICTURE (type 6)

   Everything runs locally on the file bytes; nothing is uploaded. Returns an
   object URL for the image, or null when the file has no embedded art.
   =================================================================== */

export async function extractCoverArt(file) {
  if (!file || typeof file.slice !== 'function') return null;
  try {
    const sig = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    // "ID3" → MP3 with an ID3v2 tag
    if (sig[0] === 0x49 && sig[1] === 0x44 && sig[2] === 0x33) return await fromID3(file);
    // "fLaC" → FLAC
    if (sig[0] === 0x66 && sig[1] === 0x4c && sig[2] === 0x61 && sig[3] === 0x43) return await fromFlac(file);
    // bytes 4..7 == "ftyp" → ISO base media (MP4/M4A)
    if (sig[4] === 0x66 && sig[5] === 0x74 && sig[6] === 0x79 && sig[7] === 0x70) return await fromMp4(file);
  } catch {
    /* malformed file — fall back to no art */
  }
  return null;
}

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const blobUrl = (bytes, mime) => URL.createObjectURL(new Blob([bytes], { type: mime }));

/* ----------------------------- MP3 / ID3v2 ----------------------------- */

async function fromID3(file) {
  const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  const ver = header[3];
  const flags = header[5];
  const tagSize = syncsafe(header, 6);
  let buf = new Uint8Array(await file.slice(0, 10 + tagSize).arrayBuffer());

  // Tag-level unsynchronisation: undo the inserted $00 after every $FF.
  if (flags & 0x80) buf = deunsync(buf, 10);

  let o = 10;
  // Skip an extended header if present.
  if (flags & 0x40) o += (ver === 4 ? syncsafe(buf, o) : u32(buf, o) + 4);

  const isV2 = ver === 2;
  const frameHeader = isV2 ? 6 : 10;

  while (o + frameHeader <= buf.length) {
    let id, size;
    if (isV2) {
      id = str(buf, o, 3);
      size = (buf[o + 3] << 16) | (buf[o + 4] << 8) | buf[o + 5];
    } else {
      id = str(buf, o, 4);
      size = ver === 4 ? syncsafe(buf, o + 4) : u32(buf, o + 4);
    }
    if (size <= 0 || id.charCodeAt(0) === 0) break;
    if (id === 'APIC' || id === 'PIC') {
      const pic = parseApic(buf.subarray(o + frameHeader, o + frameHeader + size), isV2);
      if (pic) return blobUrl(pic.data, pic.mime);
    }
    o += frameHeader + size;
  }
  return null;
}

function deunsync(buf, from) {
  const out = new Uint8Array(buf.length);
  out.set(buf.subarray(0, from));
  let w = from;
  for (let i = from; i < buf.length; i++) {
    out[w++] = buf[i];
    if (buf[i] === 0xff && buf[i + 1] === 0x00) i++;   // drop the stuffed $00
  }
  return out.subarray(0, w);
}

function parseApic(body, isV2) {
  let p = 0;
  const enc = body[p++];
  let mime;
  if (isV2) {
    const fmt = str(body, p, 3); p += 3;
    mime = fmt.toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg';
  } else {
    let end = p;
    while (end < body.length && body[end] !== 0) end++;
    mime = str(body, p, end - p) || 'image/jpeg';
    p = end + 1;
  }
  p++;                                          // picture type byte
  if (enc === 1 || enc === 2) {                 // UTF-16 description → 2-byte terminator
    while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2;
    p += 2;
  } else {
    while (p < body.length && body[p] !== 0) p++;
    p += 1;
  }
  if (p >= body.length) return null;
  return { mime, data: body.subarray(p) };
}

/* ------------------------------- FLAC ---------------------------------- */

async function fromFlac(file) {
  let pos = 4;                                  // after "fLaC"
  for (let guard = 0; guard < 128; guard++) {
    const head = new Uint8Array(await file.slice(pos, pos + 4).arrayBuffer());
    if (head.length < 4) break;
    const last = (head[0] & 0x80) !== 0;
    const type = head[0] & 0x7f;
    const len = (head[1] << 16) | (head[2] << 8) | head[3];
    const bodyStart = pos + 4;
    if (type === 6) {                           // PICTURE
      const b = new Uint8Array(await file.slice(bodyStart, bodyStart + len).arrayBuffer());
      let p = 4;                                // skip picture type
      const mimeLen = u32(b, p); p += 4;
      const mime = str(b, p, mimeLen); p += mimeLen;
      const descLen = u32(b, p); p += 4 + descLen;
      p += 16;                                  // width,height,depth,colors
      const dataLen = u32(b, p); p += 4;
      if (p + dataLen <= b.length) return blobUrl(b.subarray(p, p + dataLen), mime || 'image/jpeg');
    }
    if (last) break;
    pos = bodyStart + len;
  }
  return null;
}

/* ----------------------------- MP4 / M4A ------------------------------- */

async function fromMp4(file) {
  const read = async (p, n) => new Uint8Array(await file.slice(p, p + n).arrayBuffer());

  async function walk(start, end, depth) {
    let p = start;
    while (p + 8 <= end && depth < 8) {
      const h = await read(p, 8);
      let size = u32(h, 0);
      const type = str(h, 4, 4);
      let headerLen = 8;
      if (size === 1) { const ext = await read(p + 8, 8); size = u32(ext, 4); headerLen = 16; } // 64-bit (low word)
      if (size < headerLen) break;
      const cStart = p + headerLen;
      const cEnd = p + size;

      if (type === 'covr') return await parseCovr(read, cStart, cEnd);
      if (type === 'meta') { const r = await walk(cStart + 4, cEnd, depth + 1); if (r) return r; }
      else if (['moov', 'udta', 'ilst', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) {
        const r = await walk(cStart, cEnd, depth + 1); if (r) return r;
      }
      p += size;
    }
    return null;
  }
  return await walk(0, file.size, 0);
}

async function parseCovr(read, start, end) {
  const max = Math.min(end - start, 16 * 1024 * 1024);
  const b = await read(start, max);
  let p = 0;
  while (p + 16 <= b.length) {
    const size = u32(b, p);
    const type = str(b, p + 4, 4);
    if (type === 'data') {
      const dataType = u32(b, p + 8);           // 13 = JPEG, 14 = PNG
      const imgStart = p + 16;
      const imgEnd = Math.min(p + size, b.length);
      const mime = dataType === 14 ? 'image/png' : 'image/jpeg';
      if (imgEnd > imgStart) return blobUrl(b.subarray(imgStart, imgEnd), mime);
    }
    if (size <= 0) break;
    p += size;
  }
  return null;
}

function str(b, o, n) {
  let s = '';
  for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]);
  return s;
}
