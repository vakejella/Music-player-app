/* ===================================================================
   skin.js — apply a classic Winamp skin (.wsz) to the main window.

   Classic skins are sprite sheets at fixed coordinates. This module
   knows the canonical layout of Winamp 2.x's main window and paints
   each UI element from the matching slice of the matching BMP.

   Geometry (where each control sits) lives in CSS; this module only
   swaps the *graphics* (background-image + sprite offset) and parses
   the palette files (viscolor.txt, pledit.txt).
   =================================================================== */

/* --- Winamp bitmap font (text.bmp): 5x6 px glyphs, 3 rows --- */
const CHAR_W = 5, CHAR_H = 6;
const FONT_ROWS = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ"@ ',
  "0123456789….:()-'!_+\\/[]^&%,=$#",
  'ÅÖÄ?*  ',
];
const CHAR_MAP = (() => {
  const m = {};
  FONT_ROWS.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) m[row[c]] = [c, r];
  });
  return m;
})();
function glyph(ch) {
  const up = ch.toUpperCase();
  return CHAR_MAP[up] || CHAR_MAP[ch] || CHAR_MAP[' '];
}

/* --- numbers.bmp digit slice (9x13) --- */
const DIGIT_W = 9, DIGIT_H = 13;

/* --- Sprite targets: which BMP + offset paints which element. --------
   `a` is the pressed/active sprite offset (optional).               */
const TARGETS = [
  { sel: '#skTitlebar', bmp: 'titlebar.bmp', x: 27, y: 15 },

  { sel: '#skPrev',  bmp: 'cbuttons.bmp', x: 0,   y: 0,  a: [0,   18] },
  { sel: '#skPlay',  bmp: 'cbuttons.bmp', x: 23,  y: 0,  a: [23,  18] },
  { sel: '#skPause', bmp: 'cbuttons.bmp', x: 46,  y: 0,  a: [46,  18] },
  { sel: '#skStop',  bmp: 'cbuttons.bmp', x: 69,  y: 0,  a: [69,  18] },
  { sel: '#skNext',  bmp: 'cbuttons.bmp', x: 92,  y: 0,  a: [92,  18] },
  { sel: '#skEject', bmp: 'cbuttons.bmp', x: 114, y: 0,  a: [114, 16] },

  { sel: '#skShuffle', bmp: 'shufrep.bmp', x: 28, y: 0, on: [28, 15] },
  { sel: '#skRepeat',  bmp: 'shufrep.bmp', x: 0,  y: 0, on: [0,  15] },
  { sel: '#skEqBtn',   bmp: 'shufrep.bmp', x: 0,  y: 61, on: [0,  73] },
  { sel: '#skPlBtn',   bmp: 'shufrep.bmp', x: 23, y: 61, on: [23, 73] },
];

const NEEDED = ['main.bmp', 'titlebar.bmp', 'cbuttons.bmp', 'shufrep.bmp',
  'numbers.bmp', 'nums_ex.bmp', 'text.bmp', 'monoster.bmp', 'playpaus.bmp',
  'posbar.bmp', 'volume.bmp', 'balance.bmp', 'eqmain.bmp', 'pledit.bmp'];

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export class ClassicSkin {
  constructor() {
    this.urls = [];
    this.images = new Map();   // 'cbuttons.bmp' -> HTMLImageElement
    this.viscolor = defaultVisColors();
    this.name = '';
  }

  destroy() {
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
  }

  /** files: Map(lowercase name -> Uint8Array) from wsz.readSkinArchive */
  async apply(files, name = 'Skin') {
    this.destroy();
    this.name = name;
    this.images.clear();

    // Build images for every BMP we know how to use.
    await Promise.all(NEEDED.map(async (fname) => {
      const data = files.get(fname);
      if (!data) return;
      const blob = new Blob([data], { type: 'image/bmp' });
      const url = URL.createObjectURL(blob);
      this.urls.push(url);
      const img = await loadImage(url);
      if (img) this.images.set(fname, img);
    }));

    // viscolor.txt (24 lines of "r,g,b")
    const vis = files.get('viscolor.txt');
    if (vis) this.viscolor = parseVisColor(new TextDecoder().decode(vis));

    // pledit.txt (playlist colors) -> CSS vars
    const pl = files.get('pledit.txt');
    if (pl) applyPlEditColors(new TextDecoder().decode(pl));

    this._paintMain();
    this._paintEq();
    this._paintPlaylist();
    this._paintArt();
    this._paintTargets();
    document.documentElement.classList.add('skinned');
    return this;
  }

  /** Cut a single sprite out of a sheet so it can be tiled with background-repeat. */
  _extractSprite(name, x, y, w, h) {
    const img = this.images.get(name);
    if (!img) return '';
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
    return c.toDataURL('image/png');
  }

  _paintPlaylist() {
    const img = this.images.get('pledit.bmp');
    if (!img) return;
    const sheet = `url("${img.src}")`;
    const place = (id, x, y) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.backgroundImage = sheet;
      el.style.backgroundPosition = `-${x}px -${y}px`;
    };
    place('skPlTL', 0, 0);       // top-left corner
    place('skPlTitle', 26, 0);   // centre title ("PLAYLIST")
    place('skPlTR', 153, 0);     // top-right corner (window buttons)
    place('skPlBL', 0, 72);      // bottom-left corner (file buttons)
    place('skPlBR', 126, 72);    // bottom-right corner (transport + load)

    const topTile = this._extractSprite('pledit.bmp', 127, 0, 25, 20);
    document.querySelectorAll('.skpl-tfill').forEach((e) => {
      e.style.backgroundImage = `url("${topTile}")`;
      e.style.backgroundRepeat = 'repeat-x';
    });
    const leftTile = this._extractSprite('pledit.bmp', 0, 42, 12, 29);
    const lEl = document.getElementById('skPlLeft');
    if (lEl) { lEl.style.backgroundImage = `url("${leftTile}")`; lEl.style.backgroundRepeat = 'repeat-y'; }
    const rightTile = this._extractSprite('pledit.bmp', 31, 42, 20, 29);
    const rEl = document.getElementById('skPlRight');
    if (rEl) { rEl.style.backgroundImage = `url("${rightTile}")`; rEl.style.backgroundRepeat = 'repeat-y'; }
  }

  hasPl() { return this.images.has('pledit.bmp'); }

  _paintArt() {
    const img = this.images.get('pledit.bmp');
    if (!img) return;
    const sheet = `url("${img.src}")`;
    const place = (id, x, y) => {
      const el = document.getElementById(id);
      if (el) { el.style.backgroundImage = sheet; el.style.backgroundPosition = `-${x}px -${y}px`; }
    };
    place('skArtTL', 0, 0);
    place('skArtTR', 153, 0);
    const top = this._extractSprite('pledit.bmp', 127, 0, 25, 20);
    document.querySelectorAll('.skart-tfill').forEach((e) => {
      e.style.backgroundImage = `url("${top}")`; e.style.backgroundRepeat = 'repeat-x';
    });
    const bottom = document.getElementById('skArtBottom');
    if (bottom) { bottom.style.backgroundImage = `url("${top}")`; bottom.style.backgroundRepeat = 'repeat-x'; }
    const left = this._extractSprite('pledit.bmp', 0, 42, 12, 29);
    const lEl = document.getElementById('skArtLeft');
    if (lEl) { lEl.style.backgroundImage = `url("${left}")`; lEl.style.backgroundRepeat = 'repeat-y'; }
    const right = this._extractSprite('pledit.bmp', 31, 42, 20, 29);
    const rEl = document.getElementById('skArtRight');
    if (rEl) { rEl.style.backgroundImage = `url("${right}")`; rEl.style.backgroundRepeat = 'repeat-y'; }

    // Title color adapts to the titlebar brightness so it's readable on any skin.
    const titleEl = document.querySelector('.skart-title');
    if (titleEl) {
      const dark = this._spriteLuma('pledit.bmp', 127, 0, 25, 20) < 130;
      titleEl.style.color = dark ? '#eef2fb' : '#172540';
      titleEl.style.textShadow = dark ? '0 1px 1px rgba(0,0,0,0.7)' : '0 1px 0 rgba(255,255,255,0.45)';
    }
  }

  _paintMain() {
    const main = document.getElementById('skMain');
    const img = this.images.get('main.bmp');
    if (main && img) main.style.backgroundImage = `url("${img.src}")`;
  }

  _paintEq() {
    const img = this.images.get('eqmain.bmp');
    const win = document.getElementById('skEqWin');
    const tb = document.getElementById('skEqTitlebar');
    if (win && img) win.style.backgroundImage = `url("${img.src}")`;
    if (tb && img) {
      tb.style.backgroundImage = `url("${img.src}")`;
      tb.style.backgroundPosition = '0 -134px';   // EQ title bar sprite
    }
    // Use the skin's own EQ slider thumb (the little handle/knob at 0,164).
    if (img) {
      const thumb = this._extractSprite('eqmain.bmp', 0, 164, 11, 11);
      document.documentElement.style.setProperty('--eq-thumb', `url("${thumb}")`);
      // Cover each band channel with a clean slice of its own channel so any
      // knobs the skin baked into the EQ background don't double up.
      document.querySelectorAll('.sk-eqchan').forEach((el) => {
        const x = parseInt(el.dataset.x, 10);
        el.style.backgroundImage = `url("${this._extractSprite('eqmain.bmp', x, 38, 14, 4)}")`;
        el.style.backgroundRepeat = 'repeat-y';
      });
    }
  }

  /** Average luminance of a sprite region (0..255) — for adaptive contrast. */
  _spriteLuma(name, x, y, w, h) {
    const img = this.images.get(name);
    if (!img) return 128;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return sum / (d.length / 4);
  }

  hasEq() { return this.images.has('eqmain.bmp'); }

  _paintTargets() {
    for (const t of TARGETS) {
      const el = document.querySelector(t.sel);
      const img = this.images.get(t.bmp);
      if (!el || !img) continue;
      el.style.backgroundImage = `url("${img.src}")`;
      el.style.setProperty('--sx', `-${t.x}px`);
      el.style.setProperty('--sy', `-${t.y}px`);
      if (t.a) {
        el.style.setProperty('--ax', `-${t.a[0]}px`);
        el.style.setProperty('--ay', `-${t.a[1]}px`);
      }
      if (t.on) {
        el.dataset.offX = `-${t.x}px`; el.dataset.offY = `-${t.y}px`;
        el.dataset.onX = `-${t.on[0]}px`; el.dataset.onY = `-${t.on[1]}px`;
      }
    }
  }

  /** Toggle a shufrep-style button between off / on sprite. */
  setToggle(sel, on) {
    const el = document.querySelector(sel);
    if (!el || !el.dataset.onX) return;
    el.style.setProperty('--sx', on ? el.dataset.onX : el.dataset.offX);
    el.style.setProperty('--sy', on ? el.dataset.onY : el.dataset.offY);
  }

  /** Render a HH:MM style time string into a digit canvas (numbers.bmp). */
  renderTime(canvas, str) {
    const img = this.images.get('numbers.bmp') || this.images.get('nums_ex.bmp');
    if (!img || !canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let dx = 0;
    for (const ch of str) {
      if (ch >= '0' && ch <= '9') {
        const d = ch.charCodeAt(0) - 48;
        ctx.drawImage(img, d * DIGIT_W, 0, DIGIT_W, DIGIT_H, dx, 0, DIGIT_W, DIGIT_H);
      }
      // colon/space are baked into main.bmp; just advance.
      dx += ch === ':' ? 3 : DIGIT_W + 1;
    }
  }

  /** Render scrolling track text into a canvas using text.bmp font. */
  renderText(canvas, text, scroll = 0) {
    const img = this.images.get('text.bmp');
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!img) return false;
    const start = Math.floor(scroll / CHAR_W);
    const offset = -(scroll % CHAR_W);
    let dx = offset;
    const cols = Math.ceil(canvas.width / CHAR_W) + 1;
    for (let i = 0; i <= cols; i++) {
      const ch = text[(start + i) % text.length] || ' ';
      const [c, r] = glyph(ch);
      ctx.drawImage(img, c * CHAR_W, r * CHAR_H, CHAR_W, CHAR_H, dx, 0, CHAR_W, CHAR_H);
      dx += CHAR_W;
    }
    return true;
  }

  /** Draw short, non-scrolling text once (e.g. the kbps/khz readouts). */
  renderTextStatic(canvas, text) {
    const img = this.images.get('text.bmp');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!img) return;
    let dx = 0;
    for (const ch of text) {
      if (dx + CHAR_W > canvas.width) break;
      const [c, r] = glyph(ch);
      ctx.drawImage(img, c * CHAR_W, r * CHAR_H, CHAR_W, CHAR_H, dx, 0, CHAR_W, CHAR_H);
      dx += CHAR_W;
    }
  }

  hasFont() { return this.images.has('text.bmp'); }
}

/* ---------------- palette helpers ---------------- */

function defaultVisColors() {
  // The classic green Winamp spectrum gradient (bottom -> top).
  const c = [];
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    c.push([Math.round(0 + 255 * Math.max(0, t - 0.6) / 0.4),
            Math.round(120 + 135 * Math.min(1, t)),
            Math.round(40 + 30 * (1 - t))]);
  }
  // indices 16-22 oscilloscope, 23 peak — approximate.
  while (c.length < 24) c.push([60, 255, 110]);
  return c;
}

function parseVisColor(text) {
  const colors = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) colors.push([+m[1], +m[2], +m[3]]);
    if (colors.length >= 24) break;
  }
  return colors.length >= 24 ? colors : defaultVisColors();
}

function applyPlEditColors(text) {
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z]+)\s*=\s*(#?[0-9A-Fa-f]{6})/);
    if (m) map[m[1].toLowerCase()] = m[2].startsWith('#') ? m[2] : '#' + m[2];
  }
  const root = document.documentElement.style;
  if (map.normal)     root.setProperty('--pl-text', map.normal);
  if (map.current)    root.setProperty('--pl-current', map.current);
  if (map.normalbg)   root.setProperty('--pl-bg', map.normalbg);
  if (map.selectedbg) root.setProperty('--pl-selbg', map.selectedbg);
}
