// Unit tests for the PSP converter's pure logic (no ffmpeg needed).
import assert from 'node:assert/strict';
import {
  PRESETS, DEFAULT_PRESET, buildFfmpegArgs, buildVideoFilter,
  sanitizeBaseName, parseFps,
} from '../psp-converter/convert.mjs';
import { crc32, buildZip } from '../psp-converter/zip.mjs';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✔ ${name}`);
}

console.log('psp.test.mjs');

test('default preset exists and is PSP-native resolution', () => {
  const p = PRESETS[DEFAULT_PRESET];
  assert.ok(p);
  assert.equal(p.width, 480);
  assert.equal(p.height, 272);
});

test('all presets stay within PSP hardware limits (≤720×480)', () => {
  for (const p of Object.values(PRESETS)) {
    assert.ok(p.width <= 720 && p.height <= 480, p.label);
    assert.equal(p.width % 2, 0);
    assert.equal(p.height % 2, 0);
  }
});

test('video filter scales-to-fit and pads to the exact frame', () => {
  const f = buildVideoFilter(480, 272);
  assert.match(f, /scale=480:272:force_original_aspect_ratio=decrease/);
  assert.match(f, /force_divisible_by=2/);
  assert.match(f, /pad=480:272/);
});

test('ffmpeg args encode PSP-safe H.264 baseline + AAC', () => {
  const args = buildFfmpegArgs({ input: 'in.mp4', output: 'out.MP4', preset: 'native' });
  const arg = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(arg('-c:v'), 'libx264');
  assert.equal(arg('-profile:v'), 'baseline');
  assert.equal(arg('-level'), '3.0');
  assert.equal(arg('-pix_fmt'), 'yuv420p');
  assert.equal(arg('-c:a'), 'aac');
  assert.equal(arg('-ar'), '44100');
  assert.equal(arg('-ac'), '2');
  assert.equal(arg('-b:v'), '768k');
  assert.equal(args[args.length - 1], 'out.MP4');
});

test('frame rate is only capped when the source exceeds 30 fps', () => {
  const fast = buildFfmpegArgs({ input: 'a', output: 'b', preset: 'native', sourceFps: 60 });
  assert.ok(fast.includes('-r') && fast[fast.indexOf('-r') + 1] === '29.97');
  const slow = buildFfmpegArgs({ input: 'a', output: 'b', preset: 'native', sourceFps: 23.976 });
  assert.ok(!slow.includes('-r'));
});

test('unknown preset throws', () => {
  assert.throws(() => buildFfmpegArgs({ input: 'a', output: 'b', preset: 'nope' }));
});

test('sanitizeBaseName strips extension and unsafe characters', () => {
  assert.equal(sanitizeBaseName('My Movie.mp4'), 'My Movie');
  assert.equal(sanitizeBaseName('a/b\\c:d*e?f"g<h>i|j.mkv'), 'abcdefghij');
  assert.equal(sanitizeBaseName('???.mp4'), 'video');
  assert.equal(sanitizeBaseName('x'.repeat(200) + '.mp4').length, 64);
});

test('parseFps handles fractions and plain numbers', () => {
  assert.ok(Math.abs(parseFps('30000/1001') - 29.97) < 0.01);
  assert.equal(parseFps('25'), 25);
  assert.equal(parseFps('0/0'), 0);
  assert.equal(parseFps(undefined), 0);
});

test('crc32 matches the known value for "hello"', () => {
  // $ python3 -c "import zlib; print(hex(zlib.crc32(b'hello')))" → 0x3610a686
  assert.equal(crc32(Buffer.from('hello')), 0x3610a686);
});

test('buildZip produces a structurally valid STORE archive', () => {
  const data = Buffer.from('psp video data');
  const zip = buildZip([{ name: 'VIDEO/test.MP4', data }], new Date(2026, 0, 1, 12, 0, 0));
  // Local file header signature at the start
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  // End-of-central-directory signature in the last 22 bytes
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  // Entry count = 1
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 1);
  // Stored data appears verbatim after header (30 bytes) + name
  const nameLen = 'VIDEO/test.MP4'.length;
  assert.deepEqual(zip.subarray(30 + nameLen, 30 + nameLen + data.length), data);
  // CRC in the local header matches
  assert.equal(zip.readUInt32LE(14), crc32(data));
});

console.log(`${passed} tests passed`);
