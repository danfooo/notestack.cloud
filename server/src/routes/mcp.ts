import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { mcpAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

// MCP tool definitions
const TOOLS = [
  {
    name: 'search_notes',
    description: 'Search notes by full-text query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        folder_id: { type: 'string', description: 'Optional folder ID to search within' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_note',
    description: 'Fetch a note by ID (returns title + plain text body)',
    inputSchema: {
      type: 'object',
      properties: {
        note_id: { type: 'string', description: 'Note ID' },
      },
      required: ['note_id'],
    },
  },
  {
    name: 'list_notes',
    description: 'List notes in a folder or all notes',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: { type: 'string', description: 'Optional folder ID' },
        limit: { type: 'number', description: 'Max results (default 20)' },
        offset: { type: 'number', description: 'Pagination offset' },
      },
    },
  },
  {
    name: 'create_note',
    description: 'Create a new note',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Note title' },
        body_markdown: { type: 'string', description: 'Note body as plain text or markdown' },
        folder_id: { type: 'string', description: 'Optional folder ID' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_note',
    description: "Update an existing note's body",
    inputSchema: {
      type: 'object',
      properties: {
        note_id: { type: 'string', description: 'Note ID' },
        body_markdown: { type: 'string', description: 'New body as plain text' },
        title: { type: 'string', description: 'New title' },
      },
      required: ['note_id'],
    },
  },
  {
    name: 'list_folders',
    description: 'Return the folder tree',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_thoughts',
    description: 'Return recent thoughts',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by type: summary, todo, connection, theme, free' },
        note_id: { type: 'string', description: 'Filter by source note' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'create_thought',
    description: 'Write a new thought (store insights, decisions, summaries)',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Thought type: summary, todo, connection, theme, free' },
        title: { type: 'string', description: 'Thought title' },
        body: { type: 'string', description: 'Thought body (markdown)' },
        source_note_id: { type: 'string', description: 'Optional source note ID' },
        source_anchor: { type: 'string', description: 'Optional anchor within the note' },
      },
      required: ['type', 'body'],
    },
  },
  {
    name: 'get_dashboard',
    description: 'Return a structured dashboard summary',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'run_prompt',
    description: 'Trigger a named think prompt manually',
    inputSchema: {
      type: 'object',
      properties: {
        prompt_name: { type: 'string', description: 'Name of the think prompt to run' },
        note_id: { type: 'string', description: 'Optional note ID for note-scoped prompts' },
      },
      required: ['prompt_name'],
    },
  },
];

async function handleTool(name: string, args: Record<string, any>, userId: string): Promise<any> {
  switch (name) {
    case 'search_notes': {
      const { query, folder_id, limit = 10 } = args;
      let sql = `
        SELECT id, title, body_text, folder_id, updated_at
        FROM notes
        WHERE user_id = ? AND deleted_at IS NULL AND (title LIKE ? OR body_text LIKE ?)
      `;
      const params: unknown[] = [userId, `%${query}%`, `%${query}%`];
      if (folder_id) { sql += ' AND folder_id = ?'; params.push(folder_id); }
      sql += ' ORDER BY updated_at DESC LIMIT ?';
      params.push(Math.min(limit, 50));
      return db.prepare(sql).all(...params);
    }

    case 'get_note': {
      const note = db.prepare(`
        SELECT id, title, body_text, folder_id, pinned, tags_json.tags, created_at, updated_at
        FROM notes
        LEFT JOIN (
          SELECT note_id, GROUP_CONCAT(tag) as tags FROM note_tags GROUP BY note_id
        ) tags_json ON notes.id = tags_json.note_id
        WHERE notes.id = ? AND notes.user_id = ? AND deleted_at IS NULL
      `).get(args.note_id, userId) as any;
      if (!note) throw new Error('Note not found');
      return { ...note, tags: note.tags ? note.tags.split(',') : [] };
    }

    case 'list_notes': {
      const { folder_id, limit = 20, offset = 0 } = args;
      let sql = `
        SELECT id, title, body_text, folder_id, pinned, updated_at
        FROM notes
        WHERE user_id = ? AND deleted_at IS NULL AND archived = 0
      `;
      const params: unknown[] = [userId];
      if (folder_id) { sql += ' AND folder_id = ?'; params.push(folder_id); }
      sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
      params.push(Math.min(limit, 100), offset);
      return db.prepare(sql).all(...params);
    }

    case 'create_note': {
      const { title, body_markdown = '', folder_id, tags } = args;
      const now = Math.floor(Date.now() / 1000);
      const id = nanoid();
      const body = JSON.stringify({
        type: 'doc',
        content: body_markdown.split('\n').filter((l: string) => l.trim()).map((line: string) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: line }],
        })),
      });
      const bodyText = body_markdown;

      db.prepare(`
        INSERT INTO notes (id, user_id, title, body, body_text, folder_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, userId, title, body, bodyText, folder_id ?? null, now, now);

      if (Array.isArray(tags)) {
        for (const tag of tags) {
          db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)').run(id, tag);
        }
      }

      // Save revision
      db.prepare(`
        INSERT INTO note_revisions (id, note_id, body, body_text, saved_by, created_at)
        VALUES (?, ?, ?, ?, 'claude', ?)
      `).run(nanoid(), id, body, bodyText, now);

      return db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    }

    case 'update_note': {
      const { note_id, body_markdown, title } = args;
      const note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(note_id, userId) as any;
      if (!note) throw new Error('Note not found');

      const now = Math.floor(Date.now() / 1000);
      const updates: string[] = ['updated_at = ?'];
      const values: unknown[] = [now];

      if (title !== undefined) { updates.push('title = ?'); values.push(title); }
      if (body_markdown !== undefined) {
        const body = JSON.stringify({
          type: 'doc',
          content: body_markdown.split('\n').filter((l: string) => l.trim()).map((line: string) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: line }],
          })),
        });
        updates.push('body = ?', 'body_text = ?');
        values.push(body, body_markdown);

        db.prepare(`
          INSERT INTO note_revisions (id, note_id, body, body_text, saved_by, created_at)
          VALUES (?, ?, ?, ?, 'claude', ?)
        `).run(nanoid(), note_id, body, body_markdown, now);
      }

      values.push(note_id);
      db.prepare(`UPDATE notes SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      return db.prepare('SELECT * FROM notes WHERE id = ?').get(note_id);
    }

    case 'list_folders': {
      const folders = db.prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY position ASC, name ASC').all(userId) as any[];
      const map = new Map<string, any>();
      const roots: any[] = [];
      for (const f of folders) map.set(f.id, { ...f, children: [] });
      for (const f of folders) {
        if (f.parent_id && map.has(f.parent_id)) map.get(f.parent_id).children.push(map.get(f.id));
        else roots.push(map.get(f.id)!);
      }
      return roots;
    }

    case 'list_thoughts': {
      const { type, note_id, limit = 20 } = args;
      let sql = 'SELECT * FROM thoughts WHERE user_id = ? AND superseded_by IS NULL';
      const params: unknown[] = [userId];
      if (type) { sql += ' AND type = ?'; params.push(type); }
      if (note_id) { sql += ' AND source_note_id = ?'; params.push(note_id); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(Math.min(limit, 100));
      return db.prepare(sql).all(...params);
    }

    case 'create_thought': {
      const { type, title, body, source_note_id, source_anchor } = args;
      const id = nanoid();
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT INTO thoughts (id, user_id, type, title, body, source_note_id, source_anchor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, userId, type, title ?? null, body, source_note_id ?? null, source_anchor ?? null, now);
      return db.prepare('SELECT * FROM thoughts WHERE id = ?').get(id);
    }

    case 'get_dashboard': {
      const pinned = db.prepare(`SELECT id, title, body_text, updated_at FROM notes WHERE user_id = ? AND pinned = 1 AND deleted_at IS NULL LIMIT 5`).all(userId);
      const recent = db.prepare(`SELECT id, title, body_text, updated_at FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5`).all(userId);
      const todos = db.prepare(`SELECT * FROM thoughts WHERE user_id = ? AND type = 'todo' AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 10`).all(userId);
      const thoughts = db.prepare(`SELECT * FROM thoughts WHERE user_id = ? AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 5`).all(userId);
      return { pinned_notes: pinned, recent_notes: recent, active_todos: todos, recent_thoughts: thoughts };
    }

    case 'run_prompt': {
      const { prompt_name, note_id } = args;
      const prompt = db.prepare('SELECT * FROM think_prompts WHERE user_id = ? AND name = ? LIMIT 1').get(userId, prompt_name) as any;
      if (!prompt) throw new Error(`Prompt "${prompt_name}" not found`);

      const runId = nanoid();
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT INTO think_runs (id, prompt_id, user_id, scope_note_id, status, started_at)
        VALUES (?, ?, ?, ?, 'running', ?)
      `).run(runId, prompt.id, userId, note_id ?? null, now);

      // Run async
      (async () => {
        try {
          const { runThinkPrompt, parseThoughtResponse } = await import('../services/claude.js');
          let noteTexts: string[] = [];

          if (note_id) {
            const note = db.prepare('SELECT body_text, title FROM notes WHERE id = ?').get(note_id) as any;
            if (note) noteTexts = [`${note.title || 'Untitled'}\n\n${note.body_text || ''}`];
          } else {
            const notes = db.prepare('SELECT title, body_text FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50').all(userId) as any[];
            noteTexts = notes.map(n => `${n.title || 'Untitled'}\n\n${n.body_text || ''}`);
          }

          if (noteTexts.length === 0) {
            db.prepare('UPDATE think_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
              .run('error', 'No notes found', Math.floor(Date.now() / 1000), runId);
            return;
          }

          const result = await runThinkPrompt(prompt.prompt_text, noteTexts, prompt.model);
          const thoughts = parseThoughtResponse(result.text, prompt.output_type);
          const finishedAt = Math.floor(Date.now() / 1000);

          db.prepare('UPDATE think_runs SET status = ?, input_tokens = ?, output_tokens = ?, finished_at = ? WHERE id = ?')
            .run('done', result.inputTokens, result.outputTokens, finishedAt, runId);

          for (const thought of thoughts) {
            db.prepare(`
              INSERT INTO thoughts (id, user_id, type, title, body, source_note_id, prompt_id, run_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(nanoid(), userId, thought.type || prompt.output_type, thought.title ?? null, thought.body, note_id ?? null, prompt.id, runId, finishedAt);
          }
        } catch (err) {
          db.prepare('UPDATE think_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
            .run('error', String(err), Math.floor(Date.now() / 1000), runId);
        }
      })();

      return { run_id: runId, status: 'running' };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// POST /mcp
router.post('/', mcpAuth, async (req: AuthRequest, res) => {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== '2.0') {
    return res.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
  }

  try {
    let result: any;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'brains', version: '0.1.0' },
        };
        break;

      case 'tools/list':
        result = { tools: TOOLS };
        break;

      case 'tools/call': {
        const { name, arguments: args = {} } = params || {};
        if (!name) throw { code: -32602, message: 'Tool name required' };

        const toolResult = await handleTool(name, args, req.userId!);
        result = {
          content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }],
        };
        break;
      }

      case 'notifications/initialized':
        result = {};
        break;

      default:
        return res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }

    res.json({ jsonrpc: '2.0', id, result });
  } catch (err: any) {
    const code = err.code ?? -32603;
    const message = err.message ?? 'Internal error';
    res.json({ jsonrpc: '2.0', id, error: { code, message } });
  }
});

export default router;
