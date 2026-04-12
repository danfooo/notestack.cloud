import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

function buildTree(folders: any[]): any[] {
  const map = new Map<string, any>();
  const roots: any[] = [];

  for (const f of folders) {
    map.set(f.id, { ...f, children: [] });
  }

  for (const f of folders) {
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id).children.push(map.get(f.id));
    } else {
      roots.push(map.get(f.id)!);
    }
  }

  return roots;
}

// GET /api/folders — full tree
router.get('/', requireAuth, (req: AuthRequest, res) => {
  const folders = db.prepare(
    'SELECT * FROM folders WHERE user_id = ? ORDER BY position ASC, name ASC'
  ).all(req.userId);
  res.json(buildTree(folders));
});

// POST /api/folders
router.post('/', requireAuth, (req: AuthRequest, res) => {
  const { name, parent_id, position } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

  const now = Math.floor(Date.now() / 1000);
  const id = nanoid();

  db.prepare(`
    INSERT INTO folders (id, user_id, parent_id, name, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.userId, parent_id ?? null, name.trim(), position ?? 0, now, now);

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  res.status(201).json(folder);
});

// PATCH /api/folders/:id
router.patch('/:id', requireAuth, (req: AuthRequest, res) => {
  const { id } = req.params;
  const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').get(id, req.userId) as any;
  if (!folder) return res.status(404).json({ error: 'Not found' });

  const { name, parent_id, position } = req.body;
  const updates: string[] = ['updated_at = ?'];
  const values: unknown[] = [Math.floor(Date.now() / 1000)];

  if (name !== undefined) { updates.push('name = ?'); values.push(name.trim()); }
  if (parent_id !== undefined) { updates.push('parent_id = ?'); values.push(parent_id); }
  if (position !== undefined) { updates.push('position = ?'); values.push(position); }

  values.push(id);
  db.prepare(`UPDATE folders SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  res.json(updated);
});

// DELETE /api/folders/:id
router.delete('/:id', requireAuth, (req: AuthRequest, res) => {
  const { id } = req.params;
  const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!folder) return res.status(404).json({ error: 'Not found' });

  // Move notes in this folder to root
  db.prepare('UPDATE notes SET folder_id = NULL WHERE folder_id = ? AND user_id = ?').run(id, req.userId);
  // Reparent child folders to root
  db.prepare('UPDATE folders SET parent_id = NULL WHERE parent_id = ? AND user_id = ?').run(id, req.userId);
  db.prepare('DELETE FROM folders WHERE id = ?').run(id);

  res.json({ ok: true });
});

export default router;
