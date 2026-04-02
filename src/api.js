/**
 * api.js — Client-side API helpers
 * Talks to Netlify Functions which connect to Neon.tech + Cloudinary.
 */

const BASE = '/.netlify/functions';

async function req(path, opts = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const body = await res.json().catch(() => ({ error: 'Invalid response' }));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const auth = {
  login: (username, password) =>
    req('/auth', { method: 'POST', body: JSON.stringify({ action: 'login', username, password }) }),

  register: (username, password) =>
    req('/auth', { method: 'POST', body: JSON.stringify({ action: 'register', username, password }) }),

  verify: (token) =>
    req('/auth', { method: 'POST', body: JSON.stringify({ action: 'verify' }) }, token),
};

// ── Songs ─────────────────────────────────────────────────────────────────────
export const songs = {
  list: (token) =>
    req('/songs', {}, token),

  // Fetches a single full song (useful if the 'list' endpoint drops the heavy 'state' column)
  get: (token, id) =>
    req(`/songs?id=${id}`, {}, token),

  save: (token, name, state) =>
    req('/songs', { 
      method: 'POST', 
      // PROTECT THE DATA: We stringify the state object directly before sending it 
      // so it safely passes through the network and backend parsers into Neon's JSONB column
      body: JSON.stringify({ name, state: JSON.stringify(state) }) 
    }, token),

  update: (token, id, name, state) =>
    req('/songs', { 
      method: 'PUT', 
      // PROTECT THE DATA: Stringify the state
      body: JSON.stringify({ id, name, state: JSON.stringify(state) }) 
    }, token),

  delete: (token, id) =>
    req(`/songs?id=${id}`, { method: 'DELETE' }, token),
};

// ── Cloudinary ────────────────────────────────────────────────────────────────
export const cloudinary = {
  /**
   * Upload a pad's AudioBuffer to Cloudinary.
   * Encodes the buffer to WAV (PCM 16-bit) then sends as base64.
   */
  uploadPad: async (token, audioBuffer, filename) => {
    const wav = encodeWAV(audioBuffer);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(wav)));
    return req('/upload', {
      method: 'POST',
      body: JSON.stringify({ data: base64, filename, mimeType: 'audio/wav' }),
    }, token);
    // Returns { url, public_id }
  },

  /**
   * Fetch a Cloudinary audio URL and decode it into an AudioBuffer.
   */
  fetchPad: async (audioCtx, url) => {
    const res = await fetch(url);
    const ab  = await res.arrayBuffer();
    return audioCtx.decodeAudioData(ab);
  },
};

// ── WAV encoder (PCM 16-bit stereo) ──────────────────────────────────────────
function encodeWAV(audioBuffer) {
  const numCh      = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const samples    = audioBuffer.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numCh * bytesPerSample;
  const byteRate   = sampleRate * blockAlign;
  const dataSize   = samples * blockAlign;
  const buffer     = new ArrayBuffer(44 + dataSize);
  const view       = new DataView(buffer);

  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeStr(0,  'RIFF');
  view.setUint32(4,  36 + dataSize, true);
  writeStr(8,  'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);   // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }
  return buffer;
}
