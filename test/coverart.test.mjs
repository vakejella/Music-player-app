/* Unit test for js/coverart.js — builds a minimal ID3v2.3 tag with an APIC
   frame and asserts the extractor pulls the embedded image out. */
import assert from 'node:assert';
import { extractCoverArt } from '../js/coverart.js';

const pic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);          // fake PNG signature
const apicBody = Buffer.concat([
  Buffer.from([0x00]),                                      // text encoding
  Buffer.from('image/png\0', 'latin1'),                    // MIME
  Buffer.from([0x03]),                                     // picture type (cover front)
  Buffer.from([0x00]),                                     // empty description
  pic,
]);
const sz = apicBody.length;
const frame = Buffer.concat([
  Buffer.from('APIC', 'latin1'),
  Buffer.from([(sz >>> 24) & 255, (sz >>> 16) & 255, (sz >>> 8) & 255, sz & 255]),
  Buffer.from([0, 0]),
  apicBody,
]);
const t = frame.length;
const tag = Buffer.concat([
  Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0]),
  Buffer.from([(t >>> 21) & 0x7f, (t >>> 14) & 0x7f, (t >>> 7) & 0x7f, t & 0x7f]),
  frame,
  Buffer.from('FAKEAUDIO'),
]);

const url = await extractCoverArt(new Blob([tag], { type: 'audio/mpeg' }));
assert.ok(url && url.startsWith('blob:'), 'should return a blob URL for embedded art');

const noTag = await extractCoverArt(new Blob([Buffer.from('no id3 here')]));
assert.equal(noTag, null, 'files without an ID3 tag return null');

console.log('coverart.test.mjs — extraction + no-tag fallback pass ✓');
