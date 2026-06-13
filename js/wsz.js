/* ===================================================================
   wsz.js — read classic Winamp skin archives (.wsz / .zip)

   A .wsz file is just a ZIP archive containing BMP sprite sheets
   (main.bmp, cbuttons.bmp, numbers.bmp, text.bmp, …) plus a few
   config text files (viscolor.txt, pledit.txt, region.txt).

   This parser reads the ZIP central directory and inflates entries
   using the browser-native DecompressionStream('deflate-raw') — no
   third-party dependency required.
   =================================================================== */

const EOCD_SIG = 0x06054b50;   // End of central directory
const CEN_SIG  = 0x02014b50;   // Central directory file header

function u16(dv, o) { return dv.getUint16(o, true); }
function u32(dv, o) { return dv.getUint32(o, true); }

async function inflateRaw(bytes) {
  // Stored (method 0) entries are returned as-is by callers; this only
  // handles method 8 (raw DEFLATE).
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream not supported in this browser');
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Parse a .wsz/.zip ArrayBuffer into a Map of lowercased filename → Uint8Array.
 * Directory entries are skipped; only the basename is kept (skins are flat,
 * but some archives nest everything in a folder).
 */
export async function readSkinArchive(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const len = dv.byteLength;

  // Locate End Of Central Directory (scan backwards; comment max 65535).
  let eocd = -1;
  for (let i = len - 22; i >= 0 && i >= len - 22 - 65535; i--) {
    if (u32(dv, i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Not a valid ZIP/.wsz archive (no EOCD)');

  const count = u16(dv, eocd + 10);
  let off = u32(dv, eocd + 16);   // start of central directory

  const entries = [];
  for (let i = 0; i < count; i++) {
    if (u32(dv, off) !== CEN_SIG) break;
    const method   = u16(dv, off + 10);
    const compSize = u32(dv, off + 20);
    const nameLen  = u16(dv, off + 28);
    const extraLen = u16(dv, off + 30);
    const commLen  = u16(dv, off + 32);
    const localOff = u32(dv, off + 42);
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
    entries.push({ name, method, compSize, localOff });
    off += 46 + nameLen + extraLen + commLen;
  }

  const files = new Map();
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;                 // directory
    // Read the local header to find where the data actually starts.
    const lhNameLen  = u16(dv, e.localOff + 26);
    const lhExtraLen = u16(dv, e.localOff + 28);
    const dataStart  = e.localOff + 30 + lhNameLen + lhExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + e.compSize);

    let data;
    if (e.method === 0) data = raw.slice();               // stored
    else if (e.method === 8) data = await inflateRaw(raw); // deflate
    else continue;                                         // unsupported

    const base = e.name.split(/[\\/]/).pop().toLowerCase();
    files.set(base, data);
  }
  return files;
}
