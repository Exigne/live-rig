/**
 * netlify/functions/songs.js
 *
 * GET                           → list user's songs
 * GET  ?id=<id>                 → load full song state
 * POST  { name, state }         → create song
 * PUT   { id, name, state }     → update song
 * DELETE ?id=<id>               → delete song
 *
 * All routes require:  Authorization: Bearer <jwt>
 */

import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  // Safety check: Make sure environment variables are loaded
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    return err(500, 'Server configuration error: Missing environment variables');
  }

  // Auth
  const tok = (event.headers['authorization'] || '').replace('Bearer ', '');
  let userId;
  try {
    const payload = jwt.verify(tok, process.env.JWT_SECRET);
    userId = payload.userId;
  } catch {
    return err(401, 'Unauthorized');
  }

  const sql = neon(process.env.DATABASE_URL);

  // ── GET with id — load full song state ─────────────────────────────────────
  // (Must happen before the general GET)
  if (event.httpMethod === 'GET' && event.queryStringParameters?.id) {
    const id = event.queryStringParameters.id;
    const rows = await sql`SELECT id, name, state, created_at, updated_at FROM songs WHERE id = ${id} AND user_id = ${userId}`;
    if (!rows.length) return err(404, 'Song not found');
    return ok({ song: rows[0] });
  }

  // ── GET — list songs ────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const rows = await sql`
      SELECT id, name, created_at, updated_at
      FROM songs
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
      LIMIT 100
    `;
    // Return songs list without full state (for performance)
    return ok({ songs: rows });
  }

  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch {}
  }

  // ── POST — create song ──────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const { name, state } = body;
    if (!name?.trim()) return err(400, 'Song name required');

    const [song] = await sql`
      INSERT INTO songs (user_id, name, state)
      VALUES (${userId}, ${name.trim()}, ${JSON.stringify(state)})
      RETURNING id, name, created_at, updated_at
    `;
    return ok({ song });
  }

  // ── PUT — update song ───────────────────────────────────────────────────────
  if (event.httpMethod === 'PUT') {
    const { id, name, state } = body;
    if (!id) return err(400, 'Song id required');

    // Verify ownership
    const rows = await sql`SELECT id FROM songs WHERE id = ${id} AND user_id = ${userId}`;
    if (!rows.length) return err(404, 'Song not found or access denied');

    const [song] = await sql`
      UPDATE songs
      SET name = ${name?.trim() || rows[0].name},
          state = ${JSON.stringify(state)},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, name, created_at, updated_at
    `;
    return ok({ song });
  }

  // ── DELETE — delete song ────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id || body.id;
    if (!id) return err(400, 'Song id required');
    const result = await sql`DELETE FROM songs WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
    if (!result.length) return err(404, 'Song not found or access denied');
    return ok({ deleted: true });
  }

  return err(405, 'Method not allowed');
};

function ok(data)          { return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data) }; }
function err(status, msg)  { return { statusCode: status, headers: HEADERS, body: JSON.stringify({ error: msg }) }; }
