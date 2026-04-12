import { Router } from 'express';
import { join, extname, basename } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

const UPLOAD_DIR = join(process.cwd(), 'data', 'tmp');
mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${nanoid()}${extname(file.originalname)}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
});

// In-memory job store (simple, fine for V1)
const jobs = new Map<string, {
  status: 'pending' | 'running' | 'done' | 'error';
  progress: number;
  total: number;
  imported: number;
  folders_created: number;
  error?: string;
  started_at: number;
  finished_at?: number;
}>();

function htmlToBodyText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function htmlToTipTapJson(html: string): string {
  // Simple HTML to TipTap JSON conversion
  const content: any[] = [];

  // Remove HTML/head/body wrapper if present
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;

  // Split by block elements
  const cleaned = bodyHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n');

  const lines = cleaned.split('\n').map(l => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean);

  for (const line of lines) {
    content.push({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    });
  }

  if (content.length === 0) {
    content.push({ type: 'paragraph' });
  }

  return JSON.stringify({ type: 'doc', content });
}

async function processImport(jobId: string, zipPath: string, userId: string) {
  const job = jobs.get(jobId)!;
  job.status = 'running';

  try {
    const unzipper = await import('unzipper');
    const directory = await unzipper.Open.file(zipPath);
    const entries = directory.files.filter((f: any) => !f.path.endsWith('/'));

    job.total = entries.filter((e: any) =>
      e.path.endsWith('.html') || e.path.endsWith('.htm') || e.path.endsWith('.enex')
    ).length;

    // First pass: collect folder names from directory paths
    const folderMap = new Map<string, string>(); // path -> folder_id

    for (const entry of entries) {
      const parts = entry.path.split('/');
      if (parts.length > 1) {
        // Build folder hierarchy
        let currentPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
          const parentPath = currentPath;
          currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];

          if (!folderMap.has(currentPath)) {
            const folderId = nanoid();
            const parentFolderId = parentPath ? folderMap.get(parentPath) ?? null : null;
            const now = Math.floor(Date.now() / 1000);

            db.prepare(`
              INSERT INTO folders (id, user_id, parent_id, name, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(folderId, userId, parentFolderId, parts[i], now, now);

            folderMap.set(currentPath, folderId);
            job.folders_created++;
          }
        }
      }
    }

    // Second pass: import notes
    const attachmentsDir = join(process.cwd(), 'data', 'attachments', userId);
    mkdirSync(attachmentsDir, { recursive: true });

    for (const entry of entries) {
      const ext = extname(entry.path).toLowerCase();

      if (ext === '.html' || ext === '.htm') {
        try {
          const content = await entry.buffer();
          const html = content.toString('utf-8');
          const title = basename(entry.path, ext).replace(/[_-]/g, ' ');
          const body = htmlToTipTapJson(html);
          const bodyText = htmlToBodyText(html);
          const now = Math.floor(Date.now() / 1000);
          const noteId = nanoid();

          // Determine folder from path
          const parts = entry.path.split('/');
          let folderId: string | null = null;
          if (parts.length > 1) {
            const folderPath = parts.slice(0, -1).join('/');
            folderId = folderMap.get(folderPath) ?? null;
          }

          db.prepare(`
            INSERT INTO notes (id, user_id, title, body, body_text, folder_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(noteId, userId, title, body, bodyText, folderId, now, now);

          // Save initial revision
          const revId = nanoid();
          db.prepare(`
            INSERT INTO note_revisions (id, note_id, body, body_text, saved_by, created_at)
            VALUES (?, ?, ?, ?, 'import', ?)
          `).run(revId, noteId, body, bodyText, now);

          job.imported++;
          job.progress = Math.round((job.imported / job.total) * 100);
        } catch (err) {
          console.error(`[import] Error processing ${entry.path}:`, err);
        }
      } else if (ext === '.enex') {
        // Basic ENEX support — extract note titles and content
        try {
          const content = await entry.buffer();
          const xml = content.toString('utf-8');

          // Extract notes from ENEX format
          const noteMatches = xml.matchAll(/<note>([\s\S]*?)<\/note>/gi);
          for (const match of noteMatches) {
            const noteXml = match[1];
            const titleMatch = noteXml.match(/<title>([\s\S]*?)<\/title>/i);
            const contentMatch = noteXml.match(/<content>([\s\S]*?)<\/content>/i);

            if (contentMatch) {
              const title = titleMatch ? titleMatch[1].trim() : 'Imported Note';
              const contentHtml = contentMatch[1].replace(/<!\[CDATA\[/, '').replace(/\]\]>/, '');
              const body = htmlToTipTapJson(contentHtml);
              const bodyText = htmlToBodyText(contentHtml);
              const now = Math.floor(Date.now() / 1000);
              const noteId = nanoid();

              db.prepare(`
                INSERT INTO notes (id, user_id, title, body, body_text, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(noteId, userId, title, body, bodyText, now, now);

              const revId = nanoid();
              db.prepare(`
                INSERT INTO note_revisions (id, note_id, body, body_text, saved_by, created_at)
                VALUES (?, ?, ?, ?, 'import', ?)
              `).run(revId, noteId, body, bodyText, now);

              job.imported++;
              job.progress = Math.round((job.imported / job.total) * 100);
            }
          }
        } catch (err) {
          console.error(`[import] Error processing ENEX ${entry.path}:`, err);
        }
      } else if (ext.match(/\.(png|jpg|jpeg|gif|webp|svg)$/)) {
        // Save image attachments
        try {
          const content = await entry.buffer();
          const filename = `${nanoid()}${ext}`;
          writeFileSync(join(attachmentsDir, filename), content);
        } catch (err) {
          console.error(`[import] Error saving attachment ${entry.path}:`, err);
        }
      }
    }

    job.status = 'done';
    job.finished_at = Math.floor(Date.now() / 1000);
  } catch (err) {
    console.error('[import] Fatal error:', err);
    job.status = 'error';
    job.error = String(err);
    job.finished_at = Math.floor(Date.now() / 1000);
  }
}

// POST /api/import/apple-notes
router.post('/apple-notes', requireAuth, upload.single('file'), (req: AuthRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const jobId = nanoid();
  jobs.set(jobId, {
    status: 'pending',
    progress: 0,
    total: 0,
    imported: 0,
    folders_created: 0,
    started_at: Math.floor(Date.now() / 1000),
  });

  // Start async processing
  processImport(jobId, req.file.path, req.userId!);

  res.status(202).json({ job_id: jobId, status: 'pending' });
});

// GET /api/import/:job_id
router.get('/:job_id', requireAuth, (req: AuthRequest, res) => {
  const { job_id } = req.params;
  const job = jobs.get(job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ job_id, ...job });
});

export default router;
