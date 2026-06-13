/* ===================================================================
   equalizer.js — 10-band graphic EQ UI + presets
   =================================================================== */

import { EQ_FREQUENCIES } from './player.js';

// Gains in dB for each of the 10 bands. Inspired by Winamp's presets.
export const PRESETS = {
  flat:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  rock:      [5, 4, 3, 1, -1, -1, 2, 3, 4, 5],
  pop:       [-1, 2, 4, 5, 3, 0, -1, -1, 1, 2],
  jazz:      [4, 3, 1, 2, -1, -1, 0, 1, 3, 4],
  classical: [5, 4, 3, 2, -1, -1, 0, 2, 3, 4],
  dance:     [6, 5, 2, 0, 0, -2, -3, -3, 1, 3],
  bass:      [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  treble:    [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
  vocal:     [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
};

const BAND_LABELS = ['60', '170', '310', '600', '1k', '3k', '6k', '12k', '14k', '16k'];

export class Equalizer {
  constructor(player, container, preampEl, presetSelect) {
    this.player = player;
    this.container = container;
    this.preampEl = preampEl;
    this.presetSelect = presetSelect;
    this.sliders = [];
    this.enabled = true;
    this._build();
  }

  _build() {
    EQ_FREQUENCIES.forEach((freq, i) => {
      const band = document.createElement('div');
      band.className = 'eq-band';

      const label = document.createElement('span');
      label.className = 'eq-band-label';
      label.textContent = BAND_LABELS[i];

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'eq-slider';
      slider.min = '-12';
      slider.max = '12';
      slider.step = '0.5';
      slider.value = '0';
      slider.setAttribute('orient', 'vertical');
      slider.setAttribute('aria-label', `${BAND_LABELS[i]} Hz`);

      slider.addEventListener('input', () => {
        this._apply(i, parseFloat(slider.value));
        this.presetSelect.value = ''; // user override → custom
      });

      band.append(label, slider);
      this.container.appendChild(band);
      this.sliders.push(slider);
    });

    this.preampEl.addEventListener('input', () => {
      this.player.setPreamp(this.enabled ? parseFloat(this.preampEl.value) : 0);
    });

    this.presetSelect.addEventListener('change', () => {
      if (PRESETS[this.presetSelect.value]) this.applyPreset(this.presetSelect.value);
    });
  }

  _apply(index, db) {
    this.player.setBandGain(index, this.enabled ? db : 0);
  }

  applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    preset.forEach((db, i) => {
      this.sliders[i].value = String(db);
      this._apply(i, db);
    });
    this.presetSelect.value = name;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    // Re-apply current slider values (or flatten when off).
    this.sliders.forEach((s, i) => this._apply(i, parseFloat(s.value)));
    this.player.setPreamp(enabled ? parseFloat(this.preampEl.value) : 0);
  }
}
