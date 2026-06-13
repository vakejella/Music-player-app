/* ===================================================================
   playlist.js — track list model + rendering, shuffle & repeat logic
   =================================================================== */

export function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export class Playlist extends EventTarget {
  constructor(listEl, countEl, totalEl) {
    super();
    this.listEl = listEl;
    this.countEl = countEl;
    this.totalEl = totalEl;
    this.tracks = [];        // { id, title, url, duration, isObjectURL }
    this.currentIndex = -1;
    this.shuffle = false;
    this.repeat = 'none';    // 'none' | 'one' | 'all'
    this._nextId = 1;

    this.listEl.addEventListener('click', (e) => this._onClick(e));
  }

  add(track) {
    track.id = this._nextId++;
    track.duration = track.duration || 0;
    this.tracks.push(track);
    this.render();
    this.dispatchEvent(new Event('change'));
    return track;
  }

  addMany(tracks) {
    tracks.forEach((t) => {
      t.id = this._nextId++;
      t.duration = t.duration || 0;
      this.tracks.push(t);
    });
    this.render();
    this.dispatchEvent(new Event('change'));
  }

  remove(id) {
    const idx = this.tracks.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [removed] = this.tracks.splice(idx, 1);
    if (removed.isObjectURL) URL.revokeObjectURL(removed.url);
    if (idx === this.currentIndex) this.currentIndex = -1;
    else if (idx < this.currentIndex) this.currentIndex--;
    this.render();
    this.dispatchEvent(new Event('change'));
  }

  clear() {
    this.tracks.forEach((t) => { if (t.isObjectURL) URL.revokeObjectURL(t.url); });
    this.tracks = [];
    this.currentIndex = -1;
    this.render();
    this.dispatchEvent(new Event('change'));
  }

  get current() {
    return this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null;
  }

  setCurrent(index) {
    if (index < 0 || index >= this.tracks.length) return null;
    this.currentIndex = index;
    this.render();
    return this.tracks[index];
  }

  updateDuration(id, duration) {
    const t = this.tracks.find((x) => x.id === id);
    if (t) { t.duration = duration; this.render(); this.dispatchEvent(new Event('change')); }
  }

  next() {
    if (this.tracks.length === 0) return null;
    if (this.shuffle) {
      if (this.tracks.length === 1) return this.setCurrent(0);
      let n;
      do { n = Math.floor(Math.random() * this.tracks.length); }
      while (n === this.currentIndex);
      return this.setCurrent(n);
    }
    let n = this.currentIndex + 1;
    if (n >= this.tracks.length) {
      if (this.repeat === 'all') n = 0;
      else return null;
    }
    return this.setCurrent(n);
  }

  prev() {
    if (this.tracks.length === 0) return null;
    let n = this.currentIndex - 1;
    if (n < 0) n = this.repeat === 'all' ? this.tracks.length - 1 : 0;
    return this.setCurrent(n);
  }

  /* Decide what plays when a track ends naturally. */
  advanceOnEnd() {
    if (this.repeat === 'one') return this.current;
    return this.next();
  }

  _onClick(e) {
    const removeBtn = e.target.closest('.pl-remove');
    if (removeBtn) {
      e.stopPropagation();
      this.remove(Number(removeBtn.dataset.id));
      return;
    }
    const item = e.target.closest('.pl-item');
    if (item) {
      const idx = this.tracks.findIndex((t) => t.id === Number(item.dataset.id));
      if (idx !== -1) {
        this.setCurrent(idx);
        this.dispatchEvent(new CustomEvent('play', { detail: this.tracks[idx] }));
      }
    }
  }

  render() {
    this.listEl.innerHTML = '';
    this.tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = 'pl-item' + (i === this.currentIndex ? ' current' : '');
      li.dataset.id = String(t.id);
      li.innerHTML = `
        <span class="pl-num">${i + 1}.</span>
        <span class="pl-name">${escapeHtml(t.title)}</span>
        <span class="pl-time">${t.duration ? formatTime(t.duration) : '--:--'}</span>
        <button class="pl-remove" data-id="${t.id}" aria-label="Remove">✕</button>`;
      this.listEl.appendChild(li);
    });

    if (this.countEl) {
      this.countEl.textContent = `${this.tracks.length} item${this.tracks.length === 1 ? '' : 's'}`;
    }
    if (this.totalEl) {
      const total = this.tracks.reduce((a, t) => a + (t.duration || 0), 0);
      const played = this.current ? this.current.duration || 0 : 0;
      this.totalEl.textContent = `${formatTime(played)} / ${formatTime(total)}`;
    }
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
