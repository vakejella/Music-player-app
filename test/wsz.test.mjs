/* Unit test for js/wsz.js — builds a real ZIP (stored + deflated + nested
   folder entries) and asserts the parser extracts them correctly.
   Run with: node test/wsz.test.mjs   (exits non-zero on failure) */
import zlib from 'node:zlib';
import assert from 'node:assert';
import { readSkinArchive } from '../js/wsz.js';

function makeZip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const { name, data, deflate } of entries) {
    const nameBuf = Buffer.from(name);
    const stored = deflate ? zlib.deflateRawSync(data) : data;
    const method = deflate ? 8 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(0, 14);
    lh.writeUInt32LE(stored.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const localOff = offset;
    const rec = Buffer.concat([lh, nameBuf, stored]);
    chunks.push(rec); offset += rec.length;
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(stored.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(localOff, 42);
    central.push(Buffer.concat([ch, nameBuf]));
  }
  const cd = Buffer.concat(central);
  const cdOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}

const zip = makeZip([
  { name: 'VISCOLOR.TXT', data: Buffer.from('0,0,0\n24,33,41\n'), deflate: false },
  { name: 'MyCoolSkin/main.bmp', data: Buffer.from('BM-fake-bitmap-bytes'), deflate: true },
  { name: 'pledit.txt', data: Buffer.from('[Text]\nNormal=#00FF00\n'), deflate: true },
]);

const ab = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
const files = await readSkinArchive(ab);

assert.ok(files.has('main.bmp'), 'nested main.bmp should be extracted by basename');
assert.equal(new TextDecoder().decode(files.get('main.bmp')), 'BM-fake-bitmap-bytes', 'deflated entry decodes');
assert.ok(files.has('viscolor.txt'), 'stored entry present (lowercased)');
assert.equal(new TextDecoder().decode(files.get('viscolor.txt')).split('\n')[0], '0,0,0', 'stored entry content intact');
assert.ok(files.has('pledit.txt'), 'second deflated entry present');

console.log('wsz.test.mjs — all assertions passed ✓');
