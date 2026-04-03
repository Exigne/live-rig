/**
 * netlify/functions/songs.js
 *
 * GET                         → list user's songs (WITH state — fixes load bug)
 * GET  ?id=<id>               → fetch single song with full state
 * POST  { name, state }       → create song
 * PUT   { id, name, state }   → update song
 * DELETE ?id=<id>             → delete song
 *
 * All routes require:  Authorization: Bearer <jwt>
 *
 * Env vars (Netlify dashboard → Site Settings → Environment Variables):
 *   DATABASE_URL   — Neon connection string
 *   JWT_SECRET     — long random string
 */

const { neon } = require('@neondatabase/serverless');
const jwt      = require('jsonwebtoken');

const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  // ── Auth check ──────────────────────────────────────────────────────────────
  const tok = (event.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!tok) return err(401, 'Authorization header missing');

  let userId;
  try {
    const payload = jwt.verify(tok, process.env.JWT_SECRET);
    userId = payload.userId;
  } catch (e) {
    return err(401, 'Token invalid or expired — please sign in again');
  }

  const sql = neon(process.env.DATABASE_URL);
  const qs  = event.queryStringParameters || {};
  const method = event.httpMethod;

  // ── GET — single song by id ─────────────────────────────────────────────────
  if (method === 'GET' && qs.id) {
    const rows = await sql`
      SELECT id, name, state, created_at, updated_at
      FROM   songs
      WHERE  id = ${qs.id} AND user_id = ${userId}
    `;
    if (!rows.length) return err(404, 'Song not found or access denied');
    // Parse state if it came back as a string (Neon sometimes returns JSONB as string)
    const song = rows[0];
    if (typeof song.state === 'string') {
      try { song.state = JSON.parse(song.state); } catch {}
    }
    return ok({ song });
  }

  // ── GET — list all songs (WITH state so client can load without a second round-trip) ──
  if (method === 'GET') {
    const rows = await sql`
      SELECT id, name, state, created_at, updated_at
      FROM   songs
      WHERE  user_id = ${userId}
      ORDER  BY updated_at DESC
      LIMIT  100
    `;
    // Normalise state on each row
    const songs = rows.map(s => {
      if (typeof s.state === 'string') {
        try { s.state = JSON.parse(s.state); } catch {}
      }
      return s;
    });
    return ok({ songs });
  }

  // ── Parse body for mutating methods ────────────────────────────────────────
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  // ── POST — create new song ──────────────────────────────────────────────────
  if (method === 'POST') {
    const { name, state } = body;
    if (!name?.trim()) return err(400, 'Song name is required');

    const stateStr = typeof state === 'string' ? state : JSON.stringify(state || {});
    const [song] = await sql`
      INSERT INTO songs (user_id, name, state)
      VALUES (${userId}, ${name.trim()}, ${stateStr}::jsonb)
      RETURNING id, name, state, created_at, updated_at
    `;
    if (typeof song.state === 'string') { try { song.state = JSON.parse(song.state); } catch {} }
    return ok({ song });
  }

  // ── PUT — update existing song ──────────────────────────────────────────────
  if (method === 'PUT') {
    const { id, name, state } = body;
    if (!id) return err(400, 'Song id is required');

    const existing = await sql`SELECT id, name FROM songs WHERE id = ${id} AND user_id = ${userId}`;
    if (!existing.length) return err(404, 'Song not found or access denied');

    const stateStr = typeof state === 'string' ? state : JSON.stringify(state || {});
    const newName  = name?.trim() || existing[0].name;
    const [song] = await sql`
      UPDATE songs
      SET    name       = ${newName},
             state      = ${stateStr}::jsonb,
             updated_at = NOW()
      WHERE  id = ${id}
      RETURNING id, name, state, created_at, updated_at
    `;
    if (typeof song.state === 'string') { try { song.state = JSON.parse(song.state); } catch {} }
    return ok({ song });
  }

  // ── DELETE ──────────────────────────────────────────────────────────────────
  if (method === 'DELETE') {
    const id = qs.id || body.id;
    if (!id) return err(400, 'Song id is required');
    const result = await sql`
      DELETE FROM songs WHERE id = ${id} AND user_id = ${userId} RETURNING id
    `;
    if (!result.length) return err(404, 'Song not found or access denied');
    return ok({ deleted: true, id });
  }

  return err(405, 'Method not allowed');
};

const ok  = data        => ({ statusCode: 200, headers: HEADERS, body: JSON.stringify(data) });
const err = (s, msg)    => ({ statusCode: s,   headers: HEADERS, body: JSON.stringify({ error: msg }) });
