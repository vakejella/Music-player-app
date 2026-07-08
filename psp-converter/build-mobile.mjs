#!/usr/bin/env node
// Builds the single-file mobile edition of the PSP Video Converter:
// injects a base64-encoded ffmpeg.wasm engine (@ffmpeg/core-st) into
// mobile-template.html, producing one self-contained HTML file (~33 MB)
// that converts videos entirely in the browser.
//
//   node psp-converter/build-mobile.mjs
//   → psp-converter/dist/psp-video-converter-mobile.html
//
// Needs network access on first run (npm fetches the engine, ~25 MB).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_PKG = '@ffmpeg/core-st@0.11.1';

const cacheDir = path.join(os.tmpdir(), 'psp-mobile-engine');
const distCore = path.join(cacheDir, 'node_modules', '@ffmpeg', 'core-st', 'dist');

if (!fs.existsSync(path.join(distCore, 'ffmpeg-core.wasm'))) {
  console.log(`Fetching ${CORE_PKG} (~25 MB, one-time)…`);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'package.json'), '{"name":"engine-cache","private":true}');
  execFileSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', CORE_PKG],
    { cwd: cacheDir, stdio: 'inherit' });
}

// The engine is embedded gzipped (the browser inflates it with
// DecompressionStream) — that halves the size of the built file.
const gz = (buf) => zlib.gzipSync(buf, { level: 9 });
const coreJs = fs.readFileSync(path.join(distCore, 'ffmpeg-core.js'));
const wasm = fs.readFileSync(path.join(distCore, 'ffmpeg-core.wasm'));
const template = fs.readFileSync(path.join(__dirname, 'mobile-template.html'), 'utf8');

const html = template
  .replace('__CORE_JS_GZ_B64__', gz(coreJs).toString('base64'))
  .replace('__WASM_GZ_B64__', gz(wasm).toString('base64'));

const outDir = path.join(__dirname, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'psp-video-converter-mobile.html');
fs.writeFileSync(outPath, html);

console.log(`✔ Built ${outPath} (${(html.length / 1e6).toFixed(1)} MB)`);
console.log('  Send this one file to a phone; open it in Chrome; convert away.');
