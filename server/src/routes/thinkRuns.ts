import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

// GET /api/think-runs
router.get('/', requireAuth, (req: AuthRequest, res) => {
  const { prompt_id, limit = '20' } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit) || 20, 100);

  let query = `
    SELECT tr.*, tp.name as prompt_name
    FROM think_runs tr
    JOIN think_prompts tp ON tr.prompt_id = tp.id
    WHERE tr.user_id = ?
  `;
  const params: unknown[] = [req.userId];

  if (prompt_id) {
    query += ' AND tr.prompt_id = ?';
    params.push(prompt_id);
  }

  query += ' ORDER BY tr.started_at DESC LIMIT ?';
  params.push(lim);

  const runs = db.prepare(query).all(...params);
  res.json(runs);
});

// GET /api/think-runs/:id
router.get('/:id', requireAuth, (req: AuthRequest, res) => {
  const { id } = req.params;

  const run = db.prepare(`
    SELECT tr.*, tp.name as prompt_name
    FROM think_runs tr
    JOIN think_prompts tp ON tr.prompt_id = tp.id
    WHERE tr.id = ? AND tr.user_id = ?
  `).get(id, req.userId);

  if (!run) return res.status(404).json({ error: 'Not found' });

  const thoughts = db.prepare('SELECT * FROM thoughts WHERE run_id = ? ORDER BY created_at ASC').all(id);

  res.json({ ...run, thoughts });
});

export default router;
