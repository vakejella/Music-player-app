/* Offline renderer: decodes a .wsz skin's BMPs and composites the main + EQ
   windows the same way the app's CSS does, so we can visually verify coords. */
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { readSkinArchive } from '../js/wsz.js';

function decodeBMP(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const off = dv.getUint32(10, true);
  const headerSize = dv.getUint32(14, true);
  const width = dv.getInt32(18, true);
  let height = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  const topDown = height < 0; height = Math.abs(height);
  let clrUsed = dv.getUint32(46, true);
  if (!clrUsed && bpp <= 8) clrUsed = 1 << bpp;
  const palOff = 14 + headerSize;
  const pal = [];
  for (let i = 0; i < clrUsed; i++) {
    const p = palOff + i * 4;
    pal.push([bytes[p + 2], bytes[p + 1], bytes[p]]);
  }
  const rowSize = Math.floor((bpp * width + 31) / 32) * 4;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = topDown ? y : height - 1 - y;
    const rs = off + sy * rowSize;
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      if (bpp === 8) [r, g, b] = pal[bytes[rs + x]] || [0, 0, 0];
      else if (bpp === 4) { const by = bytes[rs + (x >> 1)]; const idx = (x & 1) ? (by & 15) : (by >> 4); [r, g, b] = pal[idx] || [0, 0, 0]; }
      else if (bpp === 24) { const p = rs + x * 3; b = bytes[p]; g = bytes[p + 1]; r = bytes[p + 2]; }
      else if (bpp === 32) { const p = rs + x * 4; b = bytes[p]; g = bytes[p + 1]; r = bytes[p + 2]; }
      const o = (y * width + x) * 4; data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

function canvas(w, h) { return { width: w, height: h, data: new Uint8Array(w * h * 4) }; }
function blit(dst, src, sx, sy, sw, sh, dx, dy) {
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const px = sx + x, py = sy + y; if (px < 0 || py < 0 || px >= src.width || py >= src.height) continue;
    const tx = dx + x, ty = dy + y; if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
    const so = (py * src.width + px) * 4, to = (ty * dst.width + tx) * 4;
    dst.data[to] = src.data[so]; dst.data[to + 1] = src.data[so + 1]; dst.data[to + 2] = src.data[so + 2]; dst.data[to + 3] = 255;
  }
}
function rect(dst, x0, y0, w, h, r, g, b) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) continue;
    const o = (y * dst.width + x) * 4; dst.data[o] = r; dst.data[o + 1] = g; dst.data[o + 2] = b; dst.data[o + 3] = 255;
  }
}
function scale(src, f) {
  const d = canvas(src.width * f, src.height * f);
  for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
    const so = ((y / f | 0) * src.width + (x / f | 0)) * 4, to = (y * d.width + x) * 4;
    d.data[to] = src.data[so]; d.data[to + 1] = src.data[so + 1]; d.data[to + 2] = src.data[so + 2]; d.data[to + 3] = 255;
  }
  return d;
}
function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return ~c>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}
function png(cv){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ih=Buffer.alloc(13);ih.writeUInt32BE(cv.width,0);ih.writeUInt32BE(cv.height,4);ih[8]=8;ih[9]=6;const stride=cv.width*4;const raw=Buffer.alloc((stride+1)*cv.height);for(let y=0;y<cv.height;y++){Buffer.from(cv.data.buffer,cv.data.byteOffset+y*stride,stride).copy(raw,y*(stride+1)+1);}const idat=zlib.deflateSync(raw,{level:9});return Buffer.concat([sig,chunk('IHDR',ih),chunk('IDAT',idat),chunk('IEND',Buffer.alloc(0))]);}

// ---- load skin ----
const buf = readFileSync(process.argv[2] || '/tmp/aqua.wsz');
const files = await readSkinArchive(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const imgs = {};
for (const n of ['main.bmp','eqmain.bmp','titlebar.bmp','cbuttons.bmp','shufrep.bmp','nums_ex.bmp','text.bmp','posbar.bmp','volume.bmp','balance.bmp','monoster.bmp'])
  if (files.get(n)) imgs[n] = decodeBMP(files.get(n));

// ---- MAIN window ----
const main = canvas(275, 116);
blit(main, imgs['main.bmp'], 0, 0, 275, 116, 0, 0);
blit(main, imgs['titlebar.bmp'], 27, 15, 275, 14, 0, 0);                 // active titlebar
// transport (cbuttons normal row)
const cb = [[0,0,23,18,16,88],[23,0,23,18,39,88],[46,0,23,18,62,88],[69,0,23,18,85,88],[92,0,22,18,108,88],[114,0,22,16,136,89]];
for (const [sx,sy,sw,sh,dx,dy] of cb) blit(main, imgs['cbuttons.bmp'], sx, sy, sw, sh, dx, dy);
// shufrep
blit(main, imgs['shufrep.bmp'], 28, 0, 47, 15, 164, 89);                 // shuffle off
blit(main, imgs['shufrep.bmp'], 0, 0, 28, 15, 210, 89);                  // repeat off
blit(main, imgs['shufrep.bmp'], 0, 61, 23, 12, 219, 58);                 // eq btn
blit(main, imgs['shufrep.bmp'], 23, 61, 23, 12, 242, 58);               // pl btn
// time digits (nums_ex) "01:23" starting at window x=36,y=26
let dx = 36; for (const ch of '01:23') { if (ch>='0'&&ch<='9'){const d=ch.charCodeAt(0)-48;blit(main, imgs['nums_ex.bmp'], d*9,0,9,13, dx,26);} dx += ch===':'?3:10; }
// title text (text.bmp 5x6 font) "WINAMP" at 111,27
const FONT=['ABCDEFGHIJKLMNOPQRSTUVWXYZ"@ ',"0123456789….:()-'!_+\\/[]^&%,=$#",'ÅÖÄ?*  '];
const cmap={}; FONT.forEach((row,r)=>{for(let c=0;c<row.length;c++)cmap[row[c]]=[c,r];});
let tx=111; for(const ch of 'WINAMP MOBILE'){const g=cmap[ch.toUpperCase()]||cmap[' '];blit(main, imgs['text.bmp'], g[0]*5,g[1]*6,5,6, tx,27);tx+=5;}
// posbar thumb at mid (track at 16,72; thumb sprite x=248,29x10)
blit(main, imgs['posbar.bmp'], 248,0,29,10, 16+110,72);
// volume thumb (volume.bmp thumb sprite 15,422,14,11) at vol pos ~ x=107+40,y=57
blit(main, imgs['volume.bmp'], 15,422,14,11, 107+40,58);
blit(main, imgs['balance.bmp'], 15,422,14,11, 177+12,58);

writeFileSync((process.argv[3]||'.')+'/preview_main.png', png(scale(main, 3)));

// ---- EQ window ----
const eq = canvas(275, 116);
blit(eq, imgs['eqmain.bmp'], 0, 0, 275, 116, 0, 0);                      // top region = EQ bg
blit(eq, imgs['eqmain.bmp'], 0, 134, 275, 14, 0, 0);                     // EQ titlebar sprite -> top
// EQ slider handles (preamp + 10 bands); at 0 dB the handle centres on the groove (~y68)
const xs=[21,78,96,114,132,150,168,186,204,222,240];
for (const x of xs) { rect(eq, x+1, 64, 13, 7, 205,205,205); rect(eq, x+1, 67, 13, 1, 58,58,58); }
writeFileSync((process.argv[3]||'.')+'/preview_eq.png', png(scale(eq, 3)));

// ---- PLAYLIST window (pledit.bmp tiled to 275 wide) ----
function tileX(d,s,sx,sy,sw,sh,dx,dy,dw){for(let x=0;x<dw;x+=sw)blit(d,s,sx,sy,Math.min(sw,dw-x),sh,dx+x,dy);}
function tileY(d,s,sx,sy,sw,sh,dx,dy,dh){for(let y=0;y<dh;y+=sh)blit(d,s,sx,sy,sw,Math.min(sh,dh-y),dx,dy+y);}
if (files.get('pledit.bmp')) {
  const p = decodeBMP(files.get('pledit.bmp'));
  const W = 275, bodyH = 92, H = 20 + bodyH + 38, pl = canvas(W, H);
  rect(pl, 12, 20, 243, bodyH, 0, 0, 0);                     // list bg
  const tX = Math.round((W - 100) / 2);
  blit(pl, p, 0, 0, 25, 20, 0, 0);                            // top-left
  tileX(pl, p, 127, 0, 25, 20, 25, 0, tX - 25);               // left fill
  blit(pl, p, 26, 0, 100, 20, tX, 0);                         // title
  tileX(pl, p, 127, 0, 25, 20, tX + 100, 0, W - 25 - (tX + 100)); // right fill
  blit(pl, p, 153, 0, 25, 20, W - 25, 0);                     // top-right
  tileY(pl, p, 0, 42, 12, 29, 0, 20, bodyH);                  // left border
  tileY(pl, p, 31, 42, 20, 29, W - 20, 20, bodyH);            // right border
  blit(pl, p, 0, 72, 125, 38, 0, 20 + bodyH);                 // bottom-left
  blit(pl, p, 126, 72, 150, 38, 125, 20 + bodyH);             // bottom-right
  writeFileSync((process.argv[3]||'.')+'/preview_pl.png', png(scale(pl, 3)));

  // Cover-art window frame (same pledit sprites, no bottom corners)
  const AW = 275, abodyH = 150, AH = 20 + abodyH + 3, aw = canvas(AW, AH);
  rect(aw, 12, 20, 243, abodyH, 0, 0, 0);
  blit(aw, p, 0, 0, 25, 20, 0, 0);
  tileX(aw, p, 127, 0, 25, 20, 25, 0, AW - 50);
  blit(aw, p, 153, 0, 25, 20, AW - 25, 0);
  tileY(aw, p, 0, 42, 12, 29, 0, 20, abodyH);
  tileY(aw, p, 31, 42, 20, 29, AW - 20, 20, abodyH);
  tileX(aw, p, 127, 0, 25, 20, 0, 20 + abodyH, AW);
  writeFileSync((process.argv[3]||'.')+'/preview_art.png', png(scale(aw, 3)));
}

console.log('wrote preview_main.png, preview_eq.png, preview_pl.png, preview_art.png');
