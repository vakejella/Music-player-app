/* ===================================================================
   demo.js — synthesizes short royalty-free demo tracks as WAV blobs,
   so the player has something to play with no files or network.
   =================================================================== */

const SR = 22050;

function noteFreq(semitonesFromA4) {
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

// A few short looping melodies (semitone offsets from A4, with durations).
const SONGS = [
  {
    title: 'Llama Groove (demo)',
    bpm: 120,
    wave: 'square',
    notes: [0, 3, 5, 7, 5, 3, 0, -2, 0, 3, 5, 3, 0, -2, 0, 0],
  },
  {
    title: 'Pixel Sunrise (demo)',
    bpm: 96,
    wave: 'triangle',
    notes: [-5, 0, 4, 7, 4, 0, -1, 2, 5, 9, 5, 2, 0, 4, 7, 12],
  },
  {
    title: 'Neon Drive (demo)',
    bpm: 140,
    wave: 'sawtooth',
    notes: [-7, -7, 0, -7, 3, -7, 5, 3, 0, -7, -7, 5, 3, 0, -2, -7],
  },
];

function sample(wave, phase) {
  switch (wave) {
    case 'square':   return phase < 0.5 ? 1 : -1;
    case 'triangle': return 4 * Math.abs(phase - 0.5) - 1;
    case 'sawtooth': return 2 * phase - 1;
    default:         return Math.sin(phase * 2 * Math.PI);
  }
}

function renderSong(song) {
  const beat = 60 / song.bpm;
  const total = song.notes.length * beat;
  const n = Math.floor(total * SR);
  const data = new Float32Array(n);

  song.notes.forEach((semi, idx) => {
    const freq = noteFreq(semi);
    const start = Math.floor(idx * beat * SR);
    const end = Math.floor((idx + 1) * beat * SR);
    for (let i = start; i < end && i < n; i++) {
      const t = (i - start) / SR;
      const phase = (t * freq) % 1;
      // Simple AD envelope to avoid clicks.
      const localLen = (end - start) / SR;
      const env = Math.min(1, (i - start) / (0.01 * SR)) *
                  Math.min(1, (end - i) / (0.04 * SR));
      // Add a soft bass octave below for body.
      const bassPhase = (t * freq * 0.5) % 1;
      const s = sample(song.wave, phase) * 0.22 + sample('sine', bassPhase) * 0.12;
      data[i] += s * env;
    }
  });

  return encodeWav(data, SR);
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function generateDemoTracks() {
  return SONGS.map((song) => {
    const blob = renderSong(song);
    return {
      title: song.title,
      url: URL.createObjectURL(blob),
      isObjectURL: true,
      duration: (song.notes.length * 60) / song.bpm,
    };
  });
}
