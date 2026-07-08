// PSP Video Converter front-end: pick a file, upload it raw to the local
// server, watch conversion progress over SSE, then offer the downloads.

const drop = document.getElementById('drop');
const fileInput = document.getElementById('file');
const presetSelect = document.getElementById('preset');
const presetDesc = document.getElementById('preset-desc');
const convertBtn = document.getElementById('convert');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const bar = document.getElementById('bar');
const resultEl = document.getElementById('result');
const errorEl = document.getElementById('error');
const errorText = document.getElementById('error-text');

let selectedFile = null;
let presets = {};

init();

async function init() {
  const res = await fetch('/api/presets');
  const data = await res.json();
  presets = data.presets;
  for (const [name, p] of Object.entries(presets)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${p.label} — ${p.videoBitrate} kbps`;
    if (name === data.default) opt.selected = true;
    presetSelect.appendChild(opt);
  }
  updatePresetDesc();
}

presetSelect.addEventListener('change', updatePresetDesc);
function updatePresetDesc() {
  presetDesc.textContent = presets[presetSelect.value]?.description || '';
}

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

['dragover', 'dragenter'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); }));
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragover'); }));
drop.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});

function setFile(file) {
  selectedFile = file;
  drop.classList.add('has-file');
  drop.querySelector('.dz-inner').innerHTML = `
    <div class="dz-icon">🎬</div>
    <p class="dz-filename"></p>
    <p class="dz-filesize">${formatSize(file.size)} — tap to change</p>`;
  drop.querySelector('.dz-filename').textContent = file.name;
  convertBtn.disabled = false;
  resultEl.hidden = true;
  errorEl.hidden = true;
}

convertBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  convertBtn.disabled = true;
  resultEl.hidden = true;
  errorEl.hidden = true;
  statusEl.hidden = false;
  setProgress(0, 'Uploading…');

  try {
    const params = new URLSearchParams({
      name: selectedFile.name,
      preset: presetSelect.value,
    });
    const res = await fetch(`/api/convert?${params}`, {
      method: 'POST',
      body: selectedFile,
    });
    if (!res.ok) throw new Error((await res.json()).error || `Upload failed (${res.status})`);
    const { id } = await res.json();
    watchProgress(id);
  } catch (err) {
    showError(err.message);
  }
});

function watchProgress(id) {
  const source = new EventSource(`/api/progress/${id}`);
  source.onmessage = (e) => {
    const job = JSON.parse(e.data);
    if (job.status === 'converting') {
      setProgress(job.percent, `Converting… ${job.percent}%`);
    } else if (job.status === 'done') {
      source.close();
      setProgress(100, 'Done!');
      showResult(id);
    } else if (job.status === 'error') {
      source.close();
      showError(job.error || 'Unknown error');
    }
  };
  source.onerror = () => {
    source.close();
    showError('Lost connection to the converter server.');
  };
}

function setProgress(percent, text) {
  bar.style.width = `${percent}%`;
  statusText.textContent = text;
}

function showResult(id) {
  statusEl.hidden = true;
  resultEl.hidden = false;
  convertBtn.disabled = false;
  document.getElementById('dl-zip').href = `/api/file/${id}/zip`;
  document.getElementById('dl-mp4').href = `/api/file/${id}/mp4`;
  document.getElementById('dl-thm').href = `/api/file/${id}/thm`;
}

function showError(message) {
  statusEl.hidden = true;
  errorEl.hidden = false;
  errorText.textContent = message;
  convertBtn.disabled = false;
}

document.getElementById('retry').addEventListener('click', () => {
  errorEl.hidden = true;
});

function formatSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1e3)} KB`;
}
