/* ===================================================================
   app.js — main controller, wires UI -> Player / Playlist / EQ / Visualizer
   =================================================================== */

import { Player } from './player.js';
import { Visualizer } from './visualizer.js';
import { Equalizer } from './equalizer.js';
import { Playlist, formatTime } from './playlist.js';
import { generateDemoTracks } from './demo.js';
import { readSkinArchive } from './wsz.js';
import { ClassicSkin } from './skin.js';
import { extractCoverArt } from './coverart.js';

const $ = (id) => document.getElementById(id);

const player = new Player();
const visualizer = new Visualizer($('visualizer'), player);
const skVisualizer = new Visualizer($('skVis'), player);   // classic-skin spectrum
const playlist = new Playlist($('playlist'), $('plCount'), $('plTotalTime'));
const equalizer = new Equalizer(player, $('eqBands'), $('preamp'), $('eqPreset'));
const skin = new ClassicSkin();
let skinned = false;

let showRemaining = false;
let eqEnabled = true;
let seeking = false;

/* ---------------- Track loading & playback ---------------- */

function loadAndPlay(track) {
  if (!track) return;
  player.load(track.url);
  setTrackTitle(track.title);
  updateCoverArt(track);
  player.play();
}

/* ---------------- Cover art ---------------- */

let currentArtUrl = null;
async function updateCoverArt(track) {
  const img = $('coverArt');
  const ph = $('artPlaceholder');
  // Resolve the art: manual override > cached > extracted from the file.
  let url = track && track.coverUrl;
  if (url === undefined && track && track.file) {
    url = await extractCoverArt(track.file);
    track.coverUrl = url;                 // cache (null too, so we don't re-parse)
    if (track !== playlist.current) return;   // track changed while parsing
  }
  if (currentArtUrl && currentArtUrl !== url && currentArtUrl.startsWith('blob:')) {
    // only revoke extracted blobs we own and aren't reusing
  }
  if (url) {
    img.src = url;
    img.hidden = false;
    ph.hidden = true;
    setMediaArtwork(url);
    // Hand the art to the native media notification (needs a data URL).
    if (window.AndroidMedia && track) {
      if (track.coverDataUrl) pushNativeMetadata(track);
      else blobUrlToDataUrl(url).then((d) => { track.coverDataUrl = d; pushNativeMetadata(track); }).catch(() => {});
    }
  } else {
    img.hidden = true;
    ph.hidden = false;
    img.removeAttribute('src');
    if (track) pushNativeMetadata(track);
  }
}

function setMediaArtwork(url) {
  if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
    try {
      navigator.mediaSession.metadata.artwork = [{ src: url, sizes: '512x512' }];
    } catch { /* ignore */ }
  }
}

let currentTitleText = 'WINAMP MOBILE   ***   ';
function setTrackTitle(title) {
  const idx = playlist.currentIndex;
  const prefix = idx >= 0 ? `${idx + 1}. ` : '';
  $('trackTitle').textContent = `${prefix}${title}`;
  currentTitleText = `${prefix}${title}   ***   `;
}

/* Classic-skin scrolling title (text.bmp bitmap font). */
let titleScroll = 0;
function classicTitleLoop() {
  if (skinned && skin.hasFont()) {
    if (!player.paused) titleScroll += 0.5;
    skin.renderText($('skTitle'), currentTitleText, Math.floor(titleScroll));
  }
  requestAnimationFrame(classicTitleLoop);
}
requestAnimationFrame(classicTitleLoop);

function playCurrentOrFirst() {
  if (playlist.current) { loadAndPlay(playlist.current); return; }
  if (playlist.tracks.length) loadAndPlay(playlist.setCurrent(0));
}

/* ---------------- Transport actions (shared by modern + classic UI) ---------------- */

function doPlay() {
  if (!playlist.current && playlist.tracks.length === 0) { openFiles(); return; }
  if (player.audio.src && player.paused && player.currentTime > 0) { player.play(); return; }
  playCurrentOrFirst();
}
const doPause = () => player.toggle();
const doStop  = () => { player.stop(); updatePlayingState(); if (window.AndroidMedia) { try { window.AndroidMedia.stop(); } catch { /* ignore */ } } };
const doNext  = () => { const t = playlist.next(); if (t) loadAndPlay(t); };
const doPrev  = () => { const t = playlist.prev(); if (t) loadAndPlay(t); };

function bind(id, fn) { const el = $(id); if (el) el.addEventListener('click', fn); }
bind('playBtn', doPlay);   bind('skPlay', doPlay);
bind('pauseBtn', doPause); bind('skPause', doPause);
bind('stopBtn', doStop);   bind('skStop', doStop);
bind('nextBtn', doNext);   bind('skNext', doNext);
bind('prevBtn', doPrev);   bind('skPrev', doPrev);
bind('ejectBtn', openFiles); bind('skEject', openFiles);
bind('skMenuBtn', () => $('aboutModal').hidden = false);

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
  const timeStr = showRemaining && dur ? '-' + formatTime(dur - cur) : formatTime(cur);
  $('timeDisplay').textContent = timeStr;
  const pos = dur ? String(Math.floor((cur / dur) * 1000)) : '0';
  $('seekBar').value = pos;
  if (skinned) {
    $('skPosbar').value = pos;
    skin.renderTime($('skTime'), timeStr.replace('-', ''));
    skin.renderTextStatic($('skKbps'), '320');
    skin.renderTextStatic($('skKhz'), '44');
  }
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
    (skinned ? skVisualizer : visualizer).start();
    $('kbpsDisplay').textContent = '320';
    $('khzDisplay').textContent = '44';
  } else {
    visualizer.stop();
    skVisualizer.stop();
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

$('volume').addEventListener('input', (e) => { player.setVolume(e.target.value / 100); $('skVolume').value = e.target.value; });
player.setVolume(0.8);
$('balance').addEventListener('input', (e) => { player.setBalance(e.target.value / 100); $('skBalance').value = e.target.value; });

// Classic-skin sliders drive the same player and mirror the modern ones.
$('skVolume').addEventListener('input', (e) => { player.setVolume(e.target.value / 100); $('volume').value = e.target.value; });
$('skBalance').addEventListener('input', (e) => { player.setBalance(e.target.value / 100); $('balance').value = e.target.value; });
const skPosbar = $('skPosbar');
skPosbar.addEventListener('input', () => { seeking = true; });
skPosbar.addEventListener('change', () => { player.seekFraction(parseInt(skPosbar.value, 10) / 1000); seeking = false; });

/* ---------------- LCD time toggle ---------------- */

$('timeDisplay').addEventListener('click', () => { showRemaining = !showRemaining; });

/* ---------------- Visualizer mode ---------------- */

$('visModeBtn').addEventListener('click', () => {
  const mode = visualizer.cycleMode();
  $('visModeBtn').textContent = mode.toUpperCase();
});

/* ---------------- Toggles: shuffle / repeat / window collapse ---------------- */

function toggleShuffle() {
  playlist.shuffle = !playlist.shuffle;
  $('shuffleBtn').classList.toggle('active', playlist.shuffle);
  skin.setToggle('#skShuffle', playlist.shuffle);
}
function toggleRepeat() {
  playlist.repeat = playlist.repeat === 'none' ? 'all' : (playlist.repeat === 'all' ? 'one' : 'none');
  const on = playlist.repeat !== 'none';
  $('repeatBtn').classList.toggle('active', on);
  $('repeatBtn').textContent = playlist.repeat === 'one' ? 'REP1' : 'REP';
  skin.setToggle('#skRepeat', on);
}
bind('shuffleBtn', toggleShuffle); bind('skShuffle', toggleShuffle);
bind('repeatBtn', toggleRepeat);   bind('skRepeat', toggleRepeat);

function toggleEqWindow() {
  if (skinned && skin.hasEq()) {
    const hidden = $('skEqWrap').hidden = !$('skEqWrap').hidden;
    skin.setToggle('#skEqBtn', !hidden);
    return;
  }
  const collapsed = $('eqWindow').classList.toggle('collapsed');
  $('eqToggle').classList.toggle('active', !collapsed);
  skin.setToggle('#skEqBtn', !collapsed);
}
function togglePlWindow() {
  if (skinned && skin.hasPl()) {
    const hidden = $('skPlWrap').hidden = !$('skPlWrap').hidden;
    skin.setToggle('#skPlBtn', !hidden);
    return;
  }
  const collapsed = $('plWindow').classList.toggle('collapsed');
  $('plToggle').classList.toggle('active', !collapsed);
  skin.setToggle('#skPlBtn', !collapsed);
}
bind('eqToggle', toggleEqWindow); bind('skEqBtn', toggleEqWindow);
bind('plToggle', togglePlWindow); bind('skPlBtn', togglePlWindow);

function toggleArtWindow() {
  const collapsed = $('artWindow').classList.toggle('collapsed');
  $('artToggle').classList.toggle('active', !collapsed);
}
bind('artToggle', toggleArtWindow);

// Manual cover art override (e.g. for files without embedded art).
const coverInput = $('coverInput');
$('artSetBtn').addEventListener('click', () => coverInput.click());
coverInput.addEventListener('change', () => {
  const f = coverInput.files[0];
  if (f && playlist.current) {
    playlist.current.coverUrl = URL.createObjectURL(f);
    updateCoverArt(playlist.current);
  }
  coverInput.value = '';
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
$('clearBtn').addEventListener('click', () => { player.stop(); playlist.clear(); updatePlayingState(); $('trackTitle').textContent = 'Winamp Mobile — load a track to begin ★'; updateCoverArt(null); });

// Mirror the playlist into the skinned playlist window + its file buttons.
playlist.addTarget($('skPlList'));
$('skPlAdd').addEventListener('click', openFiles);
$('skPlEject').addEventListener('click', openFiles);
$('skPlRem').addEventListener('click', () => $('clearBtn').click());
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
    file: f,                 // kept so we can read embedded cover art
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
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  const files = Array.from(e.dataTransfer.files);
  const skinFile = files.find((f) => /\.(wsz|zip)$/i.test(f.name));
  if (skinFile) applySkinFile(skinFile);
  const audio = files.filter((f) => f !== skinFile);
  if (audio.length) addFiles(audio);
});

/* ---------------- Classic-skin equalizer (eqmain.bmp) ---------------- */
// 11 vertical sliders (preamp + 10 bands) overlaid on the eqmain background.
const SK_EQ_X = [21, 78, 96, 114, 132, 150, 168, 186, 204, 222, 240];
const skEqSliders = SK_EQ_X.map((x, idx) => {
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.className = 'sk-eqs';
  inp.min = '-12'; inp.max = '12'; inp.step = '0.5'; inp.value = '0';
  inp.style.left = `${x}px`;
  inp.style.top = '40px';
  inp.setAttribute('aria-label', idx === 0 ? 'Preamp' : `EQ band ${idx}`);
  inp.addEventListener('input', () => {
    const target = idx === 0 ? equalizer.preampEl : equalizer.sliders[idx - 1];
    target.value = inp.value;
    target.dispatchEvent(new Event('input'));   // reuse the equalizer's binding
  });
  $('skEqWin').appendChild(inp);
  return inp;
});

function syncSkEq() {
  skEqSliders[0].value = equalizer.preampEl.value;
  equalizer.sliders.forEach((s, i) => { skEqSliders[i + 1].value = s.value; });
}

const SK_PRESETS = ['flat', 'rock', 'pop', 'jazz', 'classical', 'dance', 'bass', 'treble', 'vocal'];
let skPresetIdx = 0;
$('skEqOn').addEventListener('click', () => $('eqOnBtn').click());
$('skEqAuto').addEventListener('click', () => { equalizer.applyPreset('flat'); syncSkEq(); });
$('skEqPreset').addEventListener('click', () => {
  skPresetIdx = (skPresetIdx + 1) % SK_PRESETS.length;
  equalizer.applyPreset(SK_PRESETS[skPresetIdx]);
  syncSkEq();
});
$('eqPreset').addEventListener('change', syncSkEq);

/* ---------------- Winamp skin (.wsz) loading ---------------- */

const skinInput = $('skinInput');
$('loadSkinBtn').addEventListener('click', () => skinInput.click());
$('removeSkinBtn').addEventListener('click', removeSkin);
skinInput.addEventListener('change', () => {
  if (skinInput.files[0]) applySkinFile(skinInput.files[0]);
  skinInput.value = '';
});

async function applySkinFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const files = await readSkinArchive(buf);
    if (!files.get('main.bmp')) throw new Error('No main.bmp — not a classic skin');
    await skin.apply(files, file.name.replace(/\.[^.]+$/, ''));
    enterSkinnedMode();
  } catch (err) {
    alert('Could not load skin: ' + err.message);
  }
}

function enterSkinnedMode() {
  skinned = true;
  $('skWrap').hidden = false;
  $('removeSkinBtn').hidden = false;
  $('loadSkinBtn').textContent = '🎨 CHANGE SKIN';

  // Slider thumbs pulled from the skin's bitmaps. The volume/balance BMPs
  // surround their bars with a transparency-key color (blue here), so we do
  // NOT use them as the track background — main.bmp already draws the slider
  // channels; we only take the thumb sprite from them.
  const url = (n) => { const i = skin.images.get(n); return i ? `url("${i.src}")` : ''; };
  $('skPosbar').style.setProperty('--posbar-img', url('posbar.bmp'));
  $('skVolume').style.setProperty('--thumb-img', url('volume.bmp'));
  $('skBalance').style.setProperty('--thumb-img', url('balance.bmp'));

  // Mirror current state onto the skinned controls.
  $('skVolume').value = $('volume').value;
  $('skBalance').value = $('balance').value;
  skin.setToggle('#skShuffle', playlist.shuffle);
  skin.setToggle('#skRepeat', playlist.repeat !== 'none');
  skin.setToggle('#skEqBtn', !$('eqWindow').classList.contains('collapsed'));
  skin.setToggle('#skPlBtn', !$('plWindow').classList.contains('collapsed'));

  // Skinned EQ window (eqmain.bmp), if the skin provides one.
  if (skin.hasEq()) { $('skEqWrap').hidden = false; syncSkEq(); }
  skin.setToggle('#skEqBtn', skin.hasEq() && !$('skEqWrap').hidden);

  // Skinned playlist window (pledit.bmp).
  if (skin.hasPl()) { $('skPlWrap').hidden = false; }
  skin.setToggle('#skPlBtn', skin.hasPl() && !$('skPlWrap').hidden);

  skVisualizer.setColors(skin.viscolor);
  skin.renderTime($('skTime'), formatTime(player.currentTime));
  skin.renderTextStatic($('skKbps'), '320');
  skin.renderTextStatic($('skKhz'), '44');
  scaleClassic();
  if (!player.paused) { visualizer.stop(); skVisualizer.start(); }
}

function removeSkin() {
  skinned = false;
  document.documentElement.classList.remove('skinned');
  $('skWrap').hidden = true;
  $('skEqWrap').hidden = true;
  $('skPlWrap').hidden = true;
  $('removeSkinBtn').hidden = true;
  $('loadSkinBtn').textContent = '🎨 LOAD .WSZ SKIN';
  skVisualizer.stop();
  if (!player.paused) visualizer.start();
}

function scaleClassic() {
  const wrap = document.querySelector('.winamp');
  const avail = Math.min(wrap.clientWidth - 16, 460);
  const scale = Math.max(1, Math.min(2.4, avail / 275));
  document.documentElement.style.setProperty('--sk-scale', scale.toFixed(3));
  const h = `${Math.ceil(116 * scale)}px`;
  $('skWrap').style.height = h;
  $('skEqWrap').style.height = h;
  $('skPlWrap').style.height = `${Math.ceil(150 * scale)}px`;
}
window.addEventListener('resize', () => { if (skinned) scaleClassic(); });

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

/* ---------------- Native Android media notification bridge ----------------
   The APK wraps this page in a WebView, which (unlike Chrome) does not surface
   a media notification automatically. A native foreground service exposes an
   `AndroidMedia` bridge; we push title/art/playback state to it and accept
   transport commands back via window.__winampMedia. No-op in a browser. */

const NativeMedia = window.AndroidMedia || null;

window.__winampMedia = (command) => {
  switch (command) {
    case 'play':  player.play(); break;
    case 'pause': player.pause(); break;
    case 'next':  doNext(); break;
    case 'prev':  doPrev(); break;
    case 'stop':  doStop(); break;
  }
};

async function blobUrlToDataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function pushNativeMetadata(track) {
  if (!NativeMedia || !track) return;
  try {
    NativeMedia.setMetadata(track.title || 'Winamp Mobile', 'Winamp Mobile',
      track.coverDataUrl || '', player.duration || 0);
  } catch { /* ignore */ }
}

function pushNativePlayback() {
  if (!NativeMedia) return;
  try { NativeMedia.setPlayback(!player.paused, player.currentTime || 0); } catch { /* ignore */ }
}

if (NativeMedia) {
  player.addEventListener('play', pushNativePlayback);
  player.addEventListener('pause', pushNativePlayback);
  player.addEventListener('loadedmetadata', () => pushNativeMetadata(playlist.current));
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
