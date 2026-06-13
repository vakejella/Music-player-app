/* ===================================================================
   app.js — main controller, wires UI -> Player / Playlist / EQ / Visualizer
   =================================================================== */

import { Player } from './player.js';
import { Visualizer } from './visualizer.js';
import { Equalizer } from './equalizer.js';
import { Playlist, formatTime } from './playlist.js';
import { generateDemoTracks } from './demo.js';

const $ = (id) => document.getElementById(id);

const player = new Player();
const visualizer = new Visualizer($('visualizer'), player);
const playlist = new Playlist($('playlist'), $('plCount'), $('plTotalTime'));
const equalizer = new Equalizer(player, $('eqBands'), $('preamp'), $('eqPreset'));

let showRemaining = false;
let eqEnabled = true;
let seeking = false;

/* ---------------- Track loading & playback ---------------- */

function loadAndPlay(track) {
  if (!track) return;
  player.load(track.url);
  setTrackTitle(track.title);
  player.play();
}

function setTrackTitle(title) {
  const idx = playlist.currentIndex;
  const prefix = idx >= 0 ? `${idx + 1}. ` : '';
  $('trackTitle').textContent = `${prefix}${title}`;
}

function playCurrentOrFirst() {
  if (playlist.current) { loadAndPlay(playlist.current); return; }
  if (playlist.tracks.length) loadAndPlay(playlist.setCurrent(0));
}

/* ---------------- Transport buttons ---------------- */

$('playBtn').addEventListener('click', () => {
  if (!playlist.current && playlist.tracks.length === 0) { openFiles(); return; }
  if (player.audio.src && player.paused && player.currentTime > 0) { player.play(); return; }
  playCurrentOrFirst();
});

$('pauseBtn').addEventListener('click', () => player.toggle());
$('stopBtn').addEventListener('click', () => { player.stop(); updatePlayingState(); });
$('nextBtn').addEventListener('click', () => { const t = playlist.next(); if (t) loadAndPlay(t); });
$('prevBtn').addEventListener('click', () => { const t = playlist.prev(); if (t) loadAndPlay(t); });
$('ejectBtn').addEventListener('click', openFiles);

/* ---------------- Player events ---------------- */

player.addEventListener('ended', () => {
  const t = playlist.advanceOnEnd();
  if (t) loadAndPlay(t);
  else updatePlayingState();
});

player.addEventListener('loadedmetadata', () => {
  if (playlist.current && player.duration) {
    playlist.updateDuration(playlist.current.id, player.duration);
  }
});

player.addEventListener('play', updatePlayingState);
player.addEventListener('pause', updatePlayingState);

player.addEventListener('timeupdate', () => {
  if (seeking) return;
  const cur = player.currentTime;
  const dur = player.duration;
  $('timeDisplay').textContent = showRemaining && dur
    ? '-' + formatTime(dur - cur)
    : formatTime(cur);
  $('seekBar').value = dur ? String(Math.floor((cur / dur) * 1000)) : '0';
});

player.addEventListener('playerror', () => {
  $('trackTitle').textContent = 'Tap ▶ to start playback (browser blocked autoplay)';
});

function updatePlayingState() {
  const playing = !player.paused;
  $('playBtn').classList.toggle('playing', playing);
  const marquee = $('trackMarquee');
  marquee.classList.toggle('paused', !playing);
  $('stereoDisplay').classList.toggle('on', playing);
  if (playing) {
    visualizer.start();
    $('kbpsDisplay').textContent = '320';
    $('khzDisplay').textContent = '44';
  } else {
    visualizer.stop();
  }
}

/* ---------------- Seek ---------------- */

const seekBar = $('seekBar');
const beginSeek = () => { seeking = true; };
const endSeek = () => {
  player.seekFraction(parseInt(seekBar.value, 10) / 1000);
  seeking = false;
};
seekBar.addEventListener('input', () => {
  if (player.duration) {
    const t = (parseInt(seekBar.value, 10) / 1000) * player.duration;
    $('timeDisplay').textContent = formatTime(t);
  }
});
['mousedown', 'touchstart'].forEach((e) => seekBar.addEventListener(e, beginSeek));
['mouseup', 'touchend', 'change'].forEach((e) => seekBar.addEventListener(e, endSeek));

/* ---------------- Volume & balance ---------------- */

$('volume').addEventListener('input', (e) => player.setVolume(e.target.value / 100));
player.setVolume(0.8);
$('balance').addEventListener('input', (e) => player.setBalance(e.target.value / 100));

/* ---------------- LCD time toggle ---------------- */

$('timeDisplay').addEventListener('click', () => { showRemaining = !showRemaining; });

/* ---------------- Visualizer mode ---------------- */

$('visModeBtn').addEventListener('click', () => {
  const mode = visualizer.cycleMode();
  $('visModeBtn').textContent = mode.toUpperCase();
});

/* ---------------- Toggles: shuffle / repeat / window collapse ---------------- */

$('shuffleBtn').addEventListener('click', (e) => {
  playlist.shuffle = !playlist.shuffle;
  e.currentTarget.classList.toggle('active', playlist.shuffle);
});

const repeatBtn = $('repeatBtn');
repeatBtn.addEventListener('click', () => {
  playlist.repeat = playlist.repeat === 'none' ? 'all' : (playlist.repeat === 'all' ? 'one' : 'none');
  repeatBtn.classList.toggle('active', playlist.repeat !== 'none');
  repeatBtn.textContent = playlist.repeat === 'one' ? 'REP1' : 'REP';
});

$('eqToggle').addEventListener('click', (e) => {
  const collapsed = $('eqWindow').classList.toggle('collapsed');
  e.currentTarget.classList.toggle('active', !collapsed);
});
$('plToggle').addEventListener('click', (e) => {
  const collapsed = $('plWindow').classList.toggle('collapsed');
  e.currentTarget.classList.toggle('active', !collapsed);
});

/* ---------------- EQ on/off + presets ---------------- */

const eqOnBtn = $('eqOnBtn');
eqOnBtn.classList.add('active');
eqOnBtn.addEventListener('click', () => {
  eqEnabled = !eqEnabled;
  eqOnBtn.classList.toggle('active', eqEnabled);
  equalizer.setEnabled(eqEnabled);
});
$('eqAutoBtn').addEventListener('click', () => equalizer.applyPreset('flat'));

/* ---------------- Playlist interactions ---------------- */

playlist.addEventListener('play', (e) => loadAndPlay(e.detail));
playlist.addEventListener('change', () => playlist.render());

$('addBtn').addEventListener('click', openFiles);
$('clearBtn').addEventListener('click', () => { player.stop(); playlist.clear(); updatePlayingState(); $('trackTitle').textContent = 'Winamp Mobile — load a track to begin ★'; });
$('addDemoBtn').addEventListener('click', () => {
  const wasEmpty = playlist.tracks.length === 0;
  playlist.addMany(generateDemoTracks());
  if (wasEmpty) playlist.setCurrent(0);
});

/* ---------------- File input & drag/drop ---------------- */

const fileInput = $('fileInput');
function openFiles() { fileInput.click(); }

fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

function addFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('audio/') || /\.(mp3|ogg|wav|m4a|aac|flac|opus)$/i.test(f.name));
  if (!files.length) return;
  const wasEmpty = playlist.tracks.length === 0;
  const tracks = files.map((f) => ({
    title: f.name.replace(/\.[^.]+$/, ''),
    url: URL.createObjectURL(f),
    isObjectURL: true,
    duration: 0,
  }));
  playlist.addMany(tracks);
  if (wasEmpty) playlist.setCurrent(0);
}

// Drag & drop on desktop.
const dropOverlay = $('dropOverlay');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; dropOverlay.hidden = false; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dropOverlay.hidden = true; dragDepth = 0; } });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

/* ---------------- About modal ---------------- */

$('aboutBtn').addEventListener('click', () => { $('aboutModal').hidden = false; });
$('aboutClose').addEventListener('click', () => { $('aboutModal').hidden = true; });
$('aboutModal').addEventListener('click', (e) => { if (e.target === $('aboutModal')) $('aboutModal').hidden = true; });

/* ---------------- Media Session (lock-screen controls) ---------------- */

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => player.play());
  navigator.mediaSession.setActionHandler('pause', () => player.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => { const t = playlist.prev(); if (t) loadAndPlay(t); });
  navigator.mediaSession.setActionHandler('nexttrack', () => { const t = playlist.next(); if (t) loadAndPlay(t); });
  player.addEventListener('play', () => {
    if (playlist.current) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: playlist.current.title,
        artist: 'Winamp Mobile',
        album: 'Local Library',
      });
    }
  });
}

/* ---------------- Keyboard shortcuts (desktop testing) ---------------- */

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  switch (e.key) {
    case ' ': case 'x': e.preventDefault(); player.toggle(); break;
    case 'b': case 'ArrowRight': { const t = playlist.next(); if (t) loadAndPlay(t); break; }
    case 'z': case 'ArrowLeft':  { const t = playlist.prev(); if (t) loadAndPlay(t); break; }
    case 'v': player.stop(); updatePlayingState(); break;
  }
});

/* ---------------- Service worker (PWA offline) ---------------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* Initial paint */
playlist.render();
visualizer._clear();
