/* ===================================================================
   visualizer.js — classic Winamp spectrum analyzer & oscilloscope
   Renders to a small canvas using data from an AnalyserNode.
   =================================================================== */

const MODES = ['bars', 'scope', 'off'];

export class Visualizer {
  constructor(canvas, player) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.player = player;
    this.mode = 'bars';
    this.running = false;
    this._raf = null;
    this._peaks = [];     // peak-hold positions for bars
    this.colors = null;   // optional skin viscolor palette (24 × [r,g,b])
    this._handleResize();
    window.addEventListener('resize', () => this._handleResize());
  }

  _handleResize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = h;
  }

  /** Use a classic skin's viscolor palette (24 RGB triples). */
  setColors(colors) { this.colors = colors && colors.length >= 24 ? colors : null; }

  _rgb(i) { const c = this.colors[i]; return `rgb(${c[0]},${c[1]},${c[2]})`; }

  cycleMode() {
    const i = MODES.indexOf(this.mode);
    this.mode = MODES[(i + 1) % MODES.length];
    if (this.mode === 'off') this._clear();
    return this.mode;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._draw();
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _clear() {
    this.ctx.fillStyle = this.colors ? this._rgb(0) : '#000';
    this.ctx.fillRect(0, 0, this.W, this.H);
  }

  _barGradient() {
    const grad = this.ctx.createLinearGradient(0, this.H, 0, 0);
    if (this.colors) {
      // Skin spectrum colors live at indices 2..17 (bottom -> top).
      for (let i = 0; i < 16; i++) grad.addColorStop(i / 15, this._rgb(2 + i));
    } else {
      grad.addColorStop(0.0, '#00b341');
      grad.addColorStop(0.55, '#3cff6e');
      grad.addColorStop(0.8, '#ffd24a');
      grad.addColorStop(1.0, '#ff4a3c');
    }
    return grad;
  }

  _draw() {
    const analyser = this.player.analyserNode;
    this._clear();
    if (!analyser || this.mode === 'off') return;

    if (this.mode === 'bars') this._drawBars(analyser);
    else this._drawScope(analyser);
  }

  _drawBars(analyser) {
    const bins = analyser.frequencyBinCount;
    const data = new Uint8Array(bins);
    analyser.getByteFrequencyData(data);

    const bars = 19;                       // classic Winamp = 19 bands
    const gap = 1;
    const barW = (this.W - (bars - 1) * gap) / bars;
    const step = Math.floor(bins / bars);

    for (let i = 0; i < bars; i++) {
      // Average a slice of bins for this band.
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j];
      const v = (sum / step) / 255;
      const barH = Math.max(1, v * this.H);
      const x = i * (barW + gap);
      const y = this.H - barH;

      // Vertical gradient: green -> yellow -> red (or skin viscolor).
      this.ctx.fillStyle = this._barGradient();
      this.ctx.fillRect(x, y, barW, barH);

      // Peak-hold dot that slowly falls.
      const peak = this._peaks[i] || 0;
      const newPeak = Math.max(barH, peak - 1.2);
      this._peaks[i] = newPeak;
      this.ctx.fillStyle = this.colors ? this._rgb(23) : '#d8ffe2';
      this.ctx.fillRect(x, this.H - newPeak - 2, barW, 2);
    }
  }

  _drawScope(analyser) {
    const len = analyser.fftSize;
    const data = new Uint8Array(len);
    analyser.getByteTimeDomainData(data);

    this.ctx.lineWidth = 1.5;
    this.ctx.strokeStyle = this.colors ? this._rgb(18) : '#3cff6e';
    this.ctx.shadowColor = '#00ff5f';
    this.ctx.shadowBlur = this.colors ? 0 : 4;
    this.ctx.beginPath();
    const slice = this.W / len;
    for (let i = 0; i < len; i++) {
      const v = data[i] / 128.0;       // 0..2, centered at 1
      const y = (v * this.H) / 2;
      const x = i * slice;
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;
  }
}
