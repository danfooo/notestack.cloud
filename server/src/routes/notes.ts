import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

function extractBodyText(body: string | null): string {
  if (!body) return '';
  try {
    const doc = JSON.parse(body);
    const texts: string[] = [];
    function walk(node: any) {
      if (node.type === 'text' && node.text) texts.push(node.text);
      if (node.content) node.content.forEach(walk);
    }
    walk(doc);
    return texts.join(' ');
  } catch {
    return body;
  }
}

async function triggerOnSavePrompts(userId: string, noteId: string, bodyText: string) {
  try {
    const prompts = db.prepare(`
      SELECT * FROM think_prompts
      WHERE user_id = ? AND trigger = 'on_save' AND enabled = 1 AND scope = 'note'
    `).all(userId) as any[];

    if (prompts.length === 0) return;

    const { runThinkPrompt, parseThoughtResponse } = await import('../services/claude.js');

    for (const prompt of prompts) {
      const runId = nanoid();
      const now = Math.floor(Date.now() / 1000);

      db.prepare(`
        INSERT INTO think_runs (id, prompt_id, user_id, scope_note_id, status, started_at)
        VALUES (?, ?, ?, ?, 'running', ?)
      `).run(runId, prompt.id, userId, noteId, now);

      try {
        const result = await runThinkPrompt(prompt.prompt_text, [bodyText], prompt.model);
        const thoughts = parseThoughtResponse(result.text, prompt.output_type);
        const finishedAt = Math.floor(Date.now() / 1000);

        // Supersede older thoughts from same prompt+note
        const oldThoughts = db.prepare(`
          SELECT id FROM thoughts WHERE prompt_id = ? AND source_note_id = ? AND superseded_by IS NULL
        `).all(prompt.id, noteId) as any[];

        db.prepare(`
          UPDATE think_runs SET status = 'done', input_tokens = ?, output_tokens = ?, finished_at = ? WHERE id = ?
        `).run(result.inputTokens, result.outputTokens, finishedAt, runId);

        for (const thought of thoughts) {
          const thoughtId = nanoid();
          db.prepare(`
            INSERT INTO thoughts (id, user_id, type, title, body, source_note_id, prompt_id, run_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(thoughtId, userId, thought.type || prompt.output_type, thought.title ?? null, thought.body, noteId, prompt.id, runId, finishedAt);

          // Mark old thoughts as superseded
          for (const old of oldThoughts) {
            db.prepare('UPDATE thoughts SET superseded_by = ? WHERE id = ?').run(thoughtId, old.id);
          }
        }
      } catch (err) {
        console.error('[onSave think] error:', err);
        const finishedAt = Math.floor(Date.now() / 1000);
        db.prepare(`
          UPDATE think_runs SET status = 'error', error = ?, finished_at = ? WHERE id = ?
        `).run(String(err), finishedAt, runId);
      }
    }
  } catch (err) {
    console.error('[onSave think] outer error:', err);
  }
}

// GET /api/notes
router.get('/', requireAuth, (req: AuthRequest, res) => {
  const { folder_id, tag, q, archived, limit = '50', offset = '0' } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit) || 50, 200);
  const off = parseInt(offset) || 0;

  let query = `
    SELECT n.*, GROUP_CONCAT(nt.tag) as tags
    FROM notes n
    LEFT JOIN note_tags nt ON n.id = nt.note_id
    WHERE n.user_id = ? AND n.deleted_at IS NULL
  `;
  const params: unknown[] = [req.userId];

  if (archived === 'true') {
    query += ' AND n.archived = 1';
  } else if (archived !== 'all') {
    query += ' AND n.archived = 0';
  }

  if (folder_id === 'null' || folder_id === '') {
    query += ' AND n.folder_id IS NULL';
  } else if (folder_id) {
    query += ' AND n.folder_id = ?';
    params.push(folder_id);
  }

  if (q) {
    query += ' AND (n.title LIKE ? OR n.body_text LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }

  if (tag) {
    query += ' AND n.id IN (SELECT note_id FROM note_tags WHERE tag = ?)';
    params.push(tag);
  }

  query += ' GROUP BY n.id ORDER BY n.pinned DESC, n.updated_at DESC LIMIT ? OFFSET ?';
  params.push(lim, off);

  const notes = db.prepare(query).all(...params) as any[];
  res.json(notes.map(n => ({ ...n, tags: n.tags ? n.tags.split(',') : [] })));
});

// POST /api/notes
router.post('/', requireAuth, (req: AuthRequest, res) => {
  const { title, body, folder_id, tags, pinned } = req.body;
  const now = Math.floor(Date.now() / 1000);
  const id = nanoid();
  const bodyText = extractBodyText(body ?? null);

  db.prepare(`
    INSERT INTO notes (id, user_id, title, body, body_text, folder_id, pinned, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.userId, title ?? null, body ?? null, bodyText, folder_id ?? null, pinned ? 1 : 0, now, now);

  // Save revision
  const revId = nanoid();
  db.prepare(`
    INSERT INTO note_revisions (id, note_id, body, body_text, saved_by, created_at)
    VALUES (?, ?, ?, ?, 'user', ?)
  `).run(revId, id, body ?? '', bodyText, now);

  // Handle tags
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)').run(id, tag);
    }
  }

  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  res.status(201).json(note);
});

// GET /api/notes/:id
router.get('/:id', requireAuth, (req: AuthRequest, res) => {
  const { id } = req.params;
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, req.userId) as any;
  if (!note) return res.status(404).json({ error: 'Not found' });

  const tags = db.prepare('SELECT tag FROM note_tags WHERE note_id = ?').all(id) as any[];
  res.json({ ...note, tags: tags.map(t => t.tag) });
});

// PATCH /api/notes/:id
router.patch('/:id', requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, req.userId) as any;
  if (!note) return res.status(404).json({ error: 'Not found' });

  const { title, body, folder_id, pinned, archived, tags } = req.body;
  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (title !== undefined) { updates.push('title = ?'); values.push(title); }
  if (body !== undefined) {
    const bodyText = extractBodyText(body);
    updates.push('body = ?', 'body_text = ?');
    values.push(body, bodyText);
  }
  if (folder_id !== undefined) { updates.push('folder_id = ?'); values.push(folder_id); }
  if (pinned !== undefined) { updates.push('pinned = ?'); values.push(pinned ? 1 : 0); }
  if (archived !== undefined) { updates.push('archived = ?'); values.push(archived ? 1 : 0); }

  values.push(id);
  db.prepare(`UPDATE notes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  // Save revision if body changed
  if (body !== undefined) {
    const bodyText = extractBodyText(body);
    const revId = nanoid();
    db.prepare(`
      INSERT INTO note_revisions (id, note_id, body, body_text, saved_by, created_at)
      VALUES (?, ?, ?, ?, 'user', ?)
    `).run(revId, id, body, bodyText, now);

    // Fire-and-forget on_save think prompts
    triggerOnSavePrompts(req.userId!, id, bodyText);
  }

  // Update tags
  if (Array.isArray(tags)) {
    db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(id);
    for (const tag of tags) {
      db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)').run(id, tag);
    }
  }

  const updatedNote = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as any;
  const noteTags = db.prepare('SELECT tag FROM note_tags WHERE note_id = ?').all(id) as any[];
  res.json({ ...updatedNote, tags: noteTags.map((t: any) => t.tag) });
});

// DELETE /api/notes/:id (soft delete)
router.delete('/:id', requireAuth, (req: AuthRequest, res) => {
  const { id } = req.params;
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!note) return res.status(404).json({ error: 'Not found' });

  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(now, id);
  res.json({ ok: true });
});

// GET /api/notes/:id/revisions
router.get('/:id/revisions', requireAuth, (req: AuthRequest, res) => {
  const { id } = req.params;
  const note = db.prepare('SELECT id FROM notes WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!note) return res.status(404).json({ error: 'Not found' });

  const revisions = db.prepare(
    'SELECT id, note_id, body_text, saved_by, created_at FROM note_revisions WHERE note_id = ? ORDER BY created_at DESC'
  ).all(id);
  res.json(revisions);
});

// POST /api/notes/:id/revisions/:rev_id/restore
router.post('/:id/revisions/:rev_id/restore', requireAuth, (req: AuthRequest, res) => {
  const { id, rev_id } = req.params;
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!note) return res.status(404).json({ error: 'Not found' });

  const revision = db.prepare('SELECT * FROM note_revisions WHERE id = ? AND note_id = ?').get(rev_id, id) as any;
  if (!revision) return res.status(404).json({ error: 'Revision not found' });

  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE notes SET body = ?, body_text = ?, updated_at = ? WHERE id = ?')
    .run(revision.body, revision.body_text, now, id);

  // Save new revision for the restore
  const newRevId = nanoid();
  db.prepare(`
    INSERT INTO note_revisions (id, note_id, body, body_text, saved_by, created_at)
    VALUES (?, ?, ?, ?, 'user', ?)
  `).run(newRevId, id, revision.body, revision.body_text, now);

  const updatedNote = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as any;
  const tags = db.prepare('SELECT tag FROM note_tags WHERE note_id = ?').all(id) as any[];
  res.json({ ...updatedNote, tags: tags.map((t: any) => t.tag) });
});

export default router;
