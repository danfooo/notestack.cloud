import { Router } from 'express';
import { join, extname } from 'path';
import { mkdirSync, writeFileSync, unlink } from 'fs';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import {
  classifyLine, sortAttachmentNames, parseTxtFile,
  parseNotesCsv, parseSharedNotesCsv,
  type NoteMetadata, type ParticipantRecord,
} from '../services/importParser.js';

const router = Router();

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const UPLOAD_DIR = join(DATA_DIR, 'tmp');
mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${nanoid()}${extname(file.originalname)}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB — Apple exports can be large
});

type JobState = {
  status: 'pending' | 'running' | 'done' | 'error';
  progress: number;
  total: number;
  imported: number;
  folders_created: number;
  skipped: number;
  error?: string;
  started_at: number;
  finished_at?: number;
};

// In-memory job store (for active jobs)
const jobs = new Map<string, JobState>();

const insertJob = db.prepare(`
  INSERT INTO import_jobs (id, user_id, status, progress, total, imported, folders_created, skipped, started_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateJob = db.prepare(`
  UPDATE import_jobs SET status=?, progress=?, total=?, imported=?, folders_created=?, skipped=?, error=?, finished_at=?
  WHERE id=?
`);

// ─── Parsing helpers ──────────────────────────────────────────────────────────
// All pure parsing logic lives in ../services/importParser.ts so it can be
// exercised by the test suite without needing a database or Express context.

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
// Recently Deleted notes are in a parallel `Recently Deleted/` directory — imported with deleted_at set.

// ─── Main import processor ────────────────────────────────────────────────────

// runImport creates the in-memory job entry and executes the pipeline.
// Exported for use by the test suite; the HTTP route calls this instead of
// calling processImport directly.
export async function runImport(zipPath: string, userId: string): Promise<string> {
  const jobId = nanoid();
  const startedAt = Math.floor(Date.now() / 1000);
  const state: JobState = { status: 'pending', progress: 0, total: 0, imported: 0, folders_created: 0, skipped: 0, started_at: startedAt };
  jobs.set(jobId, state);
  insertJob.run(jobId, userId, 'pending', 0, 0, 0, 0, 0, startedAt);
  await processImport(jobId, zipPath, userId);
  return jobId;
}

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

    // ── Parse CSV metadata files ──────────────────────────────────────────
    let metadataMap = new Map<string, NoteMetadata>();
    let participantRecords: ParticipantRecord[] = [];

    if (csvPrefix !== null) {
      const notesCsvEntry = directory.files.find(f => f.path === `${csvPrefix}Notes Details.csv`);
      if (notesCsvEntry) {
        const buf = await notesCsvEntry.buffer();
        metadataMap = parseNotesCsv(buf.toString('utf-8'));
      }

      const sharedCsvEntry = directory.files.find(f => f.path === `${csvPrefix}Shared Notes Info.csv`);
      if (sharedCsvEntry) {
        const buf = await sharedCsvEntry.buffer();
        participantRecords.push(...parseSharedNotesCsv(buf.toString('utf-8'), 'sharer'));
      }

      const subscribedCsvEntry = directory.files.find(f => f.path === `${csvPrefix}Subscribed Notes Info.csv`);
      if (subscribedCsvEntry) {
        const buf = await subscribedCsvEntry.buffer();
        participantRecords.push(...parseSharedNotesCsv(buf.toString('utf-8'), 'owner'));
      }
    }

    // ── Find the Recently Deleted directory prefix ────────────────────────
    let recentlyDeletedPrefix: string | null = null;
    for (const entry of directory.files) {
      const m = entry.path.match(/^(.*\/)?(iCloud Notes\/)?Recently Deleted\//);
      if (m && (recentlyDeletedPrefix === null || m[0].length < recentlyDeletedPrefix.length)) {
        recentlyDeletedPrefix = m[0];
      }
    }

    // ── Collect note .txt files (Notes/ + Recently Deleted/) ─────────────
    const ATTACH_EXTS_SET = new Set(['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp', 'pdf', 'm4a', 'mov', 'mp4']);

    const noteEntries = directory.files.filter(f => {
      if (f.path.startsWith(notesPrefix!)) return f.path.endsWith('.txt');
      if (recentlyDeletedPrefix && f.path.startsWith(recentlyDeletedPrefix)) return f.path.endsWith('.txt');
      return false;
    });

    const attachmentEntries = directory.files.filter(f => {
      const underNotes = f.path.startsWith(notesPrefix!);
      const underDeleted = recentlyDeletedPrefix ? f.path.startsWith(recentlyDeletedPrefix) : false;
      if (!underNotes && !underDeleted) return false;
      const ext = f.path.split('.').pop()?.toLowerCase() ?? '';
      return ATTACH_EXTS_SET.has(ext);
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

    // ── Build per-wrapper-dir attachment index ────────────────────────────
    // Key: wrapper directory path (relative to notesPrefix), e.g. "Work/Rate limiting"
    // Value: sorted list of attachment filenames in that directory
    const attachmentsDir = join(DATA_DIR, 'attachments', userId);
    mkdirSync(attachmentsDir, { recursive: true });

    // Map from wrapper-dir path → sorted attachment filenames in that dir
    const dirAttachments = new Map<string, string[]>();

    for (const entry of attachmentEntries) {
      const prefix = entry.path.startsWith(notesPrefix) ? notesPrefix : (recentlyDeletedPrefix ?? notesPrefix);
      const rel = entry.path.slice(prefix.length);
      const parts = rel.split('/').filter(Boolean);
      if (parts.length < 2) continue;
      // The wrapper dir is everything except the last component (the filename)
      const dirKey = parts.slice(0, -1).join('/');
      const ext = (parts[parts.length - 1].split('.').pop() ?? '').toLowerCase();
      if (!ATTACH_EXTS_SET.has(ext)) continue;
      if (!dirAttachments.has(dirKey)) dirAttachments.set(dirKey, []);
      dirAttachments.get(dirKey)!.push(parts[parts.length - 1]);
    }

    // Sort each directory's attachment list in Apple's insertion order
    for (const [dir, files] of dirAttachments) {
      dirAttachments.set(dir, sortAttachmentNames(files));
    }

    // ── Import notes ──────────────────────────────────────────────────────
    // filePath → noteId, used later to link import_participants to notes
    const filePathToNoteId = new Map<string, string>();

    for (const entry of noteEntries) {
      try {
        // Determine if this note came from Recently Deleted/
        const isDeletedNote = recentlyDeletedPrefix ? entry.path.startsWith(recentlyDeletedPrefix) : false;
        const entryPrefix = isDeletedNote ? recentlyDeletedPrefix! : notesPrefix;

        // Path relative to its section root, e.g. "Work/Rate limiting/Rate limiting.txt"
        const rel = entry.path.slice(entryPrefix.length);
        const parts = rel.split('/').filter(Boolean);

        // parts examples:
        //   ["✅", "✅.txt"]                              → root-level note
        //   ["✅", "✅-1.txt"]                            → root-level note (duplicate title)
        //   ["Work", "Rate limiting", "Rate limiting.txt"] → note in folder "Work"

        if (parts.length < 2) {
          job.skipped++;
          continue;
        }

        // Title comes from the wrapper DIRECTORY name — never from the filename.
        // The filename may have an Apple-added -N suffix for duplicate titles;
        // the directory is always the original title.
        const wrapperDir = parts.length === 2 ? parts[0] : parts[parts.length - 2];
        const dirKey = parts.slice(0, -1).join('/');

        let folderId: string | null = null;
        if (parts.length >= 3) {
          folderId = getOrCreateFolder(parts[0]);
        }

        // Resolve attachment files for this note's directory and save them
        const attachFileNames = dirAttachments.get(dirKey) ?? [];
        const attachmentUrls: string[] = [];
        for (const filename of attachFileNames) {
          const srcEntry = attachmentEntries.find(e => e.path.endsWith(`/${dirKey}/${filename}`) || e.path === `${entryPrefix}${dirKey}/${filename}`);
          if (!srcEntry) continue;
          try {
            const buf = await srcEntry.buffer();
            const ext = '.' + (filename.split('.').pop()?.toLowerCase() ?? 'bin');
            const savedName = nanoid() + ext;
            writeFileSync(join(attachmentsDir, savedName), buf);
            attachmentUrls.push(`/attachments/${userId}/${savedName}`);
          } catch { /* skip */ }
        }

        const buf = await entry.buffer();
        const raw = buf.toString('utf-8');
        const { title: parsedTitle, bodyJson, bodyText } = parseTxtFile(raw, attachmentUrls);

        // Use file content's first line as title; fall back to wrapper directory name
        const title = parsedTitle || wrapperDir;

        const meta = metadataMap.get(title) || metadataMap.get(wrapperDir);
        const createdAt = meta?.createdAt ?? now0;
        const modifiedAt = meta?.modifiedAt ?? now0;
        const pinned = meta?.pinned ? 1 : 0;

        // Recently Deleted notes arrive pre-deleted. Set deleted_at = now so the
        // 30-day deferred hard-deletion timer starts from the time of import.
        const deletedAt = isDeletedNote ? now0 : null;

        const noteId = nanoid();
        db.prepare(`
          INSERT INTO notes (id, user_id, title, body, body_text, folder_id, pinned, deleted_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(noteId, userId, title, bodyJson, bodyText, folderId, pinned, deletedAt, createdAt, modifiedAt);

        // Full metadata snapshot in first revision
        db.prepare(`
          INSERT INTO note_revisions
            (id, note_id, title, body, body_text, folder_id, tags_json, pinned, archived, note_created_at, saved_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 0, ?, 'import', ?)
        `).run(nanoid(), noteId, title, bodyJson, bodyText, folderId, pinned, createdAt, createdAt);

        // Track file path → note id for participant linking
        filePathToNoteId.set(rel, noteId);
        // Also store without the wrapper dir component for CSV path matching
        // CSV paths look like "Work/Rate limiting/Rate limiting.txt" (relative to Notes/)
        filePathToNoteId.set(entry.path.slice(notesPrefix.length), noteId);

        job.imported++;
        job.progress = Math.round((job.imported / job.total) * 100);
      } catch (err) {
        console.error(`[import] Error processing ${entry.path}:`, err);
        job.skipped++;
      }
    }

    // ── Store import participants ──────────────────────────────────────────
    const insertParticipant = db.prepare(`
      INSERT INTO import_participants
        (id, user_id, note_id, display_name, email_masked, permission, acceptance, role, apple_shared_at, import_source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'apple_notes', ?)
    `);

    for (const p of participantRecords) {
      // CSV file paths are relative to the iCloud Notes/ root, e.g.
      // "Notes/Work/Rate limiting/Rate limiting.txt"
      // Strip the "Notes/" prefix to match our filePathToNoteId keys
      const relPath = p.filePath.replace(/^Notes\//, '');
      const noteId = filePathToNoteId.get(relPath) ?? null;

      insertParticipant.run(
        nanoid(), userId, noteId,
        p.displayName || null,
        p.emailMasked || null,
        p.permission || null,
        p.acceptance || null,
        p.role,
        p.sharedAt || null,
        now0,
      );
    }

    job.status = 'done';
    job.finished_at = Math.floor(Date.now() / 1000);
  } catch (err) {
    console.error('[import] Fatal error:', err);
    job.status = 'error';
    job.error = String(err);
    job.finished_at = Math.floor(Date.now() / 1000);
  } finally {
    updateJob.run(job.status, job.progress, job.total, job.imported, job.folders_created, job.skipped, job.error ?? null, job.finished_at ?? null, jobId);
    unlink(zipPath, err => { if (err) console.error('[import] Failed to delete zip:', err); });
  }
}

// POST /api/import/apple-notes
router.post('/apple-notes', requireAuth, upload.single('file'), (req: AuthRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const userId = req.userId!;
  const filePath = req.file.path;
  const jobId = nanoid();
  const startedAt = Math.floor(Date.now() / 1000);
  const state: JobState = { status: 'pending', progress: 0, total: 0, imported: 0, folders_created: 0, skipped: 0, started_at: startedAt };
  jobs.set(jobId, state);
  insertJob.run(jobId, userId, 'pending', 0, 0, 0, 0, 0, startedAt);
  processImport(jobId, filePath, userId);

  res.status(202).json({ job_id: jobId, status: 'pending' });
});

// GET /api/import/history
router.get('/history', requireAuth, (req: AuthRequest, res) => {
  const rows = db.prepare(
    `SELECT id, status, progress, total, imported, folders_created, skipped, error, started_at, finished_at
     FROM import_jobs WHERE user_id = ? ORDER BY started_at DESC LIMIT 50`
  ).all(req.userId!);
  // Merge in-memory state for active jobs so progress is live
  const merged = rows.map((row: any) => ({
    ...row,
    ...(jobs.has(row.id) ? jobs.get(row.id) : {}),
    job_id: row.id,
  }));
  res.json(merged);
});

// GET /api/import/:job_id
router.get('/:job_id', requireAuth, (req: AuthRequest, res) => {
  const mem = jobs.get(req.params.job_id);
  if (mem) return res.json({ job_id: req.params.job_id, ...mem });
  const row: any = db.prepare(
    `SELECT id, status, progress, total, imported, folders_created, skipped, error, started_at, finished_at
     FROM import_jobs WHERE id = ? AND user_id = ?`
  ).get(req.params.job_id, req.userId!);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  res.json({ job_id: row.id, ...row });
});

export default router;
