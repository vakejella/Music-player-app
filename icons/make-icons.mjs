/* Generates icon-192.png and icon-512.png with a pure-Node PNG encoder.
   Draws the Winamp Mobile mark: dark panel, green LCD strip, spectrum bars. */
import zlib from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  // rest zero
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const o = (y * size + x) * 4;
    buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a;
  };
  const rect = (x0, y0, w, h, r, g, b) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, r, g, b);
  };
  // vertical gradient background
  for (let y = 0; y < size; y++) {
    const t = y / size;
    const r = Math.round(0x2a * (1 - t) + 0x10 * t);
    const g = Math.round(0x2a * (1 - t) + 0x10 * t);
    const b = Math.round(0x40 * (1 - t) + 0x18 * t);
    for (let x = 0; x < size; x++) set(x, y, r, g, b);
  }
  const s = size / 512;
  // LCD strip
  rect(Math.round(96 * s), Math.round(120 * s), Math.round(320 * s), Math.round(96 * s), 0, 0, 0);
  // "WA" block letters in green (simple pixel rendering)
  const green = [0x3c, 0xff, 0x6e];
  const lcdY = Math.round(150 * s), lcdH = Math.round(40 * s), bw = Math.round(14 * s);
  const drawV = (x) => rect(x, lcdY, bw, lcdH, ...green);
  // W
  let x = Math.round(120 * s);
  drawV(x); rect(x, lcdY + lcdH - bw, Math.round(70 * s), bw, ...green);
  drawV(x + Math.round(28 * s)); drawV(x + Math.round(56 * s));
  // A
  x = Math.round(220 * s);
  drawV(x); drawV(x + Math.round(40 * s));
  rect(x, lcdY, Math.round(54 * s), bw, ...green);
  rect(x, lcdY + Math.round(16 * s), Math.round(54 * s), bw, ...green);

  // Spectrum bars with green->yellow->red gradient
  const bars = [
    [100, 300, 40, 92], [156, 260, 40, 132], [212, 232, 40, 160],
    [268, 280, 40, 112], [324, 248, 40, 144], [380, 312, 32, 80],
  ];
  for (const [bx, by, bwid, bh] of bars) {
    const X = Math.round(bx * s), Y = Math.round(by * s), W = Math.round(bwid * s), H = Math.round(bh * s);
    for (let y = Y; y < Y + H; y++) {
      const f = 1 - (y - Y) / H; // 0 bottom .. 1 top
      let r, g, b;
      if (f < 0.6) { r = 0x00; g = Math.round(0xb3 + (0x3c - 0xb3) * 0); b = 0x41; g = Math.round(0xb3 + (0x3c - 0xb3) * (f / 0.6)); }
      else if (f < 0.85) { r = 0xff; g = 0xd2; b = 0x4a; }
      else { r = 0xff; g = 0x4a; b = 0x3c; }
      for (let xx = X; xx < X + W; xx++) set(xx, y, r, g, b);
    }
  }
  return encodePNG(size, size, buf);
}

writeFileSync(new URL('./icon-192.png', import.meta.url), draw(192));
writeFileSync(new URL('./icon-512.png', import.meta.url), draw(512));
console.log('icons written');
