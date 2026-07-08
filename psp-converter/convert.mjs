// Core MP4 → PSP conversion logic: presets, ffmpeg argument builder,
// probing, conversion with progress, and .THM thumbnail generation.
//
// The PSP (firmware 3.30+, i.e. any PSP updated this millennium) plays
// MP4 files from the /VIDEO folder on the Memory Stick as long as they are:
//   video: H.264/AVC Baseline Profile, level 3.0, yuv420p, ≤ 720×480, ≤ 30 fps
//   audio: AAC-LC, 44.1/48 kHz, stereo
// An optional 160×120 JPEG with the same basename and a .THM extension
// becomes the thumbnail in the PSP's video menu.

import { spawn } from 'node:child_process';

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

// Scale to fit inside the preset frame (keeping aspect ratio, even
// dimensions for yuv420p) then pad to the exact frame size so the PSP
// gets a fixed, supported resolution.
export function buildVideoFilter(width, height) {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease:` +
         `force_divisible_by=2,pad=${width}:${height}:-1:-1:color=black`;
}

export function buildFfmpegArgs({ input, output, preset, sourceFps = 0 }) {
  const p = typeof preset === 'string' ? PRESETS[preset] : preset;
  if (!p) throw new Error(`Unknown preset: ${preset}`);
  return [
    '-y', '-i', input,
    '-c:v', 'libx264',
    '-profile:v', 'baseline',
    '-level', '3.0',
    '-pix_fmt', 'yuv420p',
    '-vf', buildVideoFilter(p.width, p.height),
    '-b:v', `${p.videoBitrate}k`,
    '-maxrate', `${Math.round(p.videoBitrate * 1.5)}k`,
    '-bufsize', `${p.videoBitrate * 2}k`,
    // The PSP tops out at ~30 fps; only resample when the source exceeds it.
    ...(sourceFps > PSP_MAX_FPS ? ['-r', '29.97'] : []),
    '-c:a', 'aac',
    '-b:a', `${p.audioBitrate}k`,
    '-ar', '44100',
    '-ac', '2',
    '-movflags', '+faststart',
    '-f', 'mp4',
    '-progress', 'pipe:1', '-nostats', '-loglevel', 'error',
    output,
  ];
}

// Keep names the Memory Stick's FAT filesystem (and the PSP menu) can show.
export function sanitizeBaseName(name) {
  const base = name.replace(/\.[^.]*$/, '');
  const safe = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim() || 'video';
  return safe.slice(0, 64);
}

export function parseFps(rate) {
  // ffprobe reports frame rates as fractions like "30000/1001".
  const m = /^(\d+)\/(\d+)$/.exec(rate || '');
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
  const n = Number(rate);
  return Number.isFinite(n) ? n : 0;
}

export async function probe(input) {
  const args = [
    '-v', 'error', '-print_format', 'json',
    '-show_format', '-show_streams', input,
  ];
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

// Convert `input` to a PSP-playable MP4 at `output`.
// onProgress(seconds) is called as ffmpeg reports encoded time.
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

// Write a 160×120 JPEG thumbnail (the PSP's .THM format) grabbed from
// a representative point in the video.
export async function makeThumbnail(input, thmPath, duration = 0) {
  const seek = Math.min(duration > 2 ? duration * 0.2 : 0, 60);
  const args = [
    '-y', '-ss', seek.toFixed(2), '-i', input,
    '-frames:v', '1',
    '-vf', buildVideoFilter(160, 120),
    '-q:v', '4', '-f', 'mjpeg',
    '-loglevel', 'error',
    thmPath,
  ];
  await run('ffmpeg', args);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (c) => { stdout += c; });
    proc.stderr.on('data', (c) => { stderr += c; });
    proc.on('error', (err) => {
      reject(err.code === 'ENOENT'
        ? new Error(`${cmd} not found — install FFmpeg (https://ffmpeg.org) and make sure it is on your PATH`)
        : err);
    });
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim().slice(-2000)}`));
    });
  });
}
