/* ===================================================================
   player.js — Web Audio engine
   Wraps an <audio> element and routes it through a gain/balance node,
   a 10-band biquad EQ chain, and an AnalyserNode for visualization.
   =================================================================== */

export const EQ_FREQUENCIES = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];

export class Player extends EventTarget {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.audio.crossOrigin = 'anonymous';

    this.ctx = null;
    this.source = null;
    this.gainNode = null;
    this.panNode = null;
    this.preampNode = null;
    this.eqBands = [];
    this.analyser = null;
    this._graphBuilt = false;

    this._wireAudioEvents();
  }

  /* Lazily build the audio graph on first user gesture (autoplay policy). */
  _ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    this.source = this.ctx.createMediaElementSource(this.audio);

    this.preampNode = this.ctx.createGain();

    // Build 10 peaking biquad filters in series.
    this.eqBands = EQ_FREQUENCIES.map((freq, i) => {
      const f = this.ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : (i === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking');
      f.frequency.value = freq;
      f.Q.value = 1.0;
      f.gain.value = 0;
      return f;
    });

    this.panNode = this.ctx.createStereoPanner
      ? this.ctx.createStereoPanner()
      : null;

    this.gainNode = this.ctx.createGain();

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;

    // Chain: source -> preamp -> eq[0..9] -> pan -> gain -> analyser -> destination
    let node = this.source.connect(this.preampNode);
    this.eqBands.forEach((band) => { node = node.connect(band); });
    if (this.panNode) node = node.connect(this.panNode);
    node = node.connect(this.gainNode);
    node.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this._graphBuilt = true;
  }

  async resume() {
    this._ensureContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  _wireAudioEvents() {
    const fwd = (name) => this.audio.addEventListener(name, () => this.dispatchEvent(new Event(name)));
    ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange', 'error', 'waiting', 'playing'].forEach(fwd);
  }

  async load(url) {
    this.audio.src = url;
    this.audio.load();
  }

  async play() {
    await this.resume();
    try {
      await this.audio.play();
    } catch (err) {
      this.dispatchEvent(new CustomEvent('playerror', { detail: err }));
    }
  }

  pause() { this.audio.pause(); }

  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  toggle() {
    if (this.audio.paused) this.play();
    else this.pause();
  }

  seekFraction(frac) {
    if (this.duration) this.audio.currentTime = frac * this.duration;
  }

  setVolume(v) {              // 0..1
    this.audio.volume = Math.max(0, Math.min(1, v));
  }

  setBalance(b) {             // -1..1
    if (this.panNode) this.panNode.pan.value = Math.max(-1, Math.min(1, b));
  }

  setPreamp(db) {
    if (this.preampNode) this.preampNode.gain.value = Math.pow(10, db / 20);
  }

  setBandGain(index, db) {
    if (this.eqBands[index]) this.eqBands[index].gain.value = db;
  }

  get paused() { return this.audio.paused; }
  get duration() { return this.audio.duration || 0; }
  get currentTime() { return this.audio.currentTime || 0; }
  get analyserNode() { return this.analyser; }
}
