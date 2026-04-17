import { Router } from 'express';
import { join, extname } from 'path';
import { mkdirSync, writeFileSync, unlink } from 'fs';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import {
  classifyLine, sortAttachmentNames, parseTxtFile, parseMarkdownToTipTap, parseStorizziDate,
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
  format?: string;
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

// ─── Format detection ─────────────────────────────────────────────────────────

type ImportFormat = 'apple-privacy' | 'storizzi' | 'unknown';

function detectFormat(files: { path: string }[]): ImportFormat {
  const paths = files.map(f => f.path);
  // Storizzi: has both md/<folder>/<note>.md and data/<folder>.json
  const hasMdNotes = paths.some(p => /\/md\/[^/]+\/[^/]+\.md$/.test(p) || /^md\/[^/]+\/[^/]+\.md$/.test(p));
  const hasDataJson = paths.some(p => /\/data\/[^/]+\.json$/.test(p) || /^data\/[^/]+\.json$/.test(p));
  if (hasMdNotes && hasDataJson) return 'storizzi';
  // Apple privacy: has Notes/ directory or CSV sidecar
  const hasNotesDir = paths.some(p => /\bNotes\//.test(p));
  const hasCsv = paths.some(p => /Notes Details\.csv$/.test(p));
  if (hasNotesDir || hasCsv) return 'apple-privacy';
  return 'unknown';
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

// runImport creates the in-memory job entry and executes the pipeline.
// Exported for use by the test suite.
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
    const format = detectFormat(directory.files);
    job.format = format;

    if (format === 'storizzi') {
      await processStorizziImport(jobId, directory, userId);
    } else {
      await processApplePrivacyImport(jobId, directory, userId);
    }
  } catch (err) {
    console.error('[import] Fatal error:', err);
    const j = jobs.get(jobId)!;
    j.status = 'error';
    j.error = String(err);
    j.finished_at = Math.floor(Date.now() / 1000);
  }
}

// ─── Apple privacy export processor ──────────────────────────────────────────
//
// Apple Notes privacy export ZIP structure:
//
//   iCloud Notes/
//     Notes/                         ← live notes, folder hierarchy by depth
//     Recently Deleted/              ← deleted notes
//     Notes Details.csv              ← created/modified/pinned metadata
//     Shared Notes Info.csv          ← notes you shared
//     Subscribed Notes Info.csv      ← notes shared with you
//
// See metadata/apple-notes-export-format.html for full spec.

async function processApplePrivacyImport(jobId: string, directory: any, userId: string) {
  const job = jobs.get(jobId)!;

  try {
    // ── Find root of the Notes directory within the zip ──────────────────
    let notesPrefix: string | null = null;
    let csvPrefix: string | null = null;

    for (const entry of directory.files) {
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
      job.error = 'Could not find Notes/ directory inside the zip. Make sure you\'re uploading an Apple iCloud Notes export or a storizzi notes-exporter zip.';
      job.finished_at = Math.floor(Date.now() / 1000);
      return;
    }

    // ── Parse CSV metadata files ──────────────────────────────────────────
    let metadataMap = new Map<string, NoteMetadata>();
    let participantRecords: ParticipantRecord[] = [];

    if (csvPrefix !== null) {
      const notesCsvEntry = directory.files.find((f: any) => f.path === `${csvPrefix}Notes Details.csv`);
      if (notesCsvEntry) {
        const buf = await notesCsvEntry.buffer();
        metadataMap = parseNotesCsv(buf.toString('utf-8'));
      }

      const sharedCsvEntry = directory.files.find((f: any) => f.path === `${csvPrefix}Shared Notes Info.csv`);
      if (sharedCsvEntry) {
        const buf = await sharedCsvEntry.buffer();
        participantRecords.push(...parseSharedNotesCsv(buf.toString('utf-8'), 'sharer'));
      }

      const subscribedCsvEntry = directory.files.find((f: any) => f.path === `${csvPrefix}Subscribed Notes Info.csv`);
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

    const noteEntries = directory.files.filter((f: any) => {
      if (f.path.startsWith(notesPrefix!)) return f.path.endsWith('.txt');
      if (recentlyDeletedPrefix && f.path.startsWith(recentlyDeletedPrefix)) return f.path.endsWith('.txt');
      return false;
    });

    const attachmentEntries = directory.files.filter((f: any) => {
      const underNotes = f.path.startsWith(notesPrefix!);
      const underDeleted = recentlyDeletedPrefix ? f.path.startsWith(recentlyDeletedPrefix) : false;
      if (!underNotes && !underDeleted) return false;
      const ext = f.path.split('.').pop()?.toLowerCase() ?? '';
      return ATTACH_EXTS_SET.has(ext);
    });

    job.total = noteEntries.length;

    // ── Build folder map ──────────────────────────────────────────────────
    const folderDbMap = new Map<string, string>();
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
    const attachmentsDir = join(DATA_DIR, 'attachments', userId);
    mkdirSync(attachmentsDir, { recursive: true });

    const dirAttachments = new Map<string, string[]>();

    for (const entry of attachmentEntries) {
      const prefix = entry.path.startsWith(notesPrefix) ? notesPrefix : (recentlyDeletedPrefix ?? notesPrefix);
      const rel = entry.path.slice(prefix.length);
      const parts = rel.split('/').filter(Boolean);
      if (parts.length < 2) continue;
      const dirKey = parts.slice(0, -1).join('/');
      const ext = (parts[parts.length - 1].split('.').pop() ?? '').toLowerCase();
      if (!ATTACH_EXTS_SET.has(ext)) continue;
      if (!dirAttachments.has(dirKey)) dirAttachments.set(dirKey, []);
      dirAttachments.get(dirKey)!.push(parts[parts.length - 1]);
    }

    for (const [dir, files] of dirAttachments) {
      dirAttachments.set(dir, sortAttachmentNames(files));
    }

    // ── Import notes ──────────────────────────────────────────────────────
    const filePathToNoteId = new Map<string, string>();

    for (const entry of noteEntries) {
      try {
        const isDeletedNote = recentlyDeletedPrefix ? entry.path.startsWith(recentlyDeletedPrefix) : false;
        const entryPrefix = isDeletedNote ? recentlyDeletedPrefix! : notesPrefix;

        const rel = entry.path.slice(entryPrefix.length);
        const parts = rel.split('/').filter(Boolean);

        if (parts.length < 2) { job.skipped++; continue; }

        const wrapperDir = parts.length === 2 ? parts[0] : parts[parts.length - 2];
        const dirKey = parts.slice(0, -1).join('/');

        let folderId: string | null = null;
        if (parts.length >= 3) {
          folderId = getOrCreateFolder(parts[0]);
        }

        const attachFileNames = dirAttachments.get(dirKey) ?? [];
        const attachmentUrls: string[] = [];
        for (const filename of attachFileNames) {
          const srcEntry = attachmentEntries.find((e: any) => e.path.endsWith(`/${dirKey}/${filename}`) || e.path === `${entryPrefix}${dirKey}/${filename}`);
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
        const { bodyJson, bodyText } = parseTxtFile(raw, attachmentUrls);

        const title = null;

        const meta = metadataMap.get(wrapperDir);
        const createdAt = meta?.createdAt ?? now0;
        const modifiedAt = meta?.modifiedAt ?? now0;
        const pinned = meta?.pinned ? 1 : 0;
        const deletedAt = isDeletedNote ? now0 : null;

        const noteId = nanoid();
        db.prepare(`
          INSERT INTO notes (id, user_id, title, body, body_text, folder_id, pinned, deleted_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(noteId, userId, title, bodyJson, bodyText, folderId, pinned, deletedAt, createdAt, modifiedAt);

        db.prepare(`
          INSERT INTO note_revisions
            (id, note_id, title, body, body_text, folder_id, tags_json, pinned, archived, note_created_at, saved_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 0, ?, 'import', ?)
        `).run(nanoid(), noteId, title, bodyJson, bodyText, folderId, pinned, createdAt, createdAt);

        filePathToNoteId.set(rel, noteId);
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
    console.error('[import] Fatal error (apple-privacy):', err);
    job.status = 'error';
    job.error = String(err);
    job.finished_at = Math.floor(Date.now() / 1000);
  } finally {
    updateJob.run(job.status, job.progress, job.total, job.imported, job.folders_created, job.skipped, job.error ?? null, job.finished_at ?? null, jobId);
    unlink(zipPath, err => { if (err) console.error('[import] Failed to delete zip:', err); });
  }
}

// ─── storizzi/notes-exporter processor ───────────────────────────────────────
//
// storizzi output ZIP structure (may have an arbitrary outer wrapper directory):
//
//   [wrapper/]
//     md/
//       iCloud-Notes/
//         attachments/
//           <note-filename>-attachment-001.png
//         <note-filename>-<id>.md
//       iCloud-Work/
//         ...
//       iCloud-Recently-Deleted/
//         ...
//     data/
//       iCloud-Notes.json      ← { "<id>": { created, modified, filename, ... } }
//       iCloud-Work.json
//       ...
//
// The folder directories are named <account>-<folder> (default: iCloud-<folder>).
// We strip the common account prefix from all folder names to get display names.
// iCloud-Recently-Deleted is imported with deleted_at set; no folder is created.
//
// See metadata/import-formats.md for full format comparison.

async function processStorizziImport(jobId: string, directory: any, userId: string) {
  const job = jobs.get(jobId)!;

  try {
    const files: { path: string; buffer: () => Promise<Buffer> }[] = directory.files;

    // ── Find md/ and data/ prefixes (strip any outer wrapper dir) ────────
    let mdPrefix: string | null = null;
    let dataPrefix: string | null = null;

    for (const f of files) {
      if (f.path.endsWith('.md')) {
        const m = f.path.match(/^(.*\/)md\/[^/]+\/[^/]+\.md$/) ?? f.path.match(/^()md\/[^/]+\/[^/]+\.md$/);
        if (m) {
          const prefix = m[1];
          if (mdPrefix === null || prefix.length < mdPrefix.length) mdPrefix = prefix;
        }
      }
      if (f.path.endsWith('.json')) {
        const m = f.path.match(/^(.*\/)data\/[^/]+\.json$/) ?? f.path.match(/^()data\/[^/]+\.json$/);
        if (m) {
          const prefix = m[1];
          if (dataPrefix === null || prefix.length < dataPrefix.length) dataPrefix = prefix;
        }
      }
    }

    if (mdPrefix === null || dataPrefix === null) {
      job.status = 'error';
      job.error = 'Could not find md/ and data/ directories in the zip. Make sure you\'re uploading a storizzi notes-exporter export.';
      job.finished_at = Math.floor(Date.now() / 1000);
      return;
    }

    const mdBase = `${mdPrefix}md/`;
    const dataBase = `${dataPrefix}data/`;

    // ── Collect folder names from md/ ─────────────────────────────────────
    const folderDirNames = new Set<string>();
    for (const f of files) {
      if (f.path.startsWith(mdBase)) {
        const rel = f.path.slice(mdBase.length);
        const folderDir = rel.split('/')[0];
        if (folderDir) folderDirNames.add(folderDir);
      }
    }

    // Strip the common account prefix (e.g. "iCloud-") from all folder names.
    // If every folder starts with the same "WORD-" token, strip it.
    const folderList = [...folderDirNames];
    let accountPrefix = '';
    if (folderList.length > 0) {
      const firstDash = folderList[0].indexOf('-');
      if (firstDash > 0) {
        const candidate = folderList[0].slice(0, firstDash + 1);
        if (folderList.every(n => n.startsWith(candidate))) {
          accountPrefix = candidate;
        }
      }
    }

    const displayName = (dirName: string) => dirName.slice(accountPrefix.length);
    const isRecentlyDeleted = (dirName: string) =>
      displayName(dirName).replace(/-/g, ' ').toLowerCase() === 'recently deleted';

    // ── Load all metadata JSON files ──────────────────────────────────────
    // noteMetaByDir: folderDirName → Map<noteId, { created, modified, filename }>
    type StorizziNoteMeta = { created: number; modified: number; filename: string };
    const noteMetaByDir = new Map<string, Map<string, StorizziNoteMeta>>();

    for (const folderDir of folderDirNames) {
      const jsonPath = `${dataBase}${folderDir}.json`;
      const jsonEntry = files.find(f => f.path === jsonPath);
      if (!jsonEntry) continue;
      const buf = await jsonEntry.buffer();
      const raw = JSON.parse(buf.toString('utf-8')) as Record<string, any>;
      const metaMap = new Map<string, StorizziNoteMeta>();
      for (const [id, rec] of Object.entries(raw)) {
        metaMap.set(id, {
          created: parseStorizziDate(rec.created ?? ''),
          modified: parseStorizziDate(rec.modified ?? ''),
          filename: rec.filename ?? '',
        });
      }
      noteMetaByDir.set(folderDir, metaMap);
    }

    // ── Count total notes ──────────────────────────────────────────────────
    const noteFiles = files.filter(f => {
      if (!f.path.startsWith(mdBase) || !f.path.endsWith('.md')) return false;
      const rel = f.path.slice(mdBase.length);
      const parts = rel.split('/');
      // parts: [folderDir, noteFile.md] — skip anything under attachments/
      return parts.length === 2 && parts[1] !== '';
    });
    job.total = noteFiles.length;

    // ── Create DB folder records ───────────────────────────────────────────
    const now0 = Math.floor(Date.now() / 1000);
    const folderDbMap = new Map<string, string>(); // folderDir → DB folder id

    for (const folderDir of folderDirNames) {
      if (isRecentlyDeleted(folderDir)) continue; // no folder for recently-deleted
      const name = displayName(folderDir);
      const folderId = nanoid();
      db.prepare(`
        INSERT INTO folders (id, user_id, parent_id, name, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?)
      `).run(folderId, userId, name, now0, now0);
      folderDbMap.set(folderDir, folderId);
      job.folders_created++;
    }

    // ── Build attachment map for a note ───────────────────────────────────
    const attachmentsDir = join(DATA_DIR, 'attachments', userId);
    mkdirSync(attachmentsDir, { recursive: true });

    // Returns a Map<relPath, servedUrl> for all attachments belonging to noteFilename.
    // relPath matches what the Markdown references: "./attachments/<filename>"
    async function buildAttachmentUrlMap(folderDir: string, noteFilename: string): Promise<Map<string, string>> {
      const prefix = `${mdBase}${folderDir}/attachments/${noteFilename}-attachment-`;
      const urlMap = new Map<string, string>();
      for (const f of files) {
        if (!f.path.startsWith(prefix)) continue;
        try {
          const buf = await f.buffer();
          const originalName = f.path.split('/').pop()!;
          // Normalise extension: svg+xml → svg, jpeg → jpeg, etc.
          const rawExt = originalName.split('.').pop() ?? 'bin';
          const ext = rawExt.replace(/\+.*$/, ''); // strip MIME suffix e.g. svg+xml → svg
          const savedName = nanoid() + '.' + ext;
          writeFileSync(join(attachmentsDir, savedName), buf);
          const relPath = `./attachments/${originalName}`;
          urlMap.set(relPath, `/attachments/${userId}/${savedName}`);
        } catch { /* skip broken attachment */ }
      }
      return urlMap;
    }

    // ── Import notes ──────────────────────────────────────────────────────
    for (const noteEntry of noteFiles) {
      try {
        const rel = noteEntry.path.slice(mdBase.length); // "iCloud-Notes/note-1234.md"
        const parts = rel.split('/');
        const folderDir = parts[0];
        const noteFile = parts[1]; // "note-1234.md"

        // Extract Apple note ID (number suffix before .md)
        const idMatch = noteFile.match(/-(\d+)\.md$/);
        const noteId = idMatch?.[1] ?? '';

        const metaMap = noteMetaByDir.get(folderDir);
        const meta = noteId ? metaMap?.get(noteId) : undefined;
        const noteFilename = meta?.filename ?? noteFile.replace(/\.md$/, '');

        const createdAt = meta?.created ?? now0;
        const modifiedAt = meta?.modified ?? now0;
        const folderId = folderDbMap.get(folderDir) ?? null;
        const deletedAt = isRecentlyDeleted(folderDir) ? now0 : null;

        const urlMap = await buildAttachmentUrlMap(folderDir, noteFilename);

        const buf = await noteEntry.buffer();
        const mdText = buf.toString('utf-8');
        const { bodyJson, bodyText } = parseMarkdownToTipTap(mdText, urlMap);

        const dbNoteId = nanoid();
        db.prepare(`
          INSERT INTO notes (id, user_id, title, body, body_text, folder_id, pinned, deleted_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
        `).run(dbNoteId, userId, null, bodyJson, bodyText, folderId, deletedAt, createdAt, modifiedAt);

        db.prepare(`
          INSERT INTO note_revisions
            (id, note_id, title, body, body_text, folder_id, tags_json, pinned, archived, note_created_at, saved_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, '[]', 0, 0, ?, 'import', ?)
        `).run(nanoid(), dbNoteId, null, bodyJson, bodyText, folderId, createdAt, createdAt);

        job.imported++;
        job.progress = Math.round((job.imported / job.total) * 100);
      } catch (err) {
        console.error(`[import] Error processing storizzi note ${noteEntry.path}:`, err);
        job.skipped++;
      }
    }

    job.status = 'done';
    job.finished_at = Math.floor(Date.now() / 1000);
  } catch (err) {
    console.error('[import] Fatal error (storizzi):', err);
    job.status = 'error';
    job.error = String(err);
    job.finished_at = Math.floor(Date.now() / 1000);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/import/apple-notes
// Accepts both Apple privacy export ZIPs and storizzi/notes-exporter ZIPs.
// Format is auto-detected from the ZIP contents.
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
