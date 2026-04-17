import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

// GET /api/thoughts
router.get('/', requireAuth, (req: AuthRequest, res) => {
  const { type, note_id, limit = '50', offset = '0' } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit) || 50, 200);
  const off = parseInt(offset) || 0;

  let query = `
    SELECT t.*, n.title as note_title, n.body as note_body
    FROM thoughts t
    LEFT JOIN notes n ON t.source_note_id = n.id
    WHERE t.user_id = ? AND t.superseded_by IS NULL
  `;
  const params: unknown[] = [req.userId];

  if (type) {
    query += ' AND t.type = ?';
    params.push(type);
  }

  if (note_id) {
    query += ' AND t.source_note_id = ?';
    params.push(note_id);
  }

  query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
  params.push(lim, off);

  const thoughts = db.prepare(query).all(...params);
  res.json(thoughts);
});

// GET /api/thoughts/:id
router.get('/:id', requireAuth, (req: AuthRequest, res) => {
  const { id } = req.params;
  const thought = db.prepare(`
    SELECT t.*, n.title as note_title, n.body as note_body
    FROM thoughts t
    LEFT JOIN notes n ON t.source_note_id = n.id
    WHERE t.id = ? AND t.user_id = ?
  `).get(id, req.userId);

  if (!thought) return res.status(404).json({ error: 'Not found' });
  res.json(thought);
});

// DELETE /api/thoughts/:id
router.delete('/:id', requireAuth, (req: AuthRequest, res) => {
  const { id } = req.params;
  const thought = db.prepare('SELECT id FROM thoughts WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!thought) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM thoughts WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
