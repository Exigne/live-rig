/**
 * netlify/functions/upload.js
 *
 * POST { data: base64string, filename: string, mimeType: string }
 * Returns { url, public_id }
 *
 * Env vars (Netlify dashboard):
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *   DATABASE_URL
 *   JWT_SECRET
 */

const cloudinary = require('cloudinary').v2;
const jwt        = require('jsonwebtoken');

const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST')    return err(405, 'Method not allowed');

  // Auth
  const tok = (event.headers['authorization'] || '').replace('Bearer ', '');
  let userId;
  try {
    const payload = jwt.verify(tok, process.env.JWT_SECRET);
    userId = payload.userId;
  } catch {
    return err(401, 'Unauthorized');
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return err(400, 'Invalid JSON'); }

  const { data, filename, mimeType = 'audio/wav' } = body;
  if (!data) return err(400, 'No audio data provided');

  // Construct data URI for Cloudinary
  const dataUri = `data:${mimeType};base64,${data}`;

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      resource_type: 'video',   // Cloudinary uses 'video' for audio files
      folder:        `live-rig/${userId}`,
      public_id:     sanitiseFilename(filename || `pad-${Date.now()}`),
      overwrite:     true,
      format:        'mp3',     // transcode to mp3 for smaller files
    });

    return ok({
      url:       result.secure_url,
      public_id: result.public_id,
      duration:  result.duration,
      bytes:     result.bytes,
    });
  } catch (e) {
    console.error('Cloudinary upload error:', e);
    return err(500, 'Upload failed: ' + e.message);
  }
};

function sanitiseFilename(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
}

function ok(data)         { return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data) }; }
function err(status, msg) { return { statusCode: status, headers: HEADERS, body: JSON.stringify({ error: msg }) }; }
