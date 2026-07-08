#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
//  PSP VIDEO CONVERTER — single-file edition
//
//  Converts any video FFmpeg can read (MP4, MKV, MOV, AVI, WebM…) into an
//  MP4 the PlayStation Portable plays, plus the .THM menu thumbnail.
//
//  Needs: Node 18+  and  FFmpeg on your PATH (https://ffmpeg.org)
//         mac: brew install ffmpeg   ubuntu/debian: sudo apt install ffmpeg
//         windows: winget install ffmpeg   (then reopen the terminal)
//
//  Web app:   node psp-video-converter.mjs
//             → open http://localhost:8090, drop a video on the page
//
//  Terminal:  node psp-video-converter.mjs movie.mp4
//             node psp-video-converter.mjs *.mkv -p hq -o /path/to/VIDEO
//             node psp-video-converter.mjs --list        (show presets)
//
//  Then copy name.MP4 + name.THM into the VIDEO folder at the root of the
//  PSP's Memory Stick (Settings → USB Connection) and play from
//  Video → Memory Stick on the XMB. Works on firmware 3.30+.
// ─────────────────────────────────────────────────────────────────────────

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

// ══════════════════════════════════ conversion core ══════════════════════

export const PRESETS = {
  native: {
    label: 'PSP Native (480×272)',
    description: 'Matches the PSP screen exactly. Best balance of quality and size.',
    width: 480, height: 272, videoBitrate: 768, audioBitrate: 128,
  },
  hq: {
    label: 'High Quality (480×272)',
    description: 'Same resolution, double the bitrate. For fast-motion video.',
    width: 480, height: 272, videoBitrate: 1500, audioBitrate: 160,
  },
  small: {
    label: 'Small Size (368×208)',
    description: 'Fits the most video on a Memory Stick.',
    width: 368, height: 208, videoBitrate: 384, audioBitrate: 96,
  },
  tv: {
    label: 'TV Out (720×480)',
    description: 'Full-resolution for PSP-2000/3000 video-out to a TV.',
    width: 720, height: 480, videoBitrate: 2500, audioBitrate: 160,
  },
};
export const DEFAULT_PRESET = 'native';
const PSP_MAX_FPS = 30;

export function buildVideoFilter(width, height) {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease:` +
         `force_divisible_by=2,pad=${width}:${height}:-1:-1:color=black`;
}

export function buildFfmpegArgs({ input, output, preset, sourceFps = 0 }) {
  const p = typeof preset === 'string' ? PRESETS[preset] : preset;
  if (!p) throw new Error(`Unknown preset: ${preset}`);
  return [
    '-y', '-i', input,
    '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0',
    '-pix_fmt', 'yuv420p',
    '-vf', buildVideoFilter(p.width, p.height),
    '-b:v', `${p.videoBitrate}k`,
    '-maxrate', `${Math.round(p.videoBitrate * 1.5)}k`,
    '-bufsize', `${p.videoBitrate * 2}k`,
    ...(sourceFps > PSP_MAX_FPS ? ['-r', '29.97'] : []),
    '-c:a', 'aac', '-b:a', `${p.audioBitrate}k`, '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    '-f', 'mp4',
    '-progress', 'pipe:1', '-nostats', '-loglevel', 'error',
    output,
  ];
}

export function sanitizeBaseName(name) {
  const base = name.replace(/\.[^.]*$/, '');
  const safe = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim() || 'video';
  return safe.slice(0, 64);
}

export function parseFps(rate) {
  const m = /^(\d+)\/(\d+)$/.exec(rate || '');
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
  const n = Number(rate);
  return Number.isFinite(n) ? n : 0;
}

export async function probe(input) {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input];
  const { stdout } = await run('ffprobe', args);
  const info = JSON.parse(stdout);
  const video = (info.streams || []).find((s) => s.codec_type === 'video');
  if (!video) throw new Error('No video stream found in input file');
  return {
    duration: Number(info.format?.duration) || 0,
    width: video.width,
    height: video.height,
    fps: parseFps(video.avg_frame_rate) || parseFps(video.r_frame_rate),
    videoCodec: video.codec_name,
  };
}

export function convert({ input, output, preset, sourceFps, onProgress }) {
  const args = buildFfmpegArgs({ input, output, preset, sourceFps });
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let buffered = '';
    proc.stdout.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) {
        const m = /^out_time_us=(\d+)/.exec(line.trim());
        if (m && onProgress) onProgress(Number(m[1]) / 1e6);
      }
    });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim().slice(-2000)}`));
    });
  });
}

export async function makeThumbnail(input, thmPath, duration = 0) {
  const seek = Math.min(duration > 2 ? duration * 0.2 : 0, 60);
  await run('ffmpeg', [
    '-y', '-ss', seek.toFixed(2), '-i', input,
    '-frames:v', '1', '-vf', buildVideoFilter(160, 120),
    '-q:v', '4', '-f', 'mjpeg', '-loglevel', 'error',
    thmPath,
  ]);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (c) => { stdout += c; });
    proc.stderr.on('data', (c) => { stderr += c; });
    proc.on('error', (err) => {
      reject(err.code === 'ENOENT' ? new Error(ffmpegMissingMessage(cmd)) : err);
    });
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim().slice(-2000)}`));
    });
  });
}

function ffmpegMissingMessage(cmd = 'ffmpeg') {
  return `${cmd} was not found on your PATH.

The converter needs FFmpeg (free, https://ffmpeg.org/download.html):
  macOS:           brew install ffmpeg
  Ubuntu/Debian:   sudo apt install ffmpeg
  Windows:         winget install ffmpeg    (then reopen the terminal)

After installing, run this program again.`;
}

function checkFfmpegOrExit() {
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (r.error && r.error.code === 'ENOENT') {
    console.error('✖ ' + ffmpegMissingMessage());
    process.exit(1);
  }
}

// ═══════════════════════════════ zip writer (STORE) ══════════════════════

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZip(entries, now = new Date()) {
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const day = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);

    offset += 30 + nameBytes.length + size;
  }

  const centralSize = centralParts.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

// ═══════════════════════════════ embedded web UI ═════════════════════════
// One page, styles and script inlined. The script avoids backticks so the
// whole page can live inside this template literal.

const INDEX_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PSP Video Converter</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='10' y='3' rx='2' fill='%23111'/%3E%3Crect x='4' y='5' width='8' height='6' rx='1' fill='%234aa8ff'/%3E%3C/svg%3E">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--accent:#4aa8ff;--accent-dim:#2b6cb0;--text:#eef3fa;--text-dim:#9fb2c8;
--panel:rgba(255,255,255,.06);--panel-border:rgba(255,255,255,.14)}
html,body{min-height:100%}
body{font-family:"Segoe UI",-apple-system,"Helvetica Neue",Arial,sans-serif;color:var(--text);
background:linear-gradient(160deg,#06122b 0%,#0b2a5e 45%,#123a7a 70%,#0a1f47 100%);
background-attachment:fixed;display:flex;justify-content:center;padding:2rem 1rem 4rem;
position:relative;overflow-x:hidden}
.wave{position:fixed;inset:auto 0 0 0;height:40vh;pointer-events:none;opacity:.5;z-index:0}
.wave svg{width:100%;height:100%}
.wave path{fill:rgba(120,180,255,.12);stroke:rgba(140,195,255,.55);stroke-width:2;
filter:drop-shadow(0 0 12px rgba(90,160,255,.7));animation:drift 14s ease-in-out infinite alternate}
@keyframes drift{from{transform:translateX(-3%) scaleY(1)}to{transform:translateX(3%) scaleY(1.12)}}
main{width:100%;max-width:620px;position:relative;z-index:1}
header{text-align:center;margin-bottom:1.75rem}
h1{font-weight:300;font-size:2rem;letter-spacing:.04em}
.psp-logo{font-weight:800;font-style:italic;letter-spacing:.12em;
background:linear-gradient(180deg,#fff,#8fbfff);-webkit-background-clip:text;
background-clip:text;color:transparent;margin-right:.35rem}
.tagline{color:var(--text-dim);margin-top:.4rem;font-size:.95rem}
.dropzone{border:2px dashed var(--panel-border);border-radius:14px;background:var(--panel);
padding:2.2rem 1rem;text-align:center;cursor:pointer;
transition:border-color .15s,background .15s,transform .1s}
.dropzone:hover,.dropzone:focus-visible{border-color:var(--accent)}
.dropzone.dragover{border-color:var(--accent);background:rgba(74,168,255,.12);transform:scale(1.01)}
.dropzone.has-file{border-style:solid;border-color:var(--accent-dim)}
.dz-icon{font-size:1.8rem;width:3.2rem;height:3.2rem;line-height:3.2rem;margin:0 auto .8rem;
border-radius:50%;background:rgba(74,168,255,.18);color:var(--accent)}
.dz-hint{color:var(--text-dim);font-size:.85rem;margin-top:.5rem}
.dz-filename{font-weight:600;word-break:break-all}
.dz-filesize{color:var(--text-dim);font-size:.85rem;margin-top:.3rem}
.options{margin:1.4rem 0 .4rem}
.options label{display:block;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;
color:var(--text-dim);margin-bottom:.4rem}
select{width:100%;padding:.7rem .9rem;border-radius:10px;border:1px solid var(--panel-border);
background:#0d234d;color:var(--text);font-size:1rem;appearance:none}
select:focus{outline:2px solid var(--accent)}
.preset-desc{color:var(--text-dim);font-size:.85rem;margin-top:.45rem;min-height:1.2em}
.convert-btn{width:100%;margin-top:1.2rem;padding:.95rem;font-size:1.05rem;font-weight:600;
letter-spacing:.03em;color:#04162e;background:linear-gradient(180deg,#7cc0ff,var(--accent));
border:none;border-radius:10px;cursor:pointer;transition:filter .15s,transform .1s}
.convert-btn:hover:not(:disabled){filter:brightness(1.1)}
.convert-btn:active:not(:disabled){transform:translateY(1px)}
.convert-btn:disabled{opacity:.35;cursor:default}
.status{margin-top:1.6rem}
.progress-track{height:12px;border-radius:6px;background:rgba(255,255,255,.1);overflow:hidden}
.progress-bar{height:100%;width:0%;border-radius:6px;
background:linear-gradient(90deg,var(--accent-dim),var(--accent));
box-shadow:0 0 10px rgba(74,168,255,.8);transition:width .3s ease}
#status-text{margin-top:.6rem;color:var(--text-dim);text-align:center;font-size:.9rem}
.result,.error{margin-top:1.8rem;background:var(--panel);border:1px solid var(--panel-border);
border-radius:14px;padding:1.4rem}
.result h2{font-weight:400;font-size:1.2rem;color:#9ff0b5}
.error h2{font-weight:400;font-size:1.2rem;color:#ff9a9a}
.downloads{display:flex;flex-wrap:wrap;gap:.6rem;margin:1rem 0 1.2rem}
.dl{display:inline-block;padding:.6rem 1rem;border-radius:8px;border:1px solid var(--panel-border);
background:rgba(255,255,255,.08);color:var(--text);text-decoration:none;font-size:.92rem;
cursor:pointer;transition:background .15s}
.dl:hover{background:rgba(255,255,255,.16)}
.dl.primary{background:linear-gradient(180deg,#7cc0ff,var(--accent));color:#04162e;
font-weight:600;border:none}
.dl.primary:hover{filter:brightness(1.1)}
.howto{margin-left:1.2rem;color:var(--text-dim);font-size:.92rem}
.howto li{margin-bottom:.45rem}
.howto code,.howto strong{color:var(--text)}
.error pre{white-space:pre-wrap;word-break:break-word;font-size:.8rem;color:#ffc9c9;
background:rgba(0,0,0,.3);border-radius:8px;padding:.8rem;margin:.8rem 0 1rem;
max-height:12rem;overflow-y:auto}
footer{margin-top:2.2rem;text-align:center}
footer p{color:var(--text-dim);font-size:.8rem;line-height:1.5}
</style>
</head>
<body>
<div class="wave" aria-hidden="true">
<svg viewBox="0 0 1440 320" preserveAspectRatio="none">
<path d="M0,192 C240,96 480,288 720,192 C960,96 1200,256 1440,160 L1440,320 L0,320 Z"/>
</svg>
</div>
<main>
<header>
<h1><span class="psp-logo">PSP</span> Video Converter</h1>
<p class="tagline">Turn any MP4 into a video your PlayStation&nbsp;Portable can play.</p>
</header>
<section id="drop" class="dropzone" tabindex="0" role="button" aria-label="Choose a video file to convert">
<div class="dz-inner">
<div class="dz-icon">⬆</div>
<p><strong>Drop an MP4 here</strong> or tap to choose a file</p>
<p class="dz-hint">MP4, MOV, MKV, AVI, WebM — anything FFmpeg can read</p>
</div>
<input type="file" id="file" accept="video/*,.mkv,.avi,.mov,.webm,.mp4" hidden>
</section>
<section class="options">
<label for="preset">Quality preset</label>
<select id="preset"></select>
<p id="preset-desc" class="preset-desc"></p>
</section>
<button id="convert" class="convert-btn" disabled>Convert for PSP</button>
<section id="status" class="status" hidden>
<div class="progress-track"><div id="bar" class="progress-bar"></div></div>
<p id="status-text">Uploading…</p>
</section>
<section id="result" class="result" hidden>
<h2>✔ Ready for your PSP</h2>
<div class="downloads">
<a id="dl-zip" class="dl primary" download>Download PSP package (.zip)</a>
<a id="dl-mp4" class="dl" download>Video only (.MP4)</a>
<a id="dl-thm" class="dl" download>Thumbnail (.THM)</a>
</div>
<ol class="howto">
<li>Connect the PSP with USB (<em>Settings → USB Connection</em>) or use a Memory&nbsp;Stick reader.</li>
<li>Unzip the package to the <strong>root</strong> of the Memory Stick — it creates/uses the <code>VIDEO</code> folder.</li>
<li>On the PSP, open <strong>Video → Memory Stick</strong> and press ✕ to play.</li>
</ol>
</section>
<section id="error" class="error" hidden>
<h2>✖ Conversion failed</h2>
<pre id="error-text"></pre>
<button id="retry" class="dl">Start over</button>
</section>
<footer>
<p>Runs locally — your videos never leave this machine. Output: H.264 Baseline + AAC,
playable on any PSP with firmware 3.30 or later.</p>
</footer>
</main>
<script>
// (no backticks in here — this script lives inside a template literal)
var drop = document.getElementById('drop');
var fileInput = document.getElementById('file');
var presetSelect = document.getElementById('preset');
var presetDesc = document.getElementById('preset-desc');
var convertBtn = document.getElementById('convert');
var statusEl = document.getElementById('status');
var statusText = document.getElementById('status-text');
var bar = document.getElementById('bar');
var resultEl = document.getElementById('result');
var errorEl = document.getElementById('error');
var errorText = document.getElementById('error-text');
var selectedFile = null;
var presets = {};

fetch('/api/presets').then(function (r) { return r.json(); }).then(function (data) {
  presets = data.presets;
  Object.keys(presets).forEach(function (name) {
    var p = presets[name];
    var opt = document.createElement('option');
    opt.value = name;
    opt.textContent = p.label + ' — ' + p.videoBitrate + ' kbps';
    if (name === data.default) opt.selected = true;
    presetSelect.appendChild(opt);
  });
  updatePresetDesc();
});

presetSelect.addEventListener('change', updatePresetDesc);
function updatePresetDesc() {
  var p = presets[presetSelect.value];
  presetDesc.textContent = p ? p.description : '';
}

drop.addEventListener('click', function () { fileInput.click(); });
drop.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', function () {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});
['dragover', 'dragenter'].forEach(function (ev) {
  drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('dragover'); });
});
['dragleave', 'drop'].forEach(function (ev) {
  drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('dragover'); });
});
drop.addEventListener('drop', function (e) {
  var file = e.dataTransfer.files[0];
  if (file) setFile(file);
});

function setFile(file) {
  selectedFile = file;
  drop.classList.add('has-file');
  drop.querySelector('.dz-inner').innerHTML =
    '<div class="dz-icon">🎬</div><p class="dz-filename"></p>' +
    '<p class="dz-filesize">' + formatSize(file.size) + ' — tap to change</p>';
  drop.querySelector('.dz-filename').textContent = file.name;
  convertBtn.disabled = false;
  resultEl.hidden = true;
  errorEl.hidden = true;
}

convertBtn.addEventListener('click', function () {
  if (!selectedFile) return;
  convertBtn.disabled = true;
  resultEl.hidden = true;
  errorEl.hidden = true;
  statusEl.hidden = false;
  setProgress(0, 'Uploading…');
  var params = new URLSearchParams({ name: selectedFile.name, preset: presetSelect.value });
  fetch('/api/convert?' + params.toString(), { method: 'POST', body: selectedFile })
    .then(function (res) {
      if (!res.ok) return res.json().then(function (e) { throw new Error(e.error || 'Upload failed'); });
      return res.json();
    })
    .then(function (data) { watchProgress(data.id); })
    .catch(function (err) { showError(err.message); });
});

function watchProgress(id) {
  var source = new EventSource('/api/progress/' + id);
  source.onmessage = function (e) {
    var job = JSON.parse(e.data);
    if (job.status === 'converting') {
      setProgress(job.percent, 'Converting… ' + job.percent + '%');
    } else if (job.status === 'done') {
      source.close();
      setProgress(100, 'Done!');
      showResult(id);
    } else if (job.status === 'error') {
      source.close();
      showError(job.error || 'Unknown error');
    }
  };
  source.onerror = function () {
    source.close();
    showError('Lost connection to the converter server.');
  };
}

function setProgress(percent, text) {
  bar.style.width = percent + '%';
  statusText.textContent = text;
}
function showResult(id) {
  statusEl.hidden = true;
  resultEl.hidden = false;
  convertBtn.disabled = false;
  document.getElementById('dl-zip').href = '/api/file/' + id + '/zip';
  document.getElementById('dl-mp4').href = '/api/file/' + id + '/mp4';
  document.getElementById('dl-thm').href = '/api/file/' + id + '/thm';
}
function showError(message) {
  statusEl.hidden = true;
  errorEl.hidden = false;
  errorText.textContent = message;
  convertBtn.disabled = false;
}
document.getElementById('retry').addEventListener('click', function () { errorEl.hidden = true; });
function formatSize(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return Math.ceil(bytes / 1e3) + ' KB';
}
</script>
</body>
</html>`;

// ═══════════════════════════════════ server ══════════════════════════════

const jobs = new Map();

function startServer(port) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psp-convert-'));
  process.on('exit', () => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(INDEX_HTML);
      }
      if (req.method === 'GET' && url.pathname === '/api/presets') {
        return sendJson(res, 200, { presets: PRESETS, default: DEFAULT_PRESET });
      }
      if (req.method === 'POST' && url.pathname === '/api/convert') {
        return await handleConvert(req, res, url, workDir);
      }
      let m = /^\/api\/progress\/([a-f0-9]+)$/.exec(url.pathname);
      if (req.method === 'GET' && m) return handleProgress(req, res, m[1]);
      m = /^\/api\/file\/([a-f0-9]+)\/(mp4|thm|zip)$/.exec(url.pathname);
      if (req.method === 'GET' && m) return await handleFile(res, m[1], m[2]);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
      else res.end();
    }
  });

  server.listen(port, () => {
    console.log('▶ PSP Video Converter running.');
    console.log(`  Open  http://localhost:${port}  in your browser and drop a video on the page.`);
    console.log('  (Ctrl+C to stop. Tip: you can also convert straight from the terminal —');
    console.log('   run this file with --help to see how.)');
  });
}

async function handleConvert(req, res, url, workDir) {
  const presetName = url.searchParams.get('preset') || DEFAULT_PRESET;
  if (!PRESETS[presetName]) return sendJson(res, 400, { error: `Unknown preset: ${presetName}` });

  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(workDir, id);
  await fsp.mkdir(dir, { recursive: true });

  const originalName = url.searchParams.get('name') || 'video.mp4';
  const base = sanitizeBaseName(originalName);
  const inputPath = path.join(dir, 'input' + (path.extname(originalName) || '.mp4'));

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(inputPath);
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    req.on('error', reject);
  });

  const job = {
    status: 'converting', percent: 0, error: null, base,
    mp4Path: path.join(dir, `${base}.MP4`),
    thmPath: path.join(dir, `${base}.THM`),
    listeners: new Set(),
  };
  jobs.set(id, job);
  runJob(job, inputPath, presetName);
  sendJson(res, 200, { id });
}

async function runJob(job, inputPath, presetName) {
  try {
    const info = await probe(inputPath);
    await convert({
      input: inputPath,
      output: job.mp4Path,
      preset: presetName,
      sourceFps: info.fps,
      onProgress: (seconds) => {
        job.percent = info.duration > 0
          ? Math.min(99, Math.round((seconds / info.duration) * 100)) : 0;
        broadcast(job);
      },
    });
    await makeThumbnail(inputPath, job.thmPath, info.duration);
    await fsp.rm(inputPath, { force: true });
    job.status = 'done';
    job.percent = 100;
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
  }
  broadcast(job);
}

function handleProgress(req, res, id) {
  const job = jobs.get(id);
  if (!job) return sendJson(res, 404, { error: 'Unknown job' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  job.listeners.add(res);
  req.on('close', () => job.listeners.delete(res));
  sendEvent(res, job);
}

function broadcast(job) {
  for (const res of job.listeners) sendEvent(res, job);
}

function sendEvent(res, job) {
  const payload = { status: job.status, percent: job.percent, error: job.error, base: job.base };
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (job.status !== 'converting') res.end();
}

async function handleFile(res, id, kind) {
  const job = jobs.get(id);
  if (!job || job.status !== 'done') return sendJson(res, 404, { error: 'Not ready' });

  if (kind === 'zip') {
    const [mp4, thm] = await Promise.all([fsp.readFile(job.mp4Path), fsp.readFile(job.thmPath)]);
    const zip = buildZip([
      { name: `VIDEO/${job.base}.MP4`, data: mp4 },
      { name: `VIDEO/${job.base}.THM`, data: thm },
    ]);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': zip.length,
      'Content-Disposition': contentDisposition(`${job.base}-psp.zip`),
    });
    return res.end(zip);
  }

  const filePath = kind === 'mp4' ? job.mp4Path : job.thmPath;
  const stat = await fsp.stat(filePath);
  res.writeHead(200, {
    'Content-Type': kind === 'mp4' ? 'video/mp4' : 'image/jpeg',
    'Content-Length': stat.size,
    'Content-Disposition': contentDisposition(`${job.base}.${kind.toUpperCase()}`),
  });
  fs.createReadStream(filePath).pipe(res);
}

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

// ═════════════════════════════════════ CLI ═══════════════════════════════

function usage() {
  console.log(`PSP Video Converter — one file, two ways to use it:

  Web app:   node ${path.basename(process.argv[1])}
             then open http://localhost:8090 and drop a video on the page

  Terminal:  node ${path.basename(process.argv[1])} <input.mp4> [more inputs...] [options]

Options:
  -o, --out <dir>      output directory (default: alongside each input)
  -p, --preset <name>  ${Object.keys(PRESETS).join(' | ')}   (default: ${DEFAULT_PRESET})
  --port <n>           web app port (default: 8090)
  --no-thumb           skip the .THM thumbnail
  -l, --list           list presets and exit
  -h, --help           show this help

Copy the resulting .MP4 and .THM into the VIDEO folder at the root of the
PSP's Memory Stick, then play from Video → Memory Stick on the XMB.`);
}

function listPresets() {
  for (const [name, p] of Object.entries(PRESETS)) {
    const def = name === DEFAULT_PRESET ? '  (default)' : '';
    console.log(`  ${name.padEnd(8)} ${p.label} — video ${p.videoBitrate}k, audio ${p.audioBitrate}k${def}`);
    console.log(`  ${' '.repeat(8)} ${p.description}`);
  }
}

function parseArgs(argv) {
  const opts = { inputs: [], out: null, preset: DEFAULT_PRESET, thumb: true, port: 8090 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else if (a === '-l' || a === '--list') { listPresets(); process.exit(0); }
    else if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (a === '-p' || a === '--preset') opts.preset = argv[++i];
    else if (a === '--port') opts.port = Number(argv[++i]) || 8090;
    else if (a === '--no-thumb') opts.thumb = false;
    else if (a.startsWith('-')) throw new Error(`Unknown option: ${a} (try --help)`);
    else opts.inputs.push(a);
  }
  if (!PRESETS[opts.preset]) {
    throw new Error(`Unknown preset "${opts.preset}". Available: ${Object.keys(PRESETS).join(', ')}`);
  }
  return opts;
}

function drawProgress(label, percent) {
  const width = 28;
  const filled = Math.round((percent / 100) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  process.stderr.write(`\r  ${bar} ${String(percent).padStart(3)}%  ${label}`);
}

async function convertOne(input, opts) {
  const preset = PRESETS[opts.preset];
  const base = sanitizeBaseName(path.basename(input));
  const outDir = opts.out || path.dirname(path.resolve(input));
  await fsp.mkdir(outDir, { recursive: true });
  const mp4Path = path.join(outDir, `${base}.MP4`);
  const thmPath = path.join(outDir, `${base}.THM`);

  if (path.resolve(mp4Path) === path.resolve(input)) {
    throw new Error(`Output would overwrite input: ${input} — use -o to pick another directory`);
  }

  const info = await probe(input);
  console.log(`\n${path.basename(input)}  (${info.width}×${info.height}, ` +
    `${info.fps ? info.fps.toFixed(2) + ' fps, ' : ''}${formatDuration(info.duration)})`);
  console.log(`  → ${mp4Path}  [${preset.label}]`);

  await convert({
    input, output: mp4Path, preset, sourceFps: info.fps,
    onProgress: (seconds) => {
      const pct = info.duration > 0
        ? Math.min(99, Math.round((seconds / info.duration) * 100)) : 0;
      drawProgress(base, pct);
    },
  });
  drawProgress(base, 100);
  process.stderr.write('\n');

  if (opts.thumb) {
    await makeThumbnail(input, thmPath, info.duration);
    console.log(`  → ${thmPath}  (thumbnail)`);
  }
}

function formatDuration(s) {
  if (!s) return 'unknown length';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ═══════════════════════════════════ main ════════════════════════════════

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    checkFfmpegOrExit();
    if (opts.inputs.length === 0) {
      startServer(opts.port);
    } else {
      for (const input of opts.inputs) await convertOne(input, opts);
      console.log('\n✔ Done. Copy the .MP4 (and .THM) files into the /VIDEO folder');
      console.log('  at the root of your PSP\'s Memory Stick, then find them under');
      console.log('  Video → Memory Stick on the XMB.');
    }
  } catch (err) {
    process.stderr.write('\n');
    console.error(`✖ ${err.message}`);
    process.exit(1);
  }
}
