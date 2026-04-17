import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

// GET /api/dashboard
router.get('/', requireAuth, (req: AuthRequest, res) => {
  const userId = req.userId!;

  const pinnedNotes = db.prepare(`
    SELECT n.*, GROUP_CONCAT(nt.tag) as tags
    FROM notes n
    LEFT JOIN note_tags nt ON n.id = nt.note_id
    WHERE n.user_id = ? AND n.pinned = 1 AND n.deleted_at IS NULL AND n.archived = 0
    GROUP BY n.id
    ORDER BY n.updated_at DESC
    LIMIT 10
  `).all(userId) as any[];

  const recentNotes = db.prepare(`
    SELECT n.*, GROUP_CONCAT(nt.tag) as tags
    FROM notes n
    LEFT JOIN note_tags nt ON n.id = nt.note_id
    WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.archived = 0
    GROUP BY n.id
    ORDER BY n.updated_at DESC
    LIMIT 5
  `).all(userId) as any[];

  const activeTodos = db.prepare(`
    SELECT * FROM thoughts
    WHERE user_id = ? AND type = 'todo' AND superseded_by IS NULL
    ORDER BY created_at DESC
    LIMIT 20
  `).all(userId);

  const recentThoughts = db.prepare(`
    SELECT t.*, n.title as note_title, n.body as note_body
    FROM thoughts t
    LEFT JOIN notes n ON t.source_note_id = n.id
    WHERE t.user_id = ? AND t.superseded_by IS NULL
    ORDER BY t.created_at DESC
    LIMIT 10
  `).all(userId);

  const themes = db.prepare(`
    SELECT * FROM thoughts
    WHERE user_id = ? AND type = 'theme' AND superseded_by IS NULL
    ORDER BY created_at DESC
    LIMIT 10
  `).all(userId);

  res.json({
    pinned_notes: pinnedNotes.map(n => ({ ...n, tags: n.tags ? n.tags.split(',') : [] })),
    recent_notes: recentNotes.map(n => ({ ...n, tags: n.tags ? n.tags.split(',') : [] })),
    active_todos: activeTodos,
    recent_thoughts: recentThoughts,
    themes,
  });
});

export default router;
