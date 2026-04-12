import cron from 'node-cron';
import { nanoid } from 'nanoid';
import { db } from './db/index.js';

// Run scheduled think prompts every minute
cron.schedule('* * * * *', async () => {
  try {
    const now = Math.floor(Date.now() / 1000);

    const prompts = db.prepare(`
      SELECT * FROM think_prompts
      WHERE trigger = 'scheduled' AND enabled = 1 AND schedule IS NOT NULL
    `).all() as any[];

    for (const prompt of prompts) {
      // Check if we should run this prompt based on its schedule
      // For simplicity, we check if a run has been started in the last minute
      const lastRun = db.prepare(`
        SELECT started_at FROM think_runs
        WHERE prompt_id = ? ORDER BY started_at DESC LIMIT 1
      `).get(prompt.id) as any;

      // Parse the cron schedule to determine if it should run now
      const shouldRun = shouldRunNow(prompt.schedule, lastRun?.started_at);
      if (!shouldRun) continue;

      const runId = nanoid();
      db.prepare(`
        INSERT INTO think_runs (id, prompt_id, user_id, status, started_at)
        VALUES (?, ?, ?, 'running', ?)
      `).run(runId, prompt.id, prompt.user_id, now);

      // Run asynchronously
      runScheduledPrompt(runId, prompt).catch(err => {
        console.error(`[cron] Error running prompt ${prompt.name}:`, err);
      });
    }
  } catch (err) {
    console.error('[cron] Error in scheduled think runner:', err);
  }
});

function shouldRunNow(schedule: string, lastRunAt: number | undefined): boolean {
  try {
    const now = new Date();
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5) return false;

    const [min, hour, dom, month, dow] = parts;

    const matchesPart = (part: string, value: number): boolean => {
      if (part === '*') return true;
      const num = parseInt(part);
      if (!isNaN(num)) return num === value;
      return false;
    };

    const matches = (
      matchesPart(min, now.getMinutes()) &&
      matchesPart(hour, now.getHours()) &&
      matchesPart(dom, now.getDate()) &&
      matchesPart(month, now.getMonth() + 1) &&
      matchesPart(dow, now.getDay())
    );

    if (!matches) return false;

    // Don't run if already ran in the last 2 minutes (prevent double-runs)
    if (lastRunAt && (Math.floor(Date.now() / 1000) - lastRunAt) < 120) return false;

    return true;
  } catch {
    return false;
  }
}

async function runScheduledPrompt(runId: string, prompt: any) {
  try {
    const { runThinkPrompt, parseThoughtResponse } = await import('./services/claude.js');

    let noteTexts: string[] = [];

    if (prompt.scope === 'all') {
      const notes = db.prepare(`
        SELECT title, body_text FROM notes
        WHERE user_id = ? AND deleted_at IS NULL AND archived = 0
        ORDER BY updated_at DESC LIMIT 100
      `).all(prompt.user_id) as any[];
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
      db.prepare(`
        INSERT INTO thoughts (id, user_id, type, title, body, prompt_id, run_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nanoid(), prompt.user_id, thought.type || prompt.output_type,
        thought.title ?? null, thought.body, prompt.id, runId, finishedAt
      );
    }

    console.log(`[cron] Completed scheduled prompt "${prompt.name}" for user ${prompt.user_id}`);
  } catch (err) {
    console.error(`[cron] Error in runScheduledPrompt:`, err);
    db.prepare('UPDATE think_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
      .run('error', String(err), Math.floor(Date.now() / 1000), runId);
  }
}

export {};
