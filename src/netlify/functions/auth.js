/**
 * netlify/functions/auth.js
 *
 * Handles:  POST { action: 'login'|'register'|'verify', username, password }
 * Returns:  { token, userId } on success
 *
 * Env vars needed (set in Netlify dashboard → Site Settings → Environment Variables):
 *   DATABASE_URL   — Neon connection string  (postgresql://user:pass@host/dbname?sslmode=require)
 *   JWT_SECRET     — any long random string  (e.g. openssl rand -base64 48)
 */

const { neon }    = require('@neondatabase/serverless');
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');

const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const sql = neon(process.env.DATABASE_URL);

  let body;
  try { body = JSON.parse(event.body); }
  catch { return err(400, 'Invalid JSON'); }

  const { action, username, password } = body;

  // ── VERIFY ──────────────────────────────────────────────────────────────────
  if (action === 'verify') {
    const tok = (event.headers['authorization'] || '').replace('Bearer ', '');
    try {
      const payload = jwt.verify(tok, process.env.JWT_SECRET);
      return ok({ userId: payload.userId, username: payload.username });
    } catch {
      return err(401, 'Token invalid or expired');
    }
  }

  if (!username?.trim() || !password) return err(400, 'Username and password required');
  const uname = username.trim().toLowerCase();

  // ── LOGIN ───────────────────────────────────────────────────────────────────
  if (action === 'login') {
    const rows = await sql`SELECT id, username, password_hash FROM users WHERE username = ${uname}`;
    if (!rows.length) return err(401, 'Username not found');
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return err(401, 'Incorrect password');
    const token = signToken(user.id, user.username);
    return ok({ token, userId: user.id, username: user.username });
  }

  // ── REGISTER ─────────────────────────────────────────────────────────────────
  if (action === 'register') {
    if (password.length < 6) return err(400, 'Password must be at least 6 characters');
    const existing = await sql`SELECT id FROM users WHERE username = ${uname}`;
    if (existing.length) return err(409, 'Username already taken');
    const hash = await bcrypt.hash(password, 12);
    const [user] = await sql`INSERT INTO users (username, password_hash) VALUES (${uname}, ${hash}) RETURNING id, username`;
    const token = signToken(user.id, user.username);
    return ok({ token, userId: user.id, username: user.username });
  }

  return err(400, 'Unknown action');
};

function signToken(userId, username) {
  return jwt.sign({ userId, username }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function ok(data) {
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data) };
}

function err(status, message) {
  return { statusCode: status, headers: HEADERS, body: JSON.stringify({ error: message }) };
}
