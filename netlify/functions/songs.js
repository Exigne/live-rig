/**
 * netlify/functions/songs.js
 *
 * GET             → list user's songs (without giant state payload)
 * GET  ?id=<id>   → load full song state
 * POST  { name, state }  → create song
 * PUT   { id, name, state }  → update song
 * DELETE ?id=<id>        → delete song
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
    // Return songs list without full state (for performance and bandwidth)
    return ok({ songs: rows });
  }

  // Safely parse incoming body
  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch (e) {
      console.error("Failed to parse request body", e);
      return err(400, 'Invalid JSON body');
    }
  }

  // ── POST — create song ──────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const { name, state } = body;
    if (!name?.trim()) return err(400, 'Song name required');
    if (!state) return err(400, 'Song state required'); // CRITICAL GUARD: Prevents saving NULL

    // Normalize state: The frontend now sends a string, but if it didn't, we stringify it.
    const stateStr = typeof state === 'string' ? state : JSON.stringify(state);

    try {
      const [song] = await sql`
        INSERT INTO songs (user_id, name, state)
        VALUES (${userId}, ${name.trim()}, ${stateStr}::jsonb)
        RETURNING id, name, created_at, updated_at
      `;
      return ok({ song });
    } catch (e) {
      console.error("DB Insert Error", e);
      return err(500, 'Failed to save song to database');
    }
  }

  // ── PUT — update song ───────────────────────────────────────────────────────
  if (event.httpMethod === 'PUT') {
    const { id, name, state } = body;
    if (!id) return err(400, 'Song id required');
    if (!state) return err(400, 'Song state required'); // CRITICAL GUARD: Prevents overwriting with NULL

    const stateStr = typeof state === 'string' ? state : JSON.stringify(state);

    // Verify ownership
    const rows = await sql`SELECT id, name FROM songs WHERE id = ${id} AND user_id = ${userId}`;
    if (!rows.length) return err(404, 'Song not found or access denied');

    try {
      const [song] = await sql`
        UPDATE songs
        SET name = ${name?.trim() || rows[0].name},
            state = ${stateStr}::jsonb,
            updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, name, created_at, updated_at
      `;
      return ok({ song });
    } catch (e) {
      console.error("DB Update Error", e);
      return err(500, 'Failed to update song in database');
    }
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
