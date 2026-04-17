import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

/** Parse the JSON trigger array stored in the DB row. */
function parsePromptRow(row: any) {
  try {
    row.trigger = JSON.parse(row.trigger);
    if (!Array.isArray(row.trigger)) row.trigger = [row.trigger];
  } catch {
    row.trigger = [row.trigger];
  }
  return row;
}

/** Run a single think prompt in the background, writing results to the DB. */
async function runPromptAsync(
  prompt: any,
  runId: string,
  userId: string,
  noteId?: string | null,
) {
  try {
    const { runThinkPrompt, parseThoughtResponse } = await import('../services/claude.js');

    let noteTexts: string[] = [];
    let noteIds: string[] = [];

    if (noteId) {
      // Single-note run — skip archived/private
      const note = db.prepare(
        'SELECT body_text, title FROM notes WHERE id = ? AND user_id = ? AND archived = 0 AND private = 0 AND deleted_at IS NULL'
      ).get(noteId, userId) as any;
      if (!note) {
        db.prepare('UPDATE think_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
          .run('error', 'Note not found or is archived/private', Math.floor(Date.now() / 1000), runId);
        return;
      }
      noteTexts = [`${note.title || 'Untitled'}\n\n${note.body_text || ''}`];
      noteIds = [noteId];
    } else if (prompt.scope === 'note') {
      // on_dashboard or scheduled scope:note — run against recent notes individually
      const notes = db.prepare(
        'SELECT id, title, body_text FROM notes WHERE user_id = ? AND deleted_at IS NULL AND archived = 0 AND private = 0 ORDER BY updated_at DESC LIMIT 10'
      ).all(userId) as any[];
      noteTexts = notes.map((n: any) => `${n.title || 'Untitled'}\n\n${n.body_text || ''}`);
      noteIds = notes.map((n: any) => n.id);
    } else {
      // scope:all — combine all recent notes
      const notes = db.prepare(
        'SELECT title, body_text FROM notes WHERE user_id = ? AND deleted_at IS NULL AND archived = 0 AND private = 0 ORDER BY updated_at DESC LIMIT 100'
      ).all(userId) as any[];
      noteTexts = notes.map((n: any) => `${n.title || 'Untitled'}\n\n${n.body_text || ''}`);
    }

    if (noteTexts.length === 0) {
      db.prepare('UPDATE think_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
        .run('error', 'No eligible notes found', Math.floor(Date.now() / 1000), runId);
      return;
    }

    const finishedAt = Math.floor(Date.now() / 1000);

    if (noteIds.length > 1) {
      // Run scope:note prompts against each note individually
      let totalInput = 0;
      let totalOutput = 0;

      for (let i = 0; i < noteTexts.length; i++) {
        const nId = noteIds[i];
        const result = await runThinkPrompt(prompt.prompt_text, [noteTexts[i]], prompt.model);
        totalInput += result.inputTokens;
        totalOutput += result.outputTokens;
        const thoughts = parseThoughtResponse(result.text, prompt.output_type);
        const oldThoughts = db.prepare(
          'SELECT id FROM thoughts WHERE prompt_id = ? AND source_note_id = ? AND superseded_by IS NULL'
        ).all(prompt.id, nId) as any[];

        for (const thought of thoughts) {
          const thoughtId = nanoid();
          db.prepare(
            'INSERT INTO thoughts (id, user_id, type, title, body, source_note_id, prompt_id, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(thoughtId, userId, thought.type || prompt.output_type, thought.title ?? null, thought.body, nId, prompt.id, runId, finishedAt);
          for (const old of oldThoughts) {
            db.prepare('UPDATE thoughts SET superseded_by = ? WHERE id = ?').run(thoughtId, old.id);
          }
        }
      }

      db.prepare('UPDATE think_runs SET status = ?, input_tokens = ?, output_tokens = ?, finished_at = ? WHERE id = ?')
        .run('done', totalInput, totalOutput, finishedAt, runId);
    } else {
      // Single note or scope:all — one API call
      const scopeNoteId = noteIds[0] ?? null;
      const result = await runThinkPrompt(prompt.prompt_text, noteTexts, prompt.model);
      const thoughts = parseThoughtResponse(result.text, prompt.output_type);

      if (scopeNoteId) {
        const oldThoughts = db.prepare(
          'SELECT id FROM thoughts WHERE prompt_id = ? AND source_note_id = ? AND superseded_by IS NULL'
        ).all(prompt.id, scopeNoteId) as any[];

        for (const thought of thoughts) {
          const thoughtId = nanoid();
          db.prepare(
            'INSERT INTO thoughts (id, user_id, type, title, body, source_note_id, prompt_id, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(thoughtId, userId, thought.type || prompt.output_type, thought.title ?? null, thought.body, scopeNoteId, prompt.id, runId, finishedAt);
          for (const old of oldThoughts) {
            db.prepare('UPDATE thoughts SET superseded_by = ? WHERE id = ?').run(thoughtId, old.id);
          }
        }
      } else {
        for (const thought of thoughts) {
          db.prepare(
            'INSERT INTO thoughts (id, user_id, type, title, body, source_note_id, prompt_id, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(nanoid(), userId, thought.type || prompt.output_type, thought.title ?? null, thought.body, null, prompt.id, runId, finishedAt);
        }
      }

      db.prepare('UPDATE think_runs SET status = ?, input_tokens = ?, output_tokens = ?, finished_at = ? WHERE id = ?')
        .run('done', result.inputTokens, result.outputTokens, finishedAt, runId);
    }
  } catch (err) {
    console.error('[think run] error:', err);
    db.prepare('UPDATE think_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
      .run('error', String(err), Math.floor(Date.now() / 1000), runId);
  }
}

// GET /api/think-prompts
router.get('/', requireAuth, (req: AuthRequest, res) => {
  const prompts = db.prepare(
    'SELECT * FROM think_prompts WHERE user_id = ? ORDER BY created_at ASC'
  ).all(req.userId) as any[];
  res.json(prompts.map(parsePromptRow));
});

// POST /api/think-prompts
router.post('/', requireAuth, (req: AuthRequest, res) => {
  const { name, description, prompt_text, output_type, scope, trigger, schedule, model, enabled } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (!prompt_text?.trim()) return res.status(400).json({ error: 'Prompt text required' });

  const triggers = Array.isArray(trigger) ? trigger : [trigger ?? 'manual'];
  const now = Math.floor(Date.now() / 1000);
  const id = nanoid();

  db.prepare(`
    INSERT INTO think_prompts (id, user_id, name, description, prompt_text, output_type, scope, trigger, schedule, model, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.userId, name.trim(), description ?? null, prompt_text.trim(),
    output_type ?? 'free', scope ?? 'note', JSON.stringify(triggers),
    schedule ?? null, model ?? 'claude-opus-4-6', enabled !== false ? 1 : 0, now, now
  );

  const prompt = db.prepare('SELECT * FROM think_prompts WHERE id = ?').get(id);
  res.status(201).json(parsePromptRow(prompt));
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
  if (trigger !== undefined) {
    const triggers = Array.isArray(trigger) ? trigger : [trigger];
    updates.push('"trigger" = ?');
    values.push(JSON.stringify(triggers));
  }
  if (schedule !== undefined) { updates.push('schedule = ?'); values.push(schedule); }
  if (model !== undefined) { updates.push('model = ?'); values.push(model); }
  if (enabled !== undefined) { updates.push('enabled = ?'); values.push(enabled ? 1 : 0); }

  values.push(id);
  db.prepare(`UPDATE think_prompts SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM think_prompts WHERE id = ?').get(id);
  res.json(parsePromptRow(updated));
});

// DELETE /api/think-prompts/:id
router.delete('/:id', requireAuth, (req: AuthRequest, res) => {
  const { id } = req.params;
  const prompt = db.prepare('SELECT * FROM think_prompts WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!prompt) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM think_prompts WHERE id = ?').run(id);
  res.json({ ok: true });
});

// POST /api/think-prompts/:id/run — manual trigger for a specific prompt
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

  res.json({ run_id: runId, status: 'running' });

  runPromptAsync(parsePromptRow(prompt), runId, req.userId!, note_id ?? null).catch(err => {
    console.error('[think run] unhandled:', err);
  });
});

// POST /api/think-prompts/fire — fire all enabled prompts matching a trigger type
// Used by the client when visiting /dashboard (trigger: 'on_dashboard').
// Skips prompts already run within the last 30 minutes.
router.post('/fire', requireAuth, async (req: AuthRequest, res) => {
  const { trigger } = req.body;
  if (!trigger || typeof trigger !== 'string') {
    return res.status(400).json({ error: 'trigger required' });
  }

  const cooldownCutoff = Math.floor(Date.now() / 1000) - 30 * 60;

  const prompts = db.prepare(`
    SELECT tp.* FROM think_prompts tp
    WHERE tp.user_id = ? AND tp.enabled = 1
      AND EXISTS (SELECT 1 FROM json_each(tp."trigger") WHERE value = ?)
      AND NOT EXISTS (
        SELECT 1 FROM think_runs tr
        WHERE tr.prompt_id = tp.id AND tr.started_at > ?
      )
  `).all(req.userId, trigger, cooldownCutoff) as any[];

  const now = Math.floor(Date.now() / 1000);
  const runIds: string[] = [];

  for (const prompt of prompts) {
    const runId = nanoid();
    db.prepare(
      'INSERT INTO think_runs (id, prompt_id, user_id, status, started_at) VALUES (?, ?, ?, ?, ?)'
    ).run(runId, prompt.id, req.userId, 'running', now);
    runIds.push(runId);
  }

  res.json({ fired: runIds.length, run_ids: runIds });

  for (let i = 0; i < prompts.length; i++) {
    runPromptAsync(parsePromptRow(prompts[i]), runIds[i], req.userId!).catch(err => {
      console.error('[fire] unhandled:', err);
    });
  }
});

export default router;
