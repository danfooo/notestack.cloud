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

// ─── Attachment ordering ──────────────────────────────────────────────────────
// Apple names attachments using the same suffix convention as note files:
//   Attachment.png, Attachment-1.png, Attachment-2.png, ...
// The no-suffix file is first; -1, -2, ... follow in order.
// Each U+FFFC in the text (reading top to bottom) corresponds to the next
// attachment in this sorted list.

function sortAttachmentNames(names: string[]): string[] {
  return [...names].sort((a, b) => {
    // Strip extension for comparison
    const stripExt = (s: string) => s.replace(/\.[^.]+$/, '');
    const baseA = stripExt(a).replace(/-(\d+)$/, '');
    const baseB = stripExt(b).replace(/-(\d+)$/, '');
    if (baseA !== baseB) return baseA.localeCompare(baseB);
    const numA = parseInt(stripExt(a).match(/-(\d+)$/)?.[1] ?? '-1');
    const numB = parseInt(stripExt(b).match(/-(\d+)$/)?.[1] ?? '-1');
    return numA - numB;
  });
}

// ─── Text → TipTap JSON converter ────────────────────────────────────────────

type LineKind = 'empty' | 'unchecked' | 'checked' | 'bullet' | 'image' | 'text';

function classifyLine(line: string): { kind: LineKind; text: string; imageCount?: number } {
  if (UNCHECKED_RE.test(line)) return { kind: 'unchecked', text: line.replace(UNCHECKED_RE, '').trimEnd() };
  if (CHECKED_RE.test(line))   return { kind: 'checked',   text: line.replace(CHECKED_RE, '').trimEnd() };
  if (DASH_BULLET.test(line))  return { kind: 'bullet',    text: line.slice(2).trimEnd() };
  if (STAR_BULLET.test(line))  return { kind: 'bullet',    text: line.slice(2).trimEnd() };
  if (!line.trim()) return { kind: 'empty', text: '' };

  // Count ￼ characters on this line
  const objCount = (line.match(new RegExp(OBJ_CHAR, 'g')) ?? []).length;
  if (objCount > 0 && line.replace(new RegExp(OBJ_CHAR, 'g'), '').trim() === '') {
    return { kind: 'image', text: '', imageCount: objCount };
  }

  return { kind: 'text', text: line.trimEnd() };
}

function makeTextNode(text: string) {
  return text ? [{ type: 'text', text }] : [];
}

// attachmentUrls: ordered list of served URLs for attachments in this note.
// Each 'image' line pops from the front of this queue.
function textToTipTap(lines: string[], attachmentUrls: string[] = []): string {
  const content: any[] = [];
  let i = 0;
  let attachIdx = 0;

  while (i < lines.length) {
    const classified = classifyLine(lines[i]);
    const { kind, text } = classified;

    if (kind === 'empty') {
      i++;
      continue;
    }

    if (kind === 'image') {
      const count = classified.imageCount ?? 1;
      for (let j = 0; j < count; j++) {
        const url = attachmentUrls[attachIdx++] ?? null;
        if (url) {
          content.push({ type: 'image', attrs: { src: url, alt: null, title: null } });
        }
        // If no URL available (attachment file missing), silently skip
      }
      i++;
      continue;
    }

    if (kind === 'unchecked' || kind === 'checked') {
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

    content.push({ type: 'paragraph', content: makeTextNode(text) });
    i++;
  }

  if (content.length === 0) content.push({ type: 'paragraph' });
  return JSON.stringify({ type: 'doc', content });
}

function parseTxtFile(raw: string, attachmentUrls: string[] = []): { title: string; bodyJson: string; bodyText: string } {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  // First non-empty line is the title
  let titleIdx = 0;
  while (titleIdx < lines.length && !lines[titleIdx].trim()) titleIdx++;
  const title = lines[titleIdx]?.trim() || 'Untitled';

  // Body starts after title + any immediately following blank line
  let bodyStart = titleIdx + 1;
  while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;

  const bodyLines = lines.slice(bodyStart);
  const bodyJson = textToTipTap(bodyLines, attachmentUrls);
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

// ─── Shared Notes CSV parsers ─────────────────────────────────────────────────
// Shared Notes Info.csv header:
//   File Name, Shared On, Last Modified Date, Participants Details
//
// Subscribed Notes Info.csv header:
//   File Name, Owner Details, Last Modified Date, Shared On, Participants Details
//
// Participants Details format (pipe-separated entries, semicolon-separated fields):
//   "Name:Alice; Email:a*****@web.de; Permission:READ_WRITE; Acceptance Status:ACCEPTED | Name:Bob; ..."
// Owner Details format:
//   "Name:X; Email:Y"

interface ParticipantRecord {
  filePath: string;       // the note's relative file path from the CSV
  sharedAt: number;
  displayName: string;
  emailMasked: string;
  permission: string;
  acceptance: string;
  role: 'sharer' | 'owner';
}

function parseParticipantBlock(block: string, role: 'sharer' | 'owner'): Omit<ParticipantRecord, 'filePath' | 'sharedAt'>[] {
  const results: Omit<ParticipantRecord, 'filePath' | 'sharedAt'>[] = [];
  // Each participant separated by " | "
  const entries = block.split('|').map(s => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const fields: Record<string, string> = {};
    for (const part of entry.split(';')) {
      const idx = part.indexOf(':');
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim().toLowerCase().replace(/\s+/g, '_');
      fields[key] = part.slice(idx + 1).trim();
    }
    results.push({
      displayName: fields['name'] ?? '',
      emailMasked: fields['email'] ?? '',
      permission: fields['permission'] ?? '',
      acceptance: fields['acceptance_status'] ?? fields['acceptance'] ?? '',
      role,
    });
  }
  return results;
}

function parseSharedNotesCsv(csv: string, role: 'sharer' | 'owner'): ParticipantRecord[] {
  const records: ParticipantRecord[] = [];
  const lines = csv.split('\n');

  // Detect column positions from header
  const header = parseCsvLine(lines[0] ?? '').map(h => h.trim().toLowerCase());
  const fileIdx        = header.findIndex(h => h === 'file name');
  const sharedOnIdx    = role === 'sharer'
    ? header.findIndex(h => h === 'shared on')
    : header.findIndex(h => h === 'shared on');
  const participantsIdx = header.findIndex(h => h.includes('participants'));
  const ownerIdx       = header.findIndex(h => h.includes('owner'));

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCsvLine(line);

    const filePath   = fields[fileIdx]?.trim() ?? '';
    const sharedAtRaw = fields[sharedOnIdx]?.trim() ?? '';
    const sharedAt   = sharedAtRaw ? parseCsvDate(sharedAtRaw) : 0;

    // For subscribed notes the "owner" is a single person block
    if (role === 'owner' && ownerIdx !== -1) {
      const ownerBlock = fields[ownerIdx]?.trim() ?? '';
      const parsed = parseParticipantBlock(ownerBlock, 'owner');
      for (const p of parsed) records.push({ filePath, sharedAt, ...p });
    }

    // Participants column (present in both CSVs)
    if (participantsIdx !== -1) {
      const participantsBlock = fields[participantsIdx]?.trim() ?? '';
      const parsed = parseParticipantBlock(participantsBlock, role);
      for (const p of parsed) records.push({ filePath, sharedAt, ...p });
    }
  }

  return records;
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

    // ── Collect note .txt files (skip Recently Deleted) ───────────────────
    const noteEntries = directory.files.filter(f => {
      if (!f.path.startsWith(notesPrefix!)) return false;
      if (f.path.includes('Recently Deleted/')) return false;
      return f.path.endsWith('.txt');
    });

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

    // ── Build per-wrapper-dir attachment index ────────────────────────────
    // Key: wrapper directory path (relative to notesPrefix), e.g. "Work/Rate limiting"
    // Value: sorted list of attachment filenames in that directory
    const attachmentsDir = join(process.cwd(), 'data', 'attachments', userId);
    mkdirSync(attachmentsDir, { recursive: true });

    // Map from wrapper-dir path → sorted attachment filenames in that dir
    const dirAttachments = new Map<string, string[]>();
    const ATTACH_EXTS = new Set(['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp', 'pdf', 'm4a', 'mov', 'mp4']);

    for (const entry of attachmentEntries) {
      const rel = entry.path.slice(notesPrefix.length);
      const parts = rel.split('/').filter(Boolean);
      if (parts.length < 2) continue;
      // The wrapper dir is everything except the last component (the filename)
      const dirKey = parts.slice(0, -1).join('/');
      const ext = (parts[parts.length - 1].split('.').pop() ?? '').toLowerCase();
      if (!ATTACH_EXTS.has(ext)) continue;
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
        // Path relative to notesPrefix, e.g. "Work/Rate limiting/Rate limiting.txt"
        const rel = entry.path.slice(notesPrefix.length);
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
          const srcEntry = attachmentEntries.find(e => e.path.endsWith(`/${dirKey}/${filename}`) || e.path === `${notesPrefix}${dirKey}/${filename}`);
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

        const noteId = nanoid();
        db.prepare(`
          INSERT INTO notes (id, user_id, title, body, body_text, folder_id, pinned, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(noteId, userId, title, bodyJson, bodyText, folderId, pinned, createdAt, modifiedAt);

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
