import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

// GET /api/settings
router.get('/', requireAuth, (req: AuthRequest, res) => {
  const shortcuts = db.prepare('SELECT shortcuts_json FROM user_shortcuts WHERE user_id = ?').get(req.userId) as any;
  res.json({
    shortcuts: shortcuts ? JSON.parse(shortcuts.shortcuts_json) : {},
  });
});

// PATCH /api/settings
router.patch('/', requireAuth, (req: AuthRequest, res) => {
  const { shortcuts } = req.body;

  if (shortcuts !== undefined) {
    const json = JSON.stringify(shortcuts);
    db.prepare(`
      INSERT INTO user_shortcuts (user_id, shortcuts_json) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET shortcuts_json = excluded.shortcuts_json
    `).run(req.userId, json);
  }

  const updated = db.prepare('SELECT shortcuts_json FROM user_shortcuts WHERE user_id = ?').get(req.userId) as any;
  res.json({
    shortcuts: updated ? JSON.parse(updated.shortcuts_json) : {},
  });
});

// GET /api/settings/mcp-tokens
router.get('/mcp-tokens', requireAuth, (req: AuthRequest, res) => {
  const tokens = db.prepare(`
    SELECT id, name, created_at, last_used_at FROM mcp_tokens WHERE user_id = ? ORDER BY created_at DESC
  `).all(req.userId);
  res.json(tokens);
});

// POST /api/settings/mcp-tokens
router.post('/mcp-tokens', requireAuth, (req: AuthRequest, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Token name required' });

  const id = nanoid();
  const plaintext = `notestack_${randomBytes(32).toString('hex')}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO mcp_tokens (id, user_id, name, token_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, req.userId, name.trim(), hash, now);

  res.status(201).json({
    id,
    name: name.trim(),
    token: plaintext, // shown once
    created_at: now,
  });
});

// DELETE /api/settings/mcp-tokens/:id
router.delete('/mcp-tokens/:id', requireAuth, (req: AuthRequest, res) => {
  const { id } = req.params;
  const token = db.prepare('SELECT id FROM mcp_tokens WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!token) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM mcp_tokens WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
