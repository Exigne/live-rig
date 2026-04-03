/**
 * api.js — Client-side API helpers
 * Talks to Netlify Functions → Neon.tech + Cloudinary
 */

const BASE = '/.netlify/functions';

async function req(path, opts = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res  = await fetch(`${BASE}${path}`, { ...opts, headers });
  const body = await res.json().catch(() => ({ error: 'Invalid server response' }));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const auth = {
  login:    (username, password) =>
    req('/auth', { method:'POST', body: JSON.stringify({ action:'login',    username, password }) }),
  register: (username, password) =>
    req('/auth', { method:'POST', body: JSON.stringify({ action:'register', username, password }) }),
  verify:   (token) =>
    req('/auth', { method:'POST', body: JSON.stringify({ action:'verify' }) }, token),
};

// ── Songs ─────────────────────────────────────────────────────────────────────
export const songs = {
  // Returns songs WITH state (see songs.js — state is now included in list)
  list: (token) =>
    req('/songs', {}, token),

  // Fetch a single song with full state — used as fallback if state missing from list
  get: (token, id) =>
    req(`/songs?id=${id}`, {}, token),

  save: (token, name, state) =>
    req('/songs', { method:'POST', body: JSON.stringify({ name, state }) }, token),

  update: (token, id, name, state) =>
    req('/songs', { method:'PUT',  body: JSON.stringify({ id, name, state }) }, token),

  delete: (token, id) =>
    req(`/songs?id=${id}`, { method:'DELETE' }, token),
};

// ── Cloudinary ────────────────────────────────────────────────────────────────
export const cloudinary = {
  /**
   * Encode an AudioBuffer as PCM-16 WAV, upload to Cloudinary via the
   * /upload Netlify function. Returns { url, public_id }.
   */
  uploadPad: async (token, audioBuffer, filename) => {
    const wav    = encodeWAV(audioBuffer);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(wav)));
    return req('/upload', {
      method: 'POST',
      body:   JSON.stringify({ data: base64, filename, mimeType: 'audio/wav' }),
    }, token);
  },

  /** Fetch a Cloudinary audio URL and decode it into an AudioBuffer. */
  fetchPad: async (audioCtx, url) => {
    const res = await fetch(url);
    const ab  = await res.arrayBuffer();
    return audioCtx.decodeAudioData(ab);
  },
};

// ── WAV encoder (PCM 16-bit, up to stereo) ────────────────────────────────────
function encodeWAV(audioBuffer) {
  const numCh      = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const samples    = audioBuffer.length;
  const bps        = 16;
  const blockAlign = numCh * (bps / 8);
  const byteRate   = sampleRate * blockAlign;
  const dataSize   = samples * blockAlign;
  const buf        = new ArrayBuffer(44 + dataSize);
  const v          = new DataView(buf);
  const ws = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };

  ws(0,  'RIFF'); v.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true); v.setUint16(32, blockAlign, true);
  v.setUint16(34, bps, true); ws(36, 'data'); v.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
      v.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }
  return buf;
}
