// ── Apple Notes privacy-export parser ────────────────────────────────────────
//
// Pure functions with no database or filesystem dependencies. All the logic
// lives here so it can be exercised in isolation by the test suite.
//
// Format reference: metadata/apple-notes-export-format.html
//
// Key encoding facts (confirmed via hexdump of real exports):
//   09 e2 97 a6 09  → TAB + U+25E6 (◦, WHITE BULLET) + TAB  = unchecked item
//   09 e2 9c 93 09  → TAB + U+2713 (✓, CHECK MARK)   + TAB  = checked item
//   ef bf bc        → U+FFFC (OBJECT REPLACEMENT CHARACTER ￼) = inline attachment
//   "- text"        → dash-style bullet  (bulletList, listStyle: 'dash')
//   "* text"        → round-bullet list  (bulletList, no extra attrs)

export const UNCHECKED_RE = /^\t\u25E6\t/;
export const CHECKED_RE   = /^\t\u2713\t/;
export const DASH_BULLET  = /^- /;
export const STAR_BULLET  = /^\* /;
export const OBJ_CHAR     = '\uFFFC';

// Two distinct bullet kinds preserve the original Apple Notes visual difference:
//   dashBullet → bulletList with attrs.listStyle='dash'  (CSS: list-style-type: "- ")
//   starBullet → bulletList with no extra attrs          (CSS: default disc bullet)
export type LineKind = 'empty' | 'unchecked' | 'checked' | 'dashBullet' | 'starBullet' | 'image' | 'text';

export function classifyLine(line: string): { kind: LineKind; text: string; imageCount?: number } {
  if (UNCHECKED_RE.test(line)) return { kind: 'unchecked',  text: line.replace(UNCHECKED_RE, '').trimEnd() };
  if (CHECKED_RE.test(line))   return { kind: 'checked',    text: line.replace(CHECKED_RE, '').trimEnd() };
  if (DASH_BULLET.test(line))  return { kind: 'dashBullet', text: line.slice(2).trimEnd() };
  if (STAR_BULLET.test(line))  return { kind: 'starBullet', text: line.slice(2).trimEnd() };
  if (!line.trim())            return { kind: 'empty',      text: '' };

  const objCount = (line.match(new RegExp(OBJ_CHAR, 'g')) ?? []).length;
  if (objCount > 0 && line.replace(new RegExp(OBJ_CHAR, 'g'), '').trim() === '') {
    return { kind: 'image', text: '', imageCount: objCount };
  }

  return { kind: 'text', text: line.trimEnd() };
}

// ── Attachment ordering ───────────────────────────────────────────────────────
// Apple names attachments: Attachment.png (first), Attachment-1.png, -2.png, …
// Sort order: no-suffix first, then -1, -2, … (not alphabetical — -10 after -9).

export function sortAttachmentNames(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const stripExt = (s: string) => s.replace(/\.[^.]+$/, '');
    const baseA = stripExt(a).replace(/-(\d+)$/, '');
    const baseB = stripExt(b).replace(/-(\d+)$/, '');
    if (baseA !== baseB) return baseA.localeCompare(baseB);
    const numA = parseInt(stripExt(a).match(/-(\d+)$/)?.[1] ?? '-1');
    const numB = parseInt(stripExt(b).match(/-(\d+)$/)?.[1] ?? '-1');
    return numA - numB;
  });
}

// ── TipTap JSON builder ───────────────────────────────────────────────────────

function makeTextNode(text: string) {
  return text ? [{ type: 'text', text }] : [];
}

// attachmentUrls: served URLs in the same order as sorted attachment files.
// Each 'image' line consumes one URL per ￼ on that line.
export function textToTipTap(lines: string[], attachmentUrls: string[] = []): string {
  const content: any[] = [];
  let i = 0;
  let attachIdx = 0;

  while (i < lines.length) {
    const classified = classifyLine(lines[i]);
    const { kind, text } = classified;

    if (kind === 'empty') { i++; continue; }

    if (kind === 'image') {
      const count = classified.imageCount ?? 1;
      for (let j = 0; j < count; j++) {
        const url = attachmentUrls[attachIdx++] ?? null;
        if (url) content.push({ type: 'image', attrs: { src: url, alt: null, title: null } });
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

    if (kind === 'dashBullet' || kind === 'starBullet') {
      const items: any[] = [];
      while (i < lines.length) {
        const c = classifyLine(lines[i]);
        if (c.kind !== kind) break;
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: makeTextNode(c.text) }],
        });
        i++;
      }
      if (items.length) {
        const node: any = { type: 'bulletList', content: items };
        if (kind === 'dashBullet') node.attrs = { listStyle: 'dash' };
        content.push(node);
      }
      continue;
    }

    content.push({ type: 'paragraph', content: makeTextNode(text) });
    i++;
  }

  if (content.length === 0) content.push({ type: 'paragraph' });
  return JSON.stringify({ type: 'doc', content });
}

export function parseTxtFile(
  raw: string,
  attachmentUrls: string[] = [],
): { title: string; bodyJson: string; bodyText: string } {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  let titleIdx = 0;
  while (titleIdx < lines.length && !lines[titleIdx].trim()) titleIdx++;
  const title = lines[titleIdx]?.trim() || 'Untitled';

  let bodyStart = titleIdx + 1;
  while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;

  const bodyLines = lines.slice(bodyStart);
  const bodyJson = textToTipTap(bodyLines, attachmentUrls);
  const bodyText = bodyLines.map(l => classifyLine(l).text).filter(Boolean).join(' ');

  return { title, bodyJson, bodyText };
}

// ── CSV parsers ───────────────────────────────────────────────────────────────

export function parseCsvDate(s: string): number {
  const m = s.trim().match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return Math.floor(Date.now() / 1000);
  const [, mo, dd, yyyy, hh, mm, ss] = m;
  return Math.floor(new Date(`${yyyy}-${mo}-${dd}T${hh}:${mm}:${ss}Z`).getTime() / 1000);
}

export function parseCsvLine(line: string): string[] {
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

export interface NoteMetadata {
  createdAt: number;
  modifiedAt: number;
  pinned: boolean;
  deleted: boolean;
}

export function parseNotesCsv(csv: string): Map<string, NoteMetadata> {
  const map = new Map<string, NoteMetadata>();
  const lines = csv.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCsvLine(line);
    if (fields.length < 5) continue;
    const [title, createdStr, modifiedStr, pinnedStr, deletedStr] = fields;
    map.set(title.trim(), {
      createdAt:  parseCsvDate(createdStr),
      modifiedAt: parseCsvDate(modifiedStr),
      pinned:     pinnedStr.trim().toLowerCase() === 'yes',
      deleted:    deletedStr.trim().toLowerCase() === 'yes',
    });
  }
  return map;
}

export interface ParticipantRecord {
  filePath: string;
  sharedAt: number;
  displayName: string;
  emailMasked: string;
  permission: string;
  acceptance: string;
  role: 'sharer' | 'owner';
}

export function parseParticipantBlock(
  block: string,
  role: 'sharer' | 'owner',
): Omit<ParticipantRecord, 'filePath' | 'sharedAt'>[] {
  const results: Omit<ParticipantRecord, 'filePath' | 'sharedAt'>[] = [];
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
      permission:  fields['permission'] ?? '',
      acceptance:  fields['acceptance_status'] ?? fields['acceptance'] ?? '',
      role,
    });
  }
  return results;
}

export function parseSharedNotesCsv(csv: string, role: 'sharer' | 'owner'): ParticipantRecord[] {
  const records: ParticipantRecord[] = [];
  const lines = csv.split('\n');
  const header = parseCsvLine(lines[0] ?? '').map(h => h.trim().toLowerCase());
  const fileIdx         = header.findIndex(h => h === 'file name');
  const sharedOnIdx     = header.findIndex(h => h === 'shared on');
  const participantsIdx = header.findIndex(h => h.includes('participants'));
  const ownerIdx        = header.findIndex(h => h.includes('owner'));

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCsvLine(line);
    const filePath   = fields[fileIdx]?.trim() ?? '';
    const sharedAtRaw = fields[sharedOnIdx]?.trim() ?? '';
    const sharedAt   = sharedAtRaw ? parseCsvDate(sharedAtRaw) : 0;

    if (role === 'owner' && ownerIdx !== -1) {
      const ownerBlock = fields[ownerIdx]?.trim() ?? '';
      const parsed = parseParticipantBlock(ownerBlock, 'owner');
      for (const p of parsed) records.push({ filePath, sharedAt, ...p });
    }
    if (participantsIdx !== -1) {
      const participantsBlock = fields[participantsIdx]?.trim() ?? '';
      const parsed = parseParticipantBlock(participantsBlock, role);
      for (const p of parsed) records.push({ filePath, sharedAt, ...p });
    }
  }
  return records;
}
