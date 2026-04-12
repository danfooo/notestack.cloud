import { Router } from 'express';
import { randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { sendInviteEmail } from '../services/email.js';

const router = Router();
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

// POST /api/invites — create open invite link (7 days)
router.post('/', requireAuth, (req: AuthRequest, res) => {
  const token = randomBytes(16).toString('hex');
  const id = nanoid();
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

  db.prepare(`
    INSERT INTO invite_links (id, token, created_by, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(id, token, req.userId, expiresAt);

  res.json({
    token,
    url: `${APP_URL}/invite/${token}`,
    expires_at: expiresAt,
  });
});

// POST /api/invites/email — send email invite (30 days)
router.post('/email', requireAuth, async (req: AuthRequest, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const token = randomBytes(16).toString('hex');
  const id = nanoid();
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

  db.prepare(`
    INSERT INTO invite_links (id, token, created_by, invited_email, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, token, req.userId, email.toLowerCase(), expiresAt);

  sendInviteEmail(email, req.user!.display_name, token);

  res.json({ message: 'Invitation sent', token, expires_at: expiresAt });
});

// GET /api/invites/open-links
router.get('/open-links', requireAuth, (req: AuthRequest, res) => {
  const now = Math.floor(Date.now() / 1000);
  const links = db.prepare(`
    SELECT * FROM invite_links
    WHERE created_by = ? AND invited_email IS NULL AND revoked = 0 AND expires_at > ?
    ORDER BY created_at DESC
  `).all(req.userId, now);
  res.json(links.map((l: any) => ({ ...l, url: `${APP_URL}/invite/${l.token}` })));
});

// GET /api/invites/pending
router.get('/pending', requireAuth, (req: AuthRequest, res) => {
  const now = Math.floor(Date.now() / 1000);
  const links = db.prepare(`
    SELECT * FROM invite_links
    WHERE created_by = ? AND invited_email IS NOT NULL AND revoked = 0 AND expires_at > ?
    ORDER BY created_at DESC
  `).all(req.userId, now);
  res.json(links);
});

// GET /api/invites/:token — public
router.get('/:token', (req, res) => {
  const { token } = req.params;
  const now = Math.floor(Date.now() / 1000);

  const link = db.prepare(`
    SELECT il.*, u.display_name as inviter_name
    FROM invite_links il
    JOIN users u ON il.created_by = u.id
    WHERE il.token = ?
  `).get(token) as any;

  if (!link) return res.status(404).json({ error: 'INVALID_TOKEN' });
  if (link.revoked) return res.status(410).json({ error: 'REVOKED' });
  if (link.expires_at <= now) return res.status(410).json({ error: 'EXPIRED' });

  res.json({
    valid: true,
    inviter_name: link.inviter_name,
    invited_email: link.invited_email,
    expires_at: link.expires_at,
  });
});

// POST /api/invites/:token/revoke
router.post('/:token/revoke', requireAuth, (req: AuthRequest, res) => {
  const { token } = req.params;
  const link = db.prepare('SELECT * FROM invite_links WHERE token = ?').get(token) as any;

  if (!link) return res.status(404).json({ error: 'Not found' });
  if (link.created_by !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  db.prepare('UPDATE invite_links SET revoked = 1 WHERE token = ?').run(token);
  res.json({ ok: true });
});

export default router;
