import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

// GET /api/think-prompts
router.get('/', requireAuth, (req: AuthRequest, res) => {
  const prompts = db.prepare(
    'SELECT * FROM think_prompts WHERE user_id = ? ORDER BY created_at ASC'
  ).all(req.userId);
  res.json(prompts);
});

// POST /api/think-prompts
router.post('/', requireAuth, (req: AuthRequest, res) => {
  const { name, description, prompt_text, output_type, scope, trigger, schedule, model, enabled } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (!prompt_text?.trim()) return res.status(400).json({ error: 'Prompt text required' });

  const now = Math.floor(Date.now() / 1000);
  const id = nanoid();

  db.prepare(`
    INSERT INTO think_prompts (id, user_id, name, description, prompt_text, output_type, scope, trigger, schedule, model, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.userId, name.trim(), description ?? null, prompt_text.trim(),
    output_type ?? 'free', scope ?? 'note', trigger ?? 'manual',
    schedule ?? null, model ?? 'claude-opus-4-6', enabled !== false ? 1 : 0, now, now
  );

  const prompt = db.prepare('SELECT * FROM think_prompts WHERE id = ?').get(id);
  res.status(201).json(prompt);
});

// PATCH /api/think-prompts/:id
router.patch('/:id', requireAuth, (req: AuthRequest, res) => {
  const { id } = req.params;
  const prompt = db.prepare('SELECT * FROM think_prompts WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!prompt) return res.status(404).json({ error: 'Not found' });

  const { name, description, prompt_text, output_type, scope, trigger, schedule, model, enabled } = req.body;
  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (name !== undefined) { updates.push('name = ?'); values.push(name.trim()); }
  if (description !== undefined) { updates.push('description = ?'); values.push(description); }
  if (prompt_text !== undefined) { updates.push('prompt_text = ?'); values.push(prompt_text.trim()); }
  if (output_type !== undefined) { updates.push('output_type = ?'); values.push(output_type); }
  if (scope !== undefined) { updates.push('scope = ?'); values.push(scope); }
  if (trigger !== undefined) { updates.push('trigger = ?'); values.push(trigger); }
  if (schedule !== undefined) { updates.push('schedule = ?'); values.push(schedule); }
  if (model !== undefined) { updates.push('model = ?'); values.push(model); }
  if (enabled !== undefined) { updates.push('enabled = ?'); values.push(enabled ? 1 : 0); }

  values.push(id);
  db.prepare(`UPDATE think_prompts SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM think_prompts WHERE id = ?').get(id);
  res.json(updated);
});

// DELETE /api/think-prompts/:id
router.delete('/:id', requireAuth, (req: AuthRequest, res) => {
  const { id } = req.params;
  const prompt = db.prepare('SELECT * FROM think_prompts WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!prompt) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM think_prompts WHERE id = ?').run(id);
  res.json({ ok: true });
});

// POST /api/think-prompts/:id/run — manual trigger
router.post('/:id/run', requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { note_id } = req.body;

  const prompt = db.prepare('SELECT * FROM think_prompts WHERE id = ? AND user_id = ?').get(id, req.userId) as any;
  if (!prompt) return res.status(404).json({ error: 'Not found' });

  const runId = nanoid();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO think_runs (id, prompt_id, user_id, scope_note_id, status, started_at)
    VALUES (?, ?, ?, ?, 'running', ?)
  `).run(runId, id, req.userId, note_id ?? null, now);

  // Return immediately, run in background
  res.json({ run_id: runId, status: 'running' });

  // Run asynchronously
  (async () => {
    try {
      const { runThinkPrompt, parseThoughtResponse } = await import('../services/claude.js');

      let noteTexts: string[] = [];

      if (prompt.scope === 'note' && note_id) {
        const note = db.prepare('SELECT body_text, title FROM notes WHERE id = ? AND user_id = ?').get(note_id, req.userId) as any;
        if (note) noteTexts = [`${note.title || 'Untitled'}\n\n${note.body_text || ''}`];
      } else if (prompt.scope === 'all') {
        const notes = db.prepare(
          'SELECT title, body_text FROM notes WHERE user_id = ? AND deleted_at IS NULL AND archived = 0 AND private = 0 ORDER BY updated_at DESC LIMIT 50'
        ).all(req.userId) as any[];
        noteTexts = notes.map(n => `${n.title || 'Untitled'}\n\n${n.body_text || ''}`);
      }

      if (noteTexts.length === 0) {
        db.prepare('UPDATE think_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
          .run('error', 'No notes found for scope', Math.floor(Date.now() / 1000), runId);
        return;
      }

      const result = await runThinkPrompt(prompt.prompt_text, noteTexts, prompt.model);
      const thoughts = parseThoughtResponse(result.text, prompt.output_type);
      const finishedAt = Math.floor(Date.now() / 1000);

      db.prepare('UPDATE think_runs SET status = ?, input_tokens = ?, output_tokens = ?, finished_at = ? WHERE id = ?')
        .run('done', result.inputTokens, result.outputTokens, finishedAt, runId);

      for (const thought of thoughts) {
        const thoughtId = nanoid();
        db.prepare(`
          INSERT INTO thoughts (id, user_id, type, title, body, source_note_id, prompt_id, run_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(thoughtId, req.userId, thought.type || prompt.output_type, thought.title ?? null, thought.body, note_id ?? null, id, runId, finishedAt);
      }
    } catch (err) {
      console.error('[think run] error:', err);
      db.prepare('UPDATE think_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
        .run('error', String(err), Math.floor(Date.now() / 1000), runId);
    }
  })();
});

export default router;
