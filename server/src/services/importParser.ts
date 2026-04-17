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

  let bodyStart = 0;
  while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;

  const bodyLines = lines.slice(bodyStart);
  const bodyJson = textToTipTap(bodyLines, attachmentUrls);
  const bodyText = bodyLines.map(l => classifyLine(l).text).filter(Boolean).join(' ');

  return { title: '', bodyJson, bodyText };
}

// ── Storizzi Markdown → TipTap ───────────────────────────────────────────────
//
// Converts the Markdown produced by storizzi/notes-exporter to TipTap JSON.
// The input is machine-generated from Apple's internal HTML, so it is clean
// and predictable. Handles: headings, bold, italic, links, images, bullet
// lists, task lists, tables, inline code, code blocks.

const MONTH_MAP: Record<string, number> = {
  january: 0,  february: 1,  march: 2,     april: 3,
  may: 4,       june: 5,      july: 6,      august: 7,
  september: 8, october: 9,   november: 10, december: 11,
  // German locale
  januar: 0,   februar: 1,   märz: 2,      mai: 4,
  juni: 5,     juli: 6,      oktober: 9,   dezember: 11,
};

// Parses AppleScript's `date as string` output, which is locale-dependent.
// Handles the two most common formats:
//   European: "Friday, 3. April 2026 at 21:00:17"
//   US:       "Friday, April 3, 2026 at 9:00:17 PM"
export function parseStorizziDate(s: string): number {
  if (!s) return Math.floor(Date.now() / 1000);
  // European: weekday, D. MonthName YYYY at HH:MM:SS
  let m = s.match(/\w+,\s+(\d+)\.\s+(\w+)\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2}):(\d{2})/i);
  if (m) {
    const month = MONTH_MAP[m[2].toLowerCase()];
    if (month !== undefined)
      return Math.floor(Date.UTC(+m[3], month, +m[1], +m[4], +m[5], +m[6]) / 1000);
  }
  // US: weekday, MonthName D, YYYY at H:MM:SS [AM|PM]
  m = s.match(/\w+,\s+(\w+)\s+(\d+),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2}):(\d{2})(?:\s+(AM|PM))?/i);
  if (m) {
    const month = MONTH_MAP[m[1].toLowerCase()];
    if (month !== undefined) {
      let hour = +m[4];
      if (m[7]?.toUpperCase() === 'PM' && hour !== 12) hour += 12;
      if (m[7]?.toUpperCase() === 'AM' && hour === 12) hour = 0;
      return Math.floor(Date.UTC(+m[3], month, +m[2], hour, +m[5], +m[6]) / 1000);
    }
  }
  return Math.floor(Date.now() / 1000);
}

// ── Inline Markdown parser ────────────────────────────────────────────────────

function makeInlineTextNode(text: string, marks: any[]): any {
  return marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text };
}

// Parse inline Markdown into TipTap inline content nodes.
// attachmentUrlMap maps storizzi-relative paths (./attachments/x.png) to served URLs.
function parseInline(raw: string, urlMap: Map<string, string>, marks: any[] = []): any[] {
  const nodes: any[] = [];
  let s = raw;

  while (s.length > 0) {
    // Image: ![alt](url)
    let m = s.match(/^!\[([^\]]*)\]\(([^)]*)\)/);
    if (m) {
      const src = urlMap.get(m[2]) ?? m[2];
      nodes.push({ type: 'image', attrs: { src, alt: m[1] || null, title: null } });
      s = s.slice(m[0].length);
      continue;
    }
    // Link: [text](url)
    m = s.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (m) {
      const linkMark = { type: 'link', attrs: { href: m[2], target: '_blank', rel: 'noopener noreferrer' } };
      nodes.push(...parseInline(m[1], urlMap, [...marks, linkMark]));
      s = s.slice(m[0].length);
      continue;
    }
    // Bold-italic: ***text***
    m = s.match(/^\*{3}(.+?)\*{3}/s);
    if (m) {
      nodes.push(...parseInline(m[1], urlMap, [...marks, { type: 'bold' }, { type: 'italic' }]));
      s = s.slice(m[0].length);
      continue;
    }
    // Bold: **text**
    m = s.match(/^\*{2}(.+?)\*{2}/s);
    if (m) {
      nodes.push(...parseInline(m[1], urlMap, [...marks, { type: 'bold' }]));
      s = s.slice(m[0].length);
      continue;
    }
    // Italic: *text* (opening * not followed by another *)
    m = s.match(/^\*(?!\*)(.+?)(?<!\*)\*(?!\*)/s);
    if (m) {
      nodes.push(...parseInline(m[1], urlMap, [...marks, { type: 'italic' }]));
      s = s.slice(m[0].length);
      continue;
    }
    // Inline code: `code`
    m = s.match(/^`([^`]+)`/);
    if (m) {
      nodes.push(makeInlineTextNode(m[1], [...marks, { type: 'code' }]));
      s = s.slice(m[0].length);
      continue;
    }
    // Escaped character: \X
    m = s.match(/^\\(.)/);
    if (m) {
      nodes.push(makeInlineTextNode(m[1], marks));
      s = s.slice(m[0].length);
      continue;
    }
    // HTML entity: &lt; &gt; &amp; &quot;
    m = s.match(/^&(lt|gt|amp|quot|#\d+);/);
    if (m) {
      const entities: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"' };
      const ch = entities[m[1]] ?? String.fromCharCode(parseInt(m[1].slice(1)));
      const prev = nodes[nodes.length - 1];
      if (prev?.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(marks)) {
        prev.text += ch;
      } else {
        nodes.push(makeInlineTextNode(ch, marks));
      }
      s = s.slice(m[0].length);
      continue;
    }
    // Plain text — consume until a special character
    m = s.match(/^[^*`\[!\\&\n]+/);
    if (m) {
      const prev = nodes[nodes.length - 1];
      if (prev?.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(marks)) {
        prev.text += m[0];
      } else {
        nodes.push(makeInlineTextNode(m[0], marks));
      }
      s = s.slice(m[0].length);
      continue;
    }
    // Newline inside inline → soft break (treat as space)
    if (s[0] === '\n') {
      const prev = nodes[nodes.length - 1];
      if (prev?.type === 'text' && !prev.marks?.length) prev.text += ' ';
      else nodes.push(makeInlineTextNode(' ', marks));
      s = s.slice(1);
      continue;
    }
    // Consume one unrecognised character
    const prev = nodes[nodes.length - 1];
    if (prev?.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(marks)) {
      prev.text += s[0];
    } else {
      nodes.push(makeInlineTextNode(s[0], marks));
    }
    s = s.slice(1);
  }

  return nodes.filter(n => !(n.type === 'text' && n.text === ''));
}

// ── Block Markdown parser ─────────────────────────────────────────────────────

function parseMdTable(tableLines: string[], urlMap: Map<string, string>): any | null {
  // Filter separator row (| --- | --- |)
  const dataLines = tableLines.filter(l => !/^\|[\s\-:|]+\|[\s\-:|]*$/.test(l));
  if (dataLines.length === 0) return null;

  const splitRow = (line: string) =>
    line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

  const [header, ...body] = dataLines;
  const headerCells = splitRow(header);

  const tableRow = (cells: string[], cellType: 'tableHeader' | 'tableCell') => ({
    type: 'tableRow',
    content: cells.map(cell => ({
      type: cellType,
      attrs: { colspan: 1, rowspan: 1, colwidth: null },
      content: [{ type: 'paragraph', content: parseInline(cell, urlMap) }],
    })),
  });

  return {
    type: 'table',
    content: [
      tableRow(headerCells, 'tableHeader'),
      ...body.map(line => tableRow(splitRow(line), 'tableCell')),
    ],
  };
}

export function parseMarkdownToTipTap(
  md: string,
  urlMap: Map<string, string> = new Map(),
): { bodyJson: string; bodyText: string } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const content: any[] = [];
  const textParts: string[] = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (!line.trim()) { i++; continue; }

    // Heading: # / ## / ###
    const hm = line.match(/^(#{1,3}) (.+)$/);
    if (hm) {
      const level = hm[1].length as 1 | 2 | 3;
      const inlines = parseInline(hm[2].trim(), urlMap);
      content.push({ type: 'heading', attrs: { level }, content: inlines });
      textParts.push(hm[2].trim());
      i++;
      continue;
    }

    // Fenced code block: ```
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || null;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      i++; // closing ```
      const text = codeLines.join('\n');
      content.push({ type: 'codeBlock', attrs: { language: lang }, content: [{ type: 'text', text }] });
      textParts.push(text);
      continue;
    }

    // Table: line starts with |
    if (line.startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) { tableLines.push(lines[i]); i++; }
      const tableNode = parseMdTable(tableLines, urlMap);
      if (tableNode) content.push(tableNode);
      // Extract text from table cells for search
      for (const tl of tableLines) {
        if (!/^\|[\s\-:|]+\|/.test(tl))
          textParts.push(...tl.replace(/^\||\|$/g, '').split('|').map(c => c.trim()).filter(Boolean));
      }
      continue;
    }

    // Task list item: - [ ] or - [x]
    if (/^- \[[ xX]\] /.test(line)) {
      const items: any[] = [];
      while (i < lines.length && /^- \[[ xX]\] /.test(lines[i])) {
        const checked = lines[i][3].toLowerCase() === 'x';
        const text = lines[i].slice(6);
        items.push({
          type: 'taskItem',
          attrs: { checked },
          content: [{ type: 'paragraph', content: parseInline(text, urlMap) }],
        });
        textParts.push(text);
        i++;
      }
      content.push({ type: 'taskList', content: items });
      continue;
    }

    // Bullet list: - or *
    if (/^[*-] /.test(line)) {
      const items: any[] = [];
      while (i < lines.length && /^[*-] /.test(lines[i])) {
        const text = lines[i].slice(2);
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInline(text, urlMap) }],
        });
        textParts.push(text);
        i++;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }

    // Paragraph: accumulate until blank / block-level element
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].match(/^#{1,3} /) &&
      !lines[i].startsWith('|') &&
      !lines[i].startsWith('```') &&
      !/^[*-] /.test(lines[i]) &&
      !/^- \[[ xX]\] /.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length > 0) {
      const paraText = paraLines.join('\n').trim();
      const inlines = parseInline(paraText, urlMap);
      // A paragraph that is solely one image → unwrap to standalone image
      if (inlines.length === 1 && inlines[0].type === 'image') {
        content.push(inlines[0]);
      } else if (inlines.length > 0) {
        content.push({ type: 'paragraph', content: inlines });
        textParts.push(paraLines.map(l => l.replace(/\*{1,3}|`|\[.*?\]|\(.*?\)/g, '').trim()).join(' '));
      }
    }
  }

  if (content.length === 0) content.push({ type: 'paragraph' });

  return {
    bodyJson: JSON.stringify({ type: 'doc', content }),
    bodyText: textParts.join(' ').replace(/\s+/g, ' ').trim(),
  };
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
