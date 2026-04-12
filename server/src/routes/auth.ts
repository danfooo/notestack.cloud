import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { join, extname } from 'path';
import { mkdirSync } from 'fs';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { requireAuth, signJwt, AuthRequest } from '../middleware/auth.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email.js';

const avatarsDir = join(process.cwd(), 'data', 'avatars');
mkdirSync(avatarsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: avatarsDir,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

const router = Router();

function validateInviteToken(token: unknown): string | null {
  if (typeof token !== 'string' || !token) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(
    'SELECT created_by FROM invite_links WHERE token = ? AND revoked = 0 AND expires_at > ?'
  ).get(token, now) as { created_by: string } | undefined;
  return row?.created_by ?? null;
}

function userResponse(u: any) {
  return {
    id: u.id,
    email: u.email,
    display_name: u.display_name,
    avatar_url: u.avatar_url ?? null,
    email_verified: Boolean(u.email_verified),
    google_id: u.google_id ?? null,
    created_at: u.created_at,
  };
}

function seedDefaultPrompts(userId: string) {
  const now = Math.floor(Date.now() / 1000);
  const prompts = [
    {
      id: nanoid(),
      user_id: userId,
      name: 'Extract todos',
      description: 'Extract action items from the note',
      prompt_text: 'You are a helpful assistant. Extract all action items and todos from the note. Return a JSON array of objects with fields: type ("todo"), title (short description), body (full context). Example: [{"type":"todo","title":"Buy groceries","body":"Need to buy groceries this week"}]',
      output_type: 'todo',
      scope: 'note',
      trigger: 'on_save',
      schedule: null,
      model: 'claude-opus-4-6',
      enabled: 1,
      created_at: now,
      updated_at: now,
    },
    {
      id: nanoid(),
      user_id: userId,
      name: 'Summarise note',
      description: 'Create a concise summary of the note',
      prompt_text: 'You are a helpful assistant. Create a concise summary of the provided note. Return a JSON object with fields: type ("summary"), title (1 sentence summary), body (2-3 sentence elaboration). Example: {"type":"summary","title":"Meeting notes from Q1 planning","body":"The team discussed..."}',
      output_type: 'summary',
      scope: 'note',
      trigger: 'manual',
      schedule: null,
      model: 'claude-opus-4-6',
      enabled: 1,
      created_at: now,
      updated_at: now,
    },
    {
      id: nanoid(),
      user_id: userId,
      name: 'Weekly digest',
      description: 'Weekly summary of all notes',
      prompt_text: 'You are a helpful assistant. Review all the provided notes and create a weekly digest. Return a JSON array with: 1) A summary thought: {"type":"summary","title":"Weekly digest","body":"..."} 2) Theme thoughts for recurring topics: {"type":"theme","title":"Theme name","body":"..."} Identify patterns, recurring topics, and key insights across all notes.',
      output_type: 'summary',
      scope: 'all',
      trigger: 'scheduled',
      schedule: '0 8 * * 1',
      model: 'claude-opus-4-6',
      enabled: 1,
      created_at: now,
      updated_at: now,
    },
    {
      id: nanoid(),
      user_id: userId,
      name: 'Find connections',
      description: 'Find connections between notes',
      prompt_text: 'You are a helpful assistant. Analyze all the provided notes and find meaningful connections, relationships, and patterns between them. Return a JSON array of connection thoughts: [{"type":"connection","title":"Connection title","body":"Description of how these ideas connect"}]. Focus on non-obvious relationships and emergent themes.',
      output_type: 'connection',
      scope: 'all',
      trigger: 'scheduled',
      schedule: '0 2 * * *',
      model: 'claude-opus-4-6',
      enabled: 1,
      created_at: now,
      updated_at: now,
    },
  ];

  const stmt = db.prepare(`
    INSERT INTO think_prompts (id, user_id, name, description, prompt_text, output_type, scope, trigger, schedule, model, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of prompts) {
    stmt.run(p.id, p.user_id, p.name, p.description, p.prompt_text, p.output_type, p.scope, p.trigger, p.schedule, p.model, p.enabled, p.created_at, p.updated_at);
  }
}

// GET /api/auth/me
router.get('/me', requireAuth, (req: AuthRequest, res) => {
  res.json(userResponse(req.user!));
});

// PUT /api/auth/me
router.put('/me', requireAuth, (req: AuthRequest, res) => {
  const { display_name } = req.body;
  if (display_name !== undefined) {
    if (typeof display_name !== 'string' || display_name.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid display name' });
    }
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name.trim(), req.userId);
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId) as any;
  res.json(userResponse(user));
});

// DELETE /api/auth/me
router.delete('/me', requireAuth, (req: AuthRequest, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);
  res.json({ ok: true });
});

// PUT /api/auth/avatar
router.put('/avatar', requireAuth, upload.single('avatar'), (req: AuthRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const avatarUrl = `/avatars/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.userId);
  res.json({ avatar_url: avatarUrl });
});

// DELETE /api/auth/avatar
router.delete('/avatar', requireAuth, (req: AuthRequest, res) => {
  db.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').run(req.userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId) as any;
  res.json(userResponse(user));
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { email, password, display_name, invite_token } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (!display_name?.trim()) return res.status(400).json({ error: 'Display name required' });
  if (!validateInviteToken(invite_token)) {
    return res.status(403).json({ error: 'INVITE_REQUIRED' });
  }

  const emailLower = email.toLowerCase().trim();
  const existing = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(emailLower) as any;
  if (existing) {
    if (!existing.email_verified) return res.status(409).json({ error: 'EMAIL_EXISTS_UNVERIFIED' });
    return res.status(409).json({ error: 'Email already registered' });
  }

  const hash = await bcrypt.hash(password, 10);
  const id = nanoid();
  const verificationToken = randomUUID().replace(/-/g, '');
  const verificationExpires = Math.floor(Date.now() / 1000) + 24 * 3600;

  db.prepare(`
    INSERT INTO users (id, email, display_name, password_hash, email_verified, email_verification_token, email_verification_expires_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(id, emailLower, display_name.trim(), hash, verificationToken, verificationExpires);

  seedDefaultPrompts(id);
  sendVerificationEmail(emailLower, display_name.trim(), verificationToken);

  res.status(201).json({ message: 'Check your email to verify your account' });
});

// POST /api/auth/verify-email
router.post('/verify-email', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const now = Math.floor(Date.now() / 1000);
  const user = db.prepare(`
    SELECT * FROM users
    WHERE email_verification_token = ? AND email_verification_expires_at > ? AND email_verified = 0
  `).get(token, now) as any;

  if (!user) return res.status(400).json({ error: 'INVALID_OR_EXPIRED' });

  db.prepare(`
    UPDATE users SET email_verified = 1, email_verification_token = NULL, email_verification_expires_at = NULL
    WHERE id = ?
  `).run(user.id);

  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as any;
  const jwt = await signJwt(user.id);
  res.json({ token: jwt, user: userResponse(updatedUser) });
});

// POST /api/auth/resend-verification
router.post('/resend-verification', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND email_verified = 0').get(email.toLowerCase()) as any;
  if (!user) return res.json({ message: 'If that email exists, a verification link was sent' });

  const token = randomUUID().replace(/-/g, '');
  const expires = Math.floor(Date.now() / 1000) + 24 * 3600;
  db.prepare('UPDATE users SET email_verification_token = ?, email_verification_expires_at = ? WHERE id = ?').run(token, expires, user.id);
  sendVerificationEmail(user.email, user.display_name, token);

  res.json({ message: 'If that email exists, a verification link was sent' });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as any;
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  if (!user.email_verified) {
    return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED' });
  }

  const token = await signJwt(user.id);
  res.json({ token, user: userResponse(user) });
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  const { credential, invite_token } = req.body;
  if (!credential) return res.status(400).json({ error: 'Google credential required' });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'Google OAuth not configured' });

  try {
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) throw new Error('Invalid Google token');

    const { sub: googleId, email, name, picture } = payload;
    const emailLower = email.toLowerCase();

    const altEmail = emailLower.endsWith('@gmail.com')
      ? emailLower.replace('@gmail.com', '@googlemail.com')
      : emailLower.endsWith('@googlemail.com')
      ? emailLower.replace('@googlemail.com', '@gmail.com')
      : null;

    let user = (altEmail
      ? db.prepare('SELECT * FROM users WHERE google_id = ? OR email = ? OR email = ?').get(googleId, emailLower, altEmail)
      : db.prepare('SELECT * FROM users WHERE google_id = ? OR email = ?').get(googleId, emailLower)
    ) as any;

    if (!user) {
      if (!validateInviteToken(invite_token)) {
        return res.status(403).json({ error: 'INVITE_REQUIRED' });
      }
      const id = nanoid();
      const displayName = name || emailLower.split('@')[0];
      db.prepare(`
        INSERT INTO users (id, email, display_name, google_id, avatar_url, email_verified)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(id, emailLower, displayName, googleId, picture ?? null);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
      seedDefaultPrompts(id);
    } else {
      const updates: string[] = ['email_verified = 1'];
      const values: unknown[] = [];
      if (!user.google_id) { updates.push('google_id = ?'); values.push(googleId); }
      if (!user.avatar_url && picture) { updates.push('avatar_url = ?'); values.push(picture); }
      values.push(user.id);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as any;
    }

    const token = await signJwt(user.id);
    res.json({ token, user: userResponse(user) });
  } catch (err: any) {
    console.error('Google auth error:', err.message);
    res.status(401).json({ error: 'Invalid Google token' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as any;
  if (!user || !user.password_hash) {
    return res.json({ message: 'If that email exists, a reset link was sent' });
  }

  const token = randomUUID().replace(/-/g, '');
  const expires = Math.floor(Date.now() / 1000) + 3600;
  db.prepare('UPDATE users SET password_reset_token = ?, password_reset_expires_at = ? WHERE id = ?')
    .run(token, expires, user.id);

  sendPasswordResetEmail(user.email, user.display_name, token);
  res.json({ message: 'If that email exists, a reset link was sent' });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const now = Math.floor(Date.now() / 1000);
  const user = db.prepare(
    'SELECT * FROM users WHERE password_reset_token = ? AND password_reset_expires_at > ?'
  ).get(token, now) as any;

  if (!user) return res.status(400).json({ error: 'INVALID_OR_EXPIRED' });

  const hash = await bcrypt.hash(password, 10);
  db.prepare(
    'UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires_at = NULL, email_verified = 1 WHERE id = ?'
  ).run(hash, user.id);

  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as any;
  const jwt = await signJwt(user.id);
  res.json({ token: jwt, user: userResponse(updatedUser) });
});

export { seedDefaultPrompts };
export default router;
