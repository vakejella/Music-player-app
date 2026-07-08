// Zero-dependency web server for the PSP Video Converter.
//   node psp-converter/server.mjs          → http://localhost:8090
//
// Endpoints:
//   GET  /                        static UI from public/
//   GET  /api/presets             preset table for the UI
//   POST /api/convert?name=&preset=   raw video body → { id }
//   GET  /api/progress/:id        Server-Sent Events progress stream
//   GET  /api/file/:id/mp4|thm|zip    converted outputs

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PRESETS, DEFAULT_PRESET, probe, convert, makeThumbnail, sanitizeBaseName } from './convert.mjs';
import { buildZip } from './zip.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const WORK_DIR = path.join(__dirname, '.work');
const PORT = Number(process.env.PORT) || 8090;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// id → { status: 'converting'|'done'|'error', percent, error, base, dir,
//        mp4Path, thmPath, listeners: Set<res> }
const jobs = new Map();

fs.rmSync(WORK_DIR, { recursive: true, force: true });
fs.mkdirSync(WORK_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/convert') {
      return await handleConvert(req, res, url);
    }
    if (req.method === 'GET' && url.pathname === '/api/presets') {
      return sendJson(res, 200, { presets: PRESETS, default: DEFAULT_PRESET });
    }
    let m = /^\/api\/progress\/([a-f0-9]+)$/.exec(url.pathname);
    if (req.method === 'GET' && m) return handleProgress(req, res, m[1]);
    m = /^\/api\/file\/([a-f0-9]+)\/(mp4|thm|zip)$/.exec(url.pathname);
    if (req.method === 'GET' && m) return await handleFile(res, m[1], m[2]);
    if (req.method === 'GET') return serveStatic(res, url.pathname);
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  }
});

async function handleConvert(req, res, url) {
  const presetName = url.searchParams.get('preset') || DEFAULT_PRESET;
  if (!PRESETS[presetName]) return sendJson(res, 400, { error: `Unknown preset: ${presetName}` });

  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(WORK_DIR, id);
  await fsp.mkdir(dir, { recursive: true });

  const originalName = url.searchParams.get('name') || 'video.mp4';
  const base = sanitizeBaseName(originalName);
  const inputPath = path.join(dir, 'input' + (path.extname(originalName) || '.mp4'));

  // Stream the raw upload straight to disk.
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(inputPath);
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    req.on('error', reject);
  });

  const job = {
    status: 'converting', percent: 0, error: null, base, dir,
    mp4Path: path.join(dir, `${base}.MP4`),
    thmPath: path.join(dir, `${base}.THM`),
    listeners: new Set(),
  };
  jobs.set(id, job);
  runJob(id, job, inputPath, presetName); // fire and forget
  sendJson(res, 200, { id });
}

async function runJob(id, job, inputPath, presetName) {
  try {
    const info = await probe(inputPath);
    await convert({
      input: inputPath,
      output: job.mp4Path,
      preset: presetName,
      sourceFps: info.fps,
      onProgress: (seconds) => {
        job.percent = info.duration > 0
          ? Math.min(99, Math.round((seconds / info.duration) * 100))
          : 0;
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
  sendEvent(res, job); // current state immediately
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
    const [mp4, thm] = await Promise.all([
      fsp.readFile(job.mp4Path),
      fsp.readFile(job.thmPath),
    ]);
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
  const name = `${job.base}.${kind.toUpperCase()}`;
  const stat = await fsp.stat(filePath);
  res.writeHead(200, {
    'Content-Type': kind === 'mp4' ? 'video/mp4' : 'image/jpeg',
    'Content-Length': stat.size,
    'Content-Disposition': contentDisposition(name),
  });
  fs.createReadStream(filePath).pipe(res);
}

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function serveStatic(res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

server.listen(PORT, () => {
  console.log(`▶ PSP Video Converter running at http://localhost:${PORT}`);
});
