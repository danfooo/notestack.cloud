import { Router } from 'express';
import { join, extname } from 'path';
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
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB — Apple exports can be large
});

// In-memory job store
const jobs = new Map<string, {
  status: 'pending' | 'running' | 'done' | 'error';
  progress: number;
  total: number;
  imported: number;
  folders_created: number;
  skipped: number;
  error?: string;
  started_at: number;
  finished_at?: number;
}>();

// ─── Apple Notes format constants ────────────────────────────────────────────
// From hex analysis of real Apple privacy exports:
//   09 e2 97 a6 09  →  TAB + U+25E6 (WHITE BULLET ◦) + TAB  = unchecked checklist item
//   09 e2 9c 93 09  →  TAB + U+2713 (CHECK MARK ✓) + TAB    = checked checklist item
//   ef bf bc        →  U+FFFC (OBJECT REPLACEMENT CHARACTER ￼) = embedded image/attachment

const UNCHECKED_RE = /^\t\u25E6\t/;  // TAB + ◦ + TAB
const CHECKED_RE   = /^\t\u2713\t/;  // TAB + ✓ + TAB
const DASH_BULLET  = /^- /;
const STAR_BULLET  = /^\* /;
const OBJ_CHAR     = '\uFFFC';

// ─── Text → TipTap JSON converter ────────────────────────────────────────────

type LineKind = 'empty' | 'unchecked' | 'checked' | 'bullet' | 'text';

function classifyLine(line: string): { kind: LineKind; text: string } {
  if (UNCHECKED_RE.test(line)) return { kind: 'unchecked', text: line.replace(UNCHECKED_RE, '').trimEnd() };
  if (CHECKED_RE.test(line))   return { kind: 'checked',   text: line.replace(CHECKED_RE, '').trimEnd() };
  if (DASH_BULLET.test(line))  return { kind: 'bullet',    text: line.slice(2).trimEnd() };
  if (STAR_BULLET.test(line))  return { kind: 'bullet',    text: line.slice(2).trimEnd() };

  // A line that is only ￼ characters (embedded object placeholder) — skip it
  if (line.replace(new RegExp(OBJ_CHAR, 'g'), '').trim() === '') return { kind: 'empty', text: '' };

  if (!line.trim()) return { kind: 'empty', text: '' };

  return { kind: 'text', text: line.trimEnd() };
}

function makeTextNode(text: string) {
  return text ? [{ type: 'text', text }] : [];
}

function textToTipTap(lines: string[]): string {
  const content: any[] = [];
  let i = 0;

  while (i < lines.length) {
    const { kind, text } = classifyLine(lines[i]);

    if (kind === 'empty') {
      i++;
      continue;
    }

    if (kind === 'unchecked' || kind === 'checked') {
      // Collect a run of consecutive checklist items (checked and unchecked can mix)
      const items: any[] = [];
      while (i < lines.length) {
        const c = classifyLine(lines[i]);
        if (c.kind !== 'unchecked' && c.kind !== 'checked') break;
        items.push({
          type: 'taskItem',
          attrs: { checked: c.kind === 'checked' },
          content: [{ type: 'paragraph', content: makeTextNode(c.text) }],
        });
        i++;
      }
      if (items.length) content.push({ type: 'taskList', content: items });
      continue;
    }

    if (kind === 'bullet') {
      // Collect a run of consecutive bullet items
      const items: any[] = [];
      while (i < lines.length) {
        const c = classifyLine(lines[i]);
        if (c.kind !== 'bullet') break;
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: makeTextNode(c.text) }],
        });
        i++;
      }
      if (items.length) content.push({ type: 'bulletList', content: items });
      continue;
    }

    // Regular text paragraph
    content.push({ type: 'paragraph', content: makeTextNode(text) });
    i++;
  }

  if (content.length === 0) content.push({ type: 'paragraph' });
  return JSON.stringify({ type: 'doc', content });
}

function parseTxtFile(raw: string): { title: string; bodyJson: string; bodyText: string } {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  // First non-empty line is the title
  let titleIdx = 0;
  while (titleIdx < lines.length && !lines[titleIdx].trim()) titleIdx++;
  const title = lines[titleIdx]?.trim() || 'Untitled';

  // Body starts after title + any immediately following blank line
  let bodyStart = titleIdx + 1;
  while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;

  const bodyLines = lines.slice(bodyStart);
  const bodyJson = textToTipTap(bodyLines);
  const bodyText = bodyLines
    .map(l => classifyLine(l).text)
    .filter(Boolean)
    .join(' ');

  return { title, bodyJson, bodyText };
}

// ─── Notes Details.csv parser ─────────────────────────────────────────────────
// Header: Title, Created On, Modified On, Pinned, Deleted, Drawing/Handwriting, ContentHash at Import
// Date format: MM-DD-YYYY HH:MM:SS

function parseCsvDate(s: string): number {
  // "MM-DD-YYYY HH:MM:SS" → Unix timestamp
  const m = s.trim().match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return Math.floor(Date.now() / 1000);
  const [, mo, dd, yyyy, hh, mm, ss] = m;
  return Math.floor(new Date(`${yyyy}-${mo}-${dd}T${hh}:${mm}:${ss}Z`).getTime() / 1000);
}

function parseCsvLine(line: string): string[] {
  // Simple CSV parser that handles quoted fields
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

interface NoteMetadata {
  createdAt: number;
  modifiedAt: number;
  pinned: boolean;
  deleted: boolean;
}

function parseNotesCsv(csv: string): Map<string, NoteMetadata> {
  const map = new Map<string, NoteMetadata>();
  const lines = csv.split('\n');
  // Skip header (line 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCsvLine(line);
    if (fields.length < 5) continue;
    const [title, createdStr, modifiedStr, pinnedStr, deletedStr] = fields;
    map.set(title.trim(), {
      createdAt: parseCsvDate(createdStr),
      modifiedAt: parseCsvDate(modifiedStr),
      pinned: pinnedStr.trim().toLowerCase() === 'yes',
      deleted: deletedStr.trim().toLowerCase() === 'yes',
    });
  }
  return map;
}

// ─── Path analysis ────────────────────────────────────────────────────────────
//
// Apple Notes export structure inside the zip:
//
//   [anything]/iCloud Notes/Notes/
//     [FolderName]/[NoteTitle]/[NoteTitle].txt   → note in a folder
//     [NoteTitle]/[NoteTitle].txt                → note at root level (no folder)
//     [NoteTitle]/[NoteTitle]-1.txt              → another note with same title
//
// Rules:
//   - Find the `Notes/` directory within the zip by scanning paths
//   - Each .txt file's path relative to `Notes/` is parsed as:
//     • depth 2: `[NoteWrap]/[NoteWrap].txt`    → root-level note
//     • depth 3: `[Folder]/[NoteWrap]/[Note].txt` → note inside folder
//   - Strip `-N` numeric suffix from note filename to get canonical title
//   - Non-.txt files in the same directory as a .txt are attachments
//
// Recently Deleted notes are in a parallel `Recently Deleted/` directory — skip by default.

function stripNSuffix(name: string): string {
  return name.replace(/-\d+$/, '');
}

// ─── Main import processor ────────────────────────────────────────────────────

async function processImport(jobId: string, zipPath: string, userId: string) {
  const job = jobs.get(jobId)!;
  job.status = 'running';

  try {
    const unzipper = await import('unzipper');
    const directory = await unzipper.Open.file(zipPath);

    // ── Find root of the Notes directory within the zip ──────────────────
    // Look for the path prefix that leads to `Notes/`
    let notesPrefix: string | null = null;
    let csvPrefix: string | null = null;

    for (const entry of directory.files) {
      // Match something like "*/iCloud Notes/Notes/" or "Notes/" at root
      const m = entry.path.match(/^(.*\/)?(iCloud Notes\/)?Notes\//);
      if (m && (notesPrefix === null || m[0].length < notesPrefix.length)) {
        notesPrefix = m[0];
      }
      const cm = entry.path.match(/^(.*\/)?Notes Details\.csv$/);
      if (cm) {
        csvPrefix = cm[1] ?? '';
      }
    }

    if (!notesPrefix) {
      job.status = 'error';
      job.error = 'Could not find Notes/ directory inside the zip. Make sure you\'re uploading an Apple iCloud Notes export.';
      job.finished_at = Math.floor(Date.now() / 1000);
      return;
    }

    // ── Parse Notes Details.csv for metadata ─────────────────────────────
    let metadataMap = new Map<string, NoteMetadata>();
    const csvEntry = csvPrefix !== null
      ? directory.files.find(f => f.path === `${csvPrefix}Notes Details.csv`)
      : null;
    if (csvEntry) {
      const buf = await csvEntry.buffer();
      metadataMap = parseNotesCsv(buf.toString('utf-8'));
    }

    // ── Collect note .txt files (skip Recently Deleted) ───────────────────
    const noteEntries = directory.files.filter(f => {
      if (!f.path.startsWith(notesPrefix!)) return false;
      if (f.path.includes('Recently Deleted/')) return false;
      return f.path.endsWith('.txt');
    });

    // Count of attachment files (non-txt, non-csv, non-.DS_Store)
    const attachmentEntries = directory.files.filter(f => {
      if (!f.path.startsWith(notesPrefix!)) return false;
      if (f.path.includes('Recently Deleted/')) return false;
      const ext = f.path.split('.').pop()?.toLowerCase() ?? '';
      return ['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp', 'pdf', 'm4a', 'mov', 'mp4'].includes(ext);
    });

    job.total = noteEntries.length;

    // ── Build folder map ──────────────────────────────────────────────────
    // folderMap: apple-folder-name → folder_id in DB
    const folderDbMap = new Map<string, string>(); // folderName → DB folder id
    const now0 = Math.floor(Date.now() / 1000);

    function getOrCreateFolder(folderName: string): string {
      if (folderDbMap.has(folderName)) return folderDbMap.get(folderName)!;
      const folderId = nanoid();
      db.prepare(`
        INSERT INTO folders (id, user_id, parent_id, name, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?)
      `).run(folderId, userId, folderName, now0, now0);
      folderDbMap.set(folderName, folderId);
      job.folders_created++;
      return folderId;
    }

    // ── Import attachments ────────────────────────────────────────────────
    const attachmentsDir = join(process.cwd(), 'data', 'attachments', userId);
    mkdirSync(attachmentsDir, { recursive: true });

    for (const entry of attachmentEntries) {
      try {
        const buf = await entry.buffer();
        const ext = '.' + (entry.path.split('.').pop()?.toLowerCase() ?? 'bin');
        writeFileSync(join(attachmentsDir, nanoid() + ext), buf);
      } catch { /* skip failed attachments */ }
    }

    // ── Import notes ──────────────────────────────────────────────────────
    for (const entry of noteEntries) {
      try {
        // Path relative to notesPrefix, e.g. "Work/Rate limiting/Rate limiting.txt"
        const rel = entry.path.slice(notesPrefix.length);
        const parts = rel.split('/').filter(Boolean);

        // parts examples:
        //   ["✅.txt"]                                → shouldn't happen (no wrapping folder)
        //   ["✅", "✅.txt"]                          → root-level note
        //   ["✅", "✅-1.txt"]                        → root-level note (duplicate title)
        //   ["Work", "Rate limiting", "Rate limiting.txt"] → note in folder "Work"

        if (parts.length < 2) {
          job.skipped++;
          continue;
        }

        const fileName = parts[parts.length - 1].replace('.txt', '');
        const baseTitle = stripNSuffix(fileName);

        let folderId: string | null = null;

        if (parts.length === 2) {
          // Root-level note: parts[0] is the wrapper dir (same as note title)
          folderId = null;
        } else {
          // Note inside a folder: parts[0] is the Apple Notes folder name
          folderId = getOrCreateFolder(parts[0]);
        }

        const buf = await entry.buffer();
        const raw = buf.toString('utf-8');
        const { title: parsedTitle, bodyJson, bodyText } = parseTxtFile(raw);

        // Prefer parsed title from file content; fall back to folder/file name
        const title = parsedTitle || baseTitle;

        // Look up metadata from CSV (match by title)
        const meta = metadataMap.get(title) || metadataMap.get(baseTitle);
        const createdAt = meta?.createdAt ?? now0;
        const modifiedAt = meta?.modifiedAt ?? now0;
        const pinned = meta?.pinned ? 1 : 0;

        const noteId = nanoid();
        db.prepare(`
          INSERT INTO notes (id, user_id, title, body, body_text, folder_id, pinned, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(noteId, userId, title, bodyJson, bodyText, folderId, pinned, createdAt, modifiedAt);

        const revId = nanoid();
        db.prepare(`
          INSERT INTO note_revisions (id, note_id, body, body_text, saved_by, created_at)
          VALUES (?, ?, ?, ?, 'import', ?)
        `).run(revId, noteId, bodyJson, bodyText, createdAt);

        job.imported++;
        job.progress = Math.round((job.imported / job.total) * 100);
      } catch (err) {
        console.error(`[import] Error processing ${entry.path}:`, err);
        job.skipped++;
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
    skipped: 0,
    started_at: Math.floor(Date.now() / 1000),
  });

  processImport(jobId, req.file.path, req.userId!);

  res.status(202).json({ job_id: jobId, status: 'pending' });
});

// GET /api/import/:job_id
router.get('/:job_id', requireAuth, (req: AuthRequest, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ job_id: req.params.job_id, ...job });
});

export default router;
