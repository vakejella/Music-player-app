#!/usr/bin/env node
// Command-line MP4 → PSP converter.
//
//   node psp-converter/cli.mjs video.mp4 [more.mp4 ...] [options]
//
// Options:
//   -o, --out <dir>      output directory (default: alongside each input)
//   -p, --preset <name>  native | hq | small | tv   (default: native)
//   --no-thumb           skip the .THM thumbnail
//   -l, --list           list presets and exit
//   -h, --help           show help

import path from 'node:path';
import fsp from 'node:fs/promises';
import { PRESETS, DEFAULT_PRESET, probe, convert, makeThumbnail, sanitizeBaseName } from './convert.mjs';

function usage() {
  console.log(`Usage: node psp-converter/cli.mjs <input.mp4> [more inputs...] [options]

Converts videos to PSP-playable MP4 (H.264 Baseline + AAC) and writes a
matching .THM thumbnail. Copy both files to the /VIDEO folder of your
PSP's Memory Stick.

Options:
  -o, --out <dir>      output directory (default: alongside each input)
  -p, --preset <name>  ${Object.keys(PRESETS).join(' | ')}   (default: ${DEFAULT_PRESET})
  --no-thumb           skip the .THM thumbnail
  -l, --list           list presets and exit
  -h, --help           show this help`);
}

function listPresets() {
  for (const [name, p] of Object.entries(PRESETS)) {
    const def = name === DEFAULT_PRESET ? '  (default)' : '';
    console.log(`  ${name.padEnd(8)} ${p.label} — video ${p.videoBitrate}k, audio ${p.audioBitrate}k${def}`);
    console.log(`  ${' '.repeat(8)} ${p.description}`);
  }
}

function parseArgs(argv) {
  const opts = { inputs: [], out: null, preset: DEFAULT_PRESET, thumb: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else if (a === '-l' || a === '--list') { listPresets(); process.exit(0); }
    else if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (a === '-p' || a === '--preset') opts.preset = argv[++i];
    else if (a === '--no-thumb') opts.thumb = false;
    else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    else opts.inputs.push(a);
  }
  if (!opts.inputs.length) { usage(); process.exit(1); }
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
    input,
    output: mp4Path,
    preset,
    sourceFps: info.fps,
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

try {
  const opts = parseArgs(process.argv.slice(2));
  for (const input of opts.inputs) await convertOne(input, opts);
  console.log('\n✔ Done. Copy the .MP4 (and .THM) files into the /VIDEO folder');
  console.log('  at the root of your PSP\'s Memory Stick, then find them under');
  console.log('  Video → Memory Stick on the XMB.');
} catch (err) {
  process.stderr.write('\n');
  console.error(`✖ ${err.message}`);
  process.exit(1);
}
