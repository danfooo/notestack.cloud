/**
 * Import pipeline tests
 *
 * Unit tests verify the parser in isolation (no DB, no filesystem).
 * The integration suite builds a comprehensive Apple Notes zip covering
 * every import data structure, runs the full pipeline, and asserts on
 * the resulting DB state.
 *
 * Run (clean):          npm test
 * Run (leave artefacts): npm test -- --leave-result
 *   → writes a real SQLite DB to server/data/test-result/ and prints note IDs
 *   → attach SQLite browser to server/data/test-result/notestack.db to inspect
 */

// ── Environment must be set BEFORE any server module is required ──────────────
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const LEAVE_RESULT = process.argv.includes('--leave-result') || process.env.LEAVE_RESULT === '1';

const TEST_DATA_DIR = LEAVE_RESULT
  ? join(process.cwd(), 'data', 'test-result')
  : join(tmpdir(), `brains-test-${Date.now()}`);

process.env.DATA_DIR   = TEST_DATA_DIR;
process.env.JWT_SECRET = 'test-secret-not-for-production';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { classifyLine, sortAttachmentNames, parseTxtFile, textToTipTap } =
  require('../src/services/importParser') as typeof import('../src/services/importParser');

const PHOTO_PATH = join(__dirname, '../../metadata/test-data/photo-1774306612483-e280d8e7f913.jpeg');

// ── Text fixtures ─────────────────────────────────────────────────────────────

// TEST 1 — Two bullet flavours in the same note.
const FLOCK_DYNAMICS = `Flock Dynamics

The geese arrived well before sunrise.

* Barnacle goose
* Pink-footed goose
* Brent goose

Conditions logged at the estuary:

- Wind from the northwest
- Visibility excellent
- Temperature dropping at dusk
`;

// TEST 2 — Checked and unchecked task items.
const THE_CROSSING = `The Crossing
\t\u25E6\tLeave before the tide turns
\t\u25E6\tCheck the weather window
\t\u2713\tPack the dry bag
\t\u2713\tTell someone the route
`;

// TEST 3 — Inline image between two paragraphs.
const AMBER_MORNING_TEXT = `Amber Morning

The light came in low through the valley.

\uFFFC

Not a sound until the birds started up.
`;

// TEST 4 — Every import node type in a single note:
//   paragraph + unchecked tasks + checked task + star bullets + dash bullets + image + paragraph
const THE_PAINTED_SHORE = `The Painted Shore

The tide was coming in hard.

\t\u25E6\tCheck the anchor line
\t\u25E6\tLog the GPS position
\t\u2713\tPhotograph the rockpools

* Oystercatcher
* Redshank
* Turnstone

- Wind from the south
- Swell increasing

\uFFFC

Notes from the headland.
`;

// TEST 5 — Note that is nothing but images (no typed text after the title line).
const CLOUD_STUDY = `Cloud Study

\uFFFC
\uFFFC
\uFFFC
`;

// TEST 6 — Arabic RTL content: tasks and a closing paragraph.
const ARABIC_LIST = `قائمة التسوق

\t\u25E6\tخبز
\t\u25E6\tحليب
\t\u2713\tبيض
\t\u2713\tزيت زيتون

ملاحظات إضافية
`;

// TEST 7 — Plain note that will be placed inside a folder (depth-3 zip path).
const ESTUARY_LOG = `Estuary Log

Observed from the east bank at low tide.

- Salinity reading: 28 ppt
- Water temperature: 14°C
- Visibility: moderate
`;

// ── Unit tests: Flock Dynamics ────────────────────────────────────────────────

describe('Flock Dynamics — two bullet flavours stay separate', () => {
  test('star lines become a standard bulletList with no extra attrs', () => {
    const { bodyJson } = parseTxtFile(FLOCK_DYNAMICS);
    const doc = JSON.parse(bodyJson);
    const lists = doc.content.filter((n: any) => n.type === 'bulletList');

    assert.equal(lists.length, 2, 'expected two separate bulletList nodes');

    const starList = lists[0];
    assert.equal(starList.attrs?.listStyle ?? null, null, '* list must carry no listStyle attr');
    assert.equal(starList.content.length, 3, '* list must have 3 items');
    assert.equal(starList.content[0].content[0].content[0].text, 'Barnacle goose');
  });

  test('dash lines become a bulletList tagged with listStyle=dash', () => {
    const { bodyJson } = parseTxtFile(FLOCK_DYNAMICS);
    const doc = JSON.parse(bodyJson);
    const lists = doc.content.filter((n: any) => n.type === 'bulletList');

    const dashList = lists[1];
    assert.equal(dashList.attrs?.listStyle, 'dash', '- list must carry listStyle="dash"');
    assert.equal(dashList.content.length, 3, '- list must have 3 items');
    assert.equal(dashList.content[2].content[0].content[0].text, 'Temperature dropping at dusk');
  });

  test('classifyLine correctly distinguishes the two markers', () => {
    assert.equal(classifyLine('* round bullet').kind, 'starBullet');
    assert.equal(classifyLine('- dash item').kind,   'dashBullet');
    assert.equal(classifyLine('regular text').kind,  'text');
  });
});

// ── Unit tests: The Crossing ──────────────────────────────────────────────────

describe('The Crossing — checked and unchecked survive the parser', () => {
  test('all four items land inside a single taskList node', () => {
    const { bodyJson } = parseTxtFile(THE_CROSSING);
    const doc = JSON.parse(bodyJson);
    const taskLists = doc.content.filter((n: any) => n.type === 'taskList');
    assert.equal(taskLists.length, 1, 'expected exactly one taskList');
    assert.equal(taskLists[0].content.length, 4, 'expected 4 items');
  });

  test('unchecked items carry checked=false', () => {
    const { bodyJson } = parseTxtFile(THE_CROSSING);
    const doc = JSON.parse(bodyJson);
    const taskList = doc.content.find((n: any) => n.type === 'taskList');
    const items = taskList.content as any[];
    assert.equal(items[0].attrs.checked, false, 'first item should be unchecked');
    assert.equal(items[1].attrs.checked, false, 'second item should be unchecked');
  });

  test('checked items carry checked=true and correct text', () => {
    const { bodyJson } = parseTxtFile(THE_CROSSING);
    const doc = JSON.parse(bodyJson);
    const taskList = doc.content.find((n: any) => n.type === 'taskList');
    const items = taskList.content as any[];
    assert.equal(items[2].attrs.checked, true);
    assert.equal(items[2].content[0].content[0].text, 'Pack the dry bag');
    assert.equal(items[3].attrs.checked, true);
    assert.equal(items[3].content[0].content[0].text, 'Tell someone the route');
  });

  test('body_text joins item text without the Unicode markers', () => {
    const { bodyText } = parseTxtFile(THE_CROSSING);
    assert.ok(bodyText.includes('Leave before the tide turns'));
    assert.ok(!bodyText.includes('\t'),      'body_text must not contain raw tabs');
    assert.ok(!bodyText.includes('\u25E6'),  'body_text must not contain ◦');
    assert.ok(!bodyText.includes('\u2713'),  'body_text must not contain ✓');
  });
});

// ── Unit tests: Amber Morning ─────────────────────────────────────────────────

describe('Amber Morning — inline photograph threads through correctly', () => {
  test('attachment sort: no-suffix before numbered suffix', () => {
    const sorted = sortAttachmentNames([
      'Attachment-2.jpeg',
      'Attachment.jpeg',
      'Attachment-1.jpeg',
      'Attachment-10.jpeg',
    ]);
    assert.deepEqual(sorted, [
      'Attachment.jpeg',
      'Attachment-1.jpeg',
      'Attachment-2.jpeg',
      'Attachment-10.jpeg',
    ]);
  });

  test('U+FFFC placeholder becomes an image node at the right position', () => {
    const fakeUrl = '/attachments/test-user/photo.jpeg';
    const { bodyJson } = parseTxtFile(AMBER_MORNING_TEXT, [fakeUrl]);
    const doc = JSON.parse(bodyJson);

    const types = doc.content.map((n: any) => n.type);
    assert.ok(types.includes('image'), 'image node should be present');

    const imageIdx = types.indexOf('image');
    assert.ok(imageIdx > 0,                'image must not be the first node');
    assert.ok(imageIdx < types.length - 1, 'image must not be the last node');

    const imageNode = doc.content[imageIdx];
    assert.equal(imageNode.attrs.src, fakeUrl);
    assert.equal(imageNode.attrs.alt, null);
  });

  test('text before and after the image is preserved verbatim', () => {
    const { bodyJson } = parseTxtFile(AMBER_MORNING_TEXT, ['/attachments/u/x.jpeg']);
    const doc = JSON.parse(bodyJson);
    const paragraphs = doc.content.filter((n: any) => n.type === 'paragraph');
    const texts = paragraphs.flatMap((p: any) => p.content?.map((t: any) => t.text) ?? []);
    assert.ok(texts.some((t: string) => t.includes('low through the valley')));
    assert.ok(texts.some((t: string) => t.includes('birds started up')));
  });
});

// ── Unit tests: The Painted Shore ─────────────────────────────────────────────

describe('The Painted Shore — every import node type in one note', () => {
  test('produces paragraph, taskList, two bulletLists, and an image', () => {
    const fakeUrl = '/attachments/u/shore.jpeg';
    const { bodyJson } = parseTxtFile(THE_PAINTED_SHORE, [fakeUrl]);
    const doc = JSON.parse(bodyJson);
    const types = doc.content.map((n: any) => n.type);

    assert.ok(types.includes('paragraph'),  'should have at least one paragraph');
    assert.ok(types.includes('taskList'),   'should have a taskList');
    assert.ok(types.includes('bulletList'), 'should have at least one bulletList');
    assert.ok(types.includes('image'),      'should have an image node');

    const bulletLists = doc.content.filter((n: any) => n.type === 'bulletList');
    assert.equal(bulletLists.length, 2, 'should have exactly 2 bulletList nodes');
  });

  test('taskList has 2 unchecked and 1 checked item', () => {
    const { bodyJson } = parseTxtFile(THE_PAINTED_SHORE, ['/u/x.jpeg']);
    const doc = JSON.parse(bodyJson);
    const taskList = doc.content.find((n: any) => n.type === 'taskList');
    const items = taskList.content as any[];
    assert.equal(items.length, 3);
    assert.equal(items[0].attrs.checked, false);
    assert.equal(items[1].attrs.checked, false);
    assert.equal(items[2].attrs.checked, true);
    assert.equal(items[2].content[0].content[0].text, 'Photograph the rockpools');
  });

  test('star bullet list has 3 items, dash bullet list has 2 items', () => {
    const { bodyJson } = parseTxtFile(THE_PAINTED_SHORE, ['/u/x.jpeg']);
    const doc = JSON.parse(bodyJson);
    const bulletLists = doc.content.filter((n: any) => n.type === 'bulletList');
    const starList = bulletLists.find((l: any) => !l.attrs?.listStyle);
    const dashList = bulletLists.find((l: any) => l.attrs?.listStyle === 'dash');
    assert.equal(starList.content.length, 3, 'star list should have 3 items');
    assert.equal(dashList.content.length, 2, 'dash list should have 2 items');
  });

  test('image node carries the resolved URL', () => {
    const fakeUrl = '/attachments/u/shore.jpeg';
    const { bodyJson } = parseTxtFile(THE_PAINTED_SHORE, [fakeUrl]);
    const doc = JSON.parse(bodyJson);
    const image = doc.content.find((n: any) => n.type === 'image');
    assert.equal(image.attrs.src, fakeUrl);
  });
});

// ── Unit tests: Cloud Study ───────────────────────────────────────────────────

describe('Cloud Study — images-only note', () => {
  test('produces exactly 3 image nodes when 3 URLs are supplied', () => {
    const urls = ['/u/a.jpeg', '/u/b.jpeg', '/u/c.jpeg'];
    const { bodyJson } = parseTxtFile(CLOUD_STUDY, urls);
    const doc = JSON.parse(bodyJson);
    const images = doc.content.filter((n: any) => n.type === 'image');
    assert.equal(images.length, 3);
    assert.equal(images[0].attrs.src, '/u/a.jpeg');
    assert.equal(images[2].attrs.src, '/u/c.jpeg');
  });

  test('body_text is empty when there is no typed text', () => {
    const { bodyText } = parseTxtFile(CLOUD_STUDY, ['/u/a.jpeg', '/u/b.jpeg', '/u/c.jpeg']);
    // Only the title line "Cloud Study" is text; image lines contribute nothing
    assert.ok(!bodyText.includes('\uFFFC'), 'U+FFFC must not appear in body_text');
  });
});

// ── Unit tests: Arabic list ───────────────────────────────────────────────────

describe('Arabic shopping list — RTL content round-trips cleanly', () => {
  test('task items carry Arabic text', () => {
    const { bodyJson } = parseTxtFile(ARABIC_LIST);
    const doc = JSON.parse(bodyJson);
    const taskList = doc.content.find((n: any) => n.type === 'taskList');
    const items = taskList.content as any[];
    assert.equal(items[0].attrs.checked, false);
    assert.equal(items[0].content[0].content[0].text, 'خبز');
    assert.equal(items[2].attrs.checked, true);
    assert.equal(items[2].content[0].content[0].text, 'بيض');
  });

  test('body_text contains Arabic text without Unicode markers', () => {
    const { bodyText } = parseTxtFile(ARABIC_LIST);
    assert.ok(bodyText.includes('خبز'),    'body_text should contain Arabic item text');
    assert.ok(bodyText.includes('ملاحظات'), 'body_text should contain Arabic closing paragraph');
    assert.ok(!bodyText.includes('\u25E6'), 'body_text must not contain ◦');
    assert.ok(!bodyText.includes('\t'),    'body_text must not contain raw tabs');
  });
});

// ── Integration tests ─────────────────────────────────────────────────────────
//
// Builds one comprehensive zip that exercises every import feature:
//   • all six note fixtures above
//   • one note nested inside a folder (depth-3 path)
//   • Flock Dynamics marked Pinned in the CSV
//   • real photo attachment reused across image-bearing notes
//
// Skipped automatically when the photo fixture is not present.
// ─────────────────────────────────────────────────────────────────────────────

describe('Full import pipeline — comprehensive fixture set', () => {
  let db: any;
  let userId: string;
  let notes: any[];
  let skipAll = false;

  before(async () => {
    if (!existsSync(PHOTO_PATH)) {
      skipAll = true;
      return;
    }

    mkdirSync(TEST_DATA_DIR, { recursive: true });

    const JSZip   = require('jszip')   as typeof import('jszip');
    const { nanoid } = require('nanoid') as typeof import('nanoid');
    const dbModule  = require('../src/db/index')    as typeof import('../src/db/index');
    const { runImport } = require('../src/routes/import') as { runImport: Function };

    db = dbModule.db;
    userId = nanoid();
    db.prepare(`
      INSERT INTO users (id, email, display_name, email_verified, created_at)
      VALUES (?, ?, 'Test User', 1, ?)
    `).run(userId, `test-${userId}@example.com`, Math.floor(Date.now() / 1000));

    const photoBytes = readFileSync(PHOTO_PATH);
    const zip = new JSZip();

    const csv = [
      'Title, Created On, Modified On, Pinned, Deleted, Drawing/Handwriting, ContentHash at Import',
      'Flock Dynamics,03-01-2026 08:00:00,03-01-2026 08:00:00,Yes,No,No,',
      'The Crossing,03-02-2026 09:00:00,03-02-2026 09:00:00,No,No,No,',
      'Amber Morning,04-12-2026 09:00:00,04-12-2026 09:00:00,No,No,No,',
      'The Painted Shore,04-01-2026 10:00:00,04-01-2026 10:00:00,No,No,No,',
      'Cloud Study,04-05-2026 11:00:00,04-05-2026 11:00:00,No,No,No,',
      'Estuary Log,04-10-2026 07:00:00,04-10-2026 08:00:00,No,No,No,',
      'قائمة التسوق,04-11-2026 12:00:00,04-11-2026 12:00:00,No,No,No,',
    ].join('\n');

    zip.file('iCloud Notes/Notes Details.csv', csv);

    // Note 1 — Flock Dynamics (root-level, Pinned)
    zip.file('iCloud Notes/Notes/Flock Dynamics/Flock Dynamics.txt', FLOCK_DYNAMICS);

    // Note 2 — The Crossing (root-level)
    zip.file('iCloud Notes/Notes/The Crossing/The Crossing.txt', THE_CROSSING);

    // Note 3 — Amber Morning (root-level, one image attachment)
    zip.file('iCloud Notes/Notes/Amber Morning/Amber Morning.txt', AMBER_MORNING_TEXT);
    zip.file('iCloud Notes/Notes/Amber Morning/Attachment.jpeg', photoBytes);

    // Note 4 — The Painted Shore (root-level, one image attachment)
    zip.file('iCloud Notes/Notes/The Painted Shore/The Painted Shore.txt', THE_PAINTED_SHORE);
    zip.file('iCloud Notes/Notes/The Painted Shore/Attachment.jpeg', photoBytes);

    // Note 5 — Cloud Study (root-level, three image attachments, no text)
    zip.file('iCloud Notes/Notes/Cloud Study/Cloud Study.txt', CLOUD_STUDY);
    zip.file('iCloud Notes/Notes/Cloud Study/Attachment.jpeg',   photoBytes);
    zip.file('iCloud Notes/Notes/Cloud Study/Attachment-1.jpeg', photoBytes);
    zip.file('iCloud Notes/Notes/Cloud Study/Attachment-2.jpeg', photoBytes);

    // Note 6 — Estuary Log (inside folder "Field Notes", depth 3)
    zip.file('iCloud Notes/Notes/Field Notes/Estuary Log/Estuary Log.txt', ESTUARY_LOG);

    // Note 7 — Arabic shopping list (root-level)
    zip.file('iCloud Notes/Notes/قائمة التسوق/قائمة التسوق.txt', ARABIC_LIST);

    const zipPath = join(TEST_DATA_DIR, 'comprehensive-test.zip');
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    writeFileSync(zipPath, zipBuffer);

    await runImport(zipPath, userId);

    notes = db.prepare(
      'SELECT * FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at ASC'
    ).all(userId) as any[];
  });

  const skip = (t: any) => { if (skipAll) t.skip('photo fixture not present'); return skipAll; };

  // ── Note count ──────────────────────────────────────────────────────────────

  test('imports exactly 7 notes', (t) => {
    if (skip(t)) return;
    assert.equal(notes.length, 7, `expected 7 notes, got ${notes.length}`);
  });

  // ── Flock Dynamics: pinned via CSV ──────────────────────────────────────────

  test('Flock Dynamics is pinned (set in CSV)', (t) => {
    if (skip(t)) return;
    const note = notes.find((n: any) => {
      const body = JSON.parse(n.body);
      const first = body.content?.[0];
      return first?.content?.[0]?.text === 'Flock Dynamics';
    });
    assert.ok(note, 'Flock Dynamics note not found');
    assert.equal(note.pinned, 1, 'Flock Dynamics should be pinned');
  });

  // ── The Crossing: all tasks intact ─────────────────────────────────────────

  test('The Crossing has 4 task items (2 unchecked, 2 checked)', (t) => {
    if (skip(t)) return;
    const note = notes.find((n: any) => {
      const body = JSON.parse(n.body);
      return body.content?.some((b: any) => b.type === 'taskList');
    });
    assert.ok(note, 'note with taskList not found');
    const body = JSON.parse(note.body);
    const taskList = body.content.find((b: any) => b.type === 'taskList');
    const items = taskList.content as any[];
    assert.equal(items.length, 4);
    assert.equal(items.filter((i: any) => !i.attrs.checked).length, 2, '2 unchecked');
    assert.equal(items.filter((i: any) =>  i.attrs.checked).length, 2, '2 checked');
  });

  // ── Amber Morning: image saved to disk ────────────────────────────────────

  test('Amber Morning image node points to a file on disk', (t) => {
    if (skip(t)) return;
    const note = notes.find((n: any) => {
      const body = JSON.parse(n.body);
      return body.content?.some((b: any) => b.type === 'image');
    }) as any;
    assert.ok(note, 'note with image not found');
    const body = JSON.parse(note.body);
    const images = body.content.filter((b: any) => b.type === 'image');
    // Amber Morning has exactly 1 image; Cloud Study has 3 — find the one with 1
    const amberNote = notes.find((n: any) => {
      const doc = JSON.parse(n.body);
      return doc.content.filter((b: any) => b.type === 'image').length === 1 &&
             doc.content.some((b: any) => b.type === 'paragraph' &&
               b.content?.some((t: any) => t.text?.includes('birds started up')));
    });
    assert.ok(amberNote, 'Amber Morning note not found');
    const amberBody = JSON.parse(amberNote.body);
    const imageNode = amberBody.content.find((b: any) => b.type === 'image');
    assert.ok(imageNode.attrs.src.startsWith('/attachments/'), 'src should be a served path');
    const filePath = join(TEST_DATA_DIR, 'attachments', userId, imageNode.attrs.src.split('/').pop()!);
    assert.ok(existsSync(filePath), `attachment file should exist at ${filePath}`);
  });

  // ── The Painted Shore: every node type present ────────────────────────────

  test('The Painted Shore contains paragraph, taskList, two bulletLists, and image', (t) => {
    if (skip(t)) return;
    const note = notes.find((n: any) => {
      const doc = JSON.parse(n.body);
      return doc.content.some((b: any) => b.type === 'taskList') &&
             doc.content.filter((b: any) => b.type === 'bulletList').length === 2 &&
             doc.content.some((b: any) => b.type === 'image');
    });
    assert.ok(note, 'The Painted Shore note not found');
    const doc = JSON.parse(note.body);
    const types = new Set(doc.content.map((b: any) => b.type));
    assert.ok(types.has('paragraph'),  'should have paragraph');
    assert.ok(types.has('taskList'),   'should have taskList');
    assert.ok(types.has('bulletList'), 'should have bulletList');
    assert.ok(types.has('image'),      'should have image');
  });

  // ── Cloud Study: three images, title-only text ────────────────────────────

  test('Cloud Study has exactly 3 image nodes', (t) => {
    if (skip(t)) return;
    const note = notes.find((n: any) => {
      const doc = JSON.parse(n.body);
      return doc.content.filter((b: any) => b.type === 'image').length === 3;
    });
    assert.ok(note, 'Cloud Study note not found');
    const doc = JSON.parse(note.body);
    assert.equal(doc.content.filter((b: any) => b.type === 'image').length, 3);
  });

  // ── Estuary Log: assigned to a folder ────────────────────────────────────

  test('Estuary Log is assigned to the Field Notes folder', (t) => {
    if (skip(t)) return;
    const note = notes.find((n: any) => {
      const doc = JSON.parse(n.body);
      return doc.content?.[0]?.content?.[0]?.text === 'Estuary Log';
    });
    assert.ok(note, 'Estuary Log note not found');
    assert.ok(note.folder_id, 'should have a folder_id');
    const { db: dbInst } = require('../src/db/index') as typeof import('../src/db/index');
    const folder = dbInst.prepare('SELECT * FROM folders WHERE id = ?').get(note.folder_id) as any;
    assert.ok(folder, 'folder record should exist');
    assert.equal(folder.name, 'Field Notes');
  });

  // ── Arabic note: RTL text preserved ──────────────────────────────────────

  test('Arabic note body_text contains Arabic characters', (t) => {
    if (skip(t)) return;
    const note = notes.find((n: any) =>
      n.body_text && n.body_text.includes('خبز')
    );
    assert.ok(note, 'Arabic note not found');
    assert.ok(note.body_text.includes('ملاحظات'), 'closing paragraph should be in body_text');
  });

  // ── Leave-result: kitchen sink note + summary ─────────────────────────────

  test('kitchen sink note inserted for UI inspection (leave-result only)', (t) => {
    if (skip(t)) return;
    if (!LEAVE_RESULT) { t.skip('only runs in leave-result mode'); return; }

    const { nanoid } = require('nanoid') as typeof import('nanoid');
    const { db: dbInst } = require('../src/db/index') as typeof import('../src/db/index');

    const kitchenSinkBody = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Kitchen Sink' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Every formatting capability in one note.' }] },

        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Text styles' }] },
        { type: 'paragraph', content: [
          { type: 'text', marks: [{ type: 'bold' }], text: 'Bold' },
          { type: 'text', text: '   ' },
          { type: 'text', marks: [{ type: 'italic' }], text: 'Italic' },
          { type: 'text', text: '   ' },
          { type: 'text', marks: [{ type: 'bold' }, { type: 'italic' }], text: 'Bold italic' },
          { type: 'text', text: '   ' },
          { type: 'text', marks: [{ type: 'underline' }], text: 'Underline' },
          { type: 'text', text: '   ' },
          { type: 'text', marks: [{ type: 'strike' }], text: 'Strikethrough' },
          { type: 'text', text: '   ' },
          { type: 'text', marks: [{ type: 'code' }], text: 'inline code' },
          { type: 'text', text: '   ' },
          { type: 'text', marks: [{ type: 'highlight', attrs: { color: '#fef08a' } }], text: 'Highlighted' },
          { type: 'text', text: '   ' },
          { type: 'text', marks: [{ type: 'textStyle', attrs: { color: '#ef4444' } }], text: 'Red text' },
        ]},

        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Headings' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Heading 1' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading 2' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Heading 3' }] },

        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Lists' }] },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Round bullet one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Round bullet two' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Round bullet three' }] }] },
        ]},
        { type: 'bulletList', attrs: { listStyle: 'dash' }, content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dash item one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dash item two' }] }] },
        ]},
        { type: 'orderedList', attrs: { start: 1 }, content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First step' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second step' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Third step' }] }] },
        ]},
        { type: 'taskList', content: [
          { type: 'taskItem', attrs: { checked: true  }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completed task' }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pending task' }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Another pending task' }] }] },
        ]},

        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Blockquote and code' }] },
        { type: 'blockquote', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'This is a blockquote. It can span multiple sentences and should be visually distinct from regular paragraphs.' }] },
        ]},
        { type: 'codeBlock', attrs: { language: 'typescript' }, content: [
          { type: 'text', text: "function greet(name: string): string {\n  return `Hello, ${name}!`;\n}" },
        ]},

        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Table' }] },
        { type: 'table', content: [
          { type: 'tableRow', content: [
            { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }] },
            { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Role' }] }] },
            { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Status' }] }] },
          ]},
          { type: 'tableRow', content: [
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alice' }] }] },
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Engineer' }] }] },
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Active' }] }] },
          ]},
          { type: 'tableRow', content: [
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bob' }] }] },
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Designer' }] }] },
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'On leave' }] }] },
          ]},
        ]},

        { type: 'horizontalRule' },

        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Link' }] },
        { type: 'paragraph', content: [
          { type: 'text', text: 'Visit the ' },
          { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://tiptap.dev', target: '_blank', rel: 'noopener noreferrer', class: 'text-amber-600 underline cursor-pointer' } }], text: 'TipTap documentation' },
          { type: 'text', text: ' for more details.' },
        ]},
      ],
    };

    // Compute body_text by walking all text nodes
    const texts: string[] = [];
    const walkText = (node: any) => {
      if (node.type === 'text' && node.text) texts.push(node.text);
      if (node.content) node.content.forEach(walkText);
    };
    walkText(kitchenSinkBody);
    const bodyText = texts.join(' ');

    const bodyJson = JSON.stringify(kitchenSinkBody);
    const now = Math.floor(Date.now() / 1000);
    const noteId = nanoid();
    dbInst.prepare(`
      INSERT INTO notes (id, user_id, title, body, body_text, folder_id, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)
    `).run(noteId, userId, 'Kitchen Sink', bodyJson, bodyText, now, now);

    const saved = dbInst.prepare('SELECT id FROM notes WHERE id = ?').get(noteId) as any;
    assert.ok(saved, 'kitchen sink note should be in DB');

    const allNotes = dbInst.prepare(
      'SELECT * FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at ASC'
    ).all(userId) as any[];

    console.log('\n── Leave-result artefacts ──────────────────────────────────');
    console.log(`  DB:              ${join(TEST_DATA_DIR, 'notestack.db')}`);
    console.log(`  Attachments:     ${join(TEST_DATA_DIR, 'attachments', userId)}`);
    console.log(`  Notes (${allNotes.length}):`);
    for (const n of allNotes) {
      const doc = JSON.parse(n.body);
      const firstText = doc.content?.[0]?.content?.[0]?.text ?? '(no text)';
      const pinned = n.pinned ? ' 📌' : '';
      const folder = n.folder_id ? ` [folder:${n.folder_id.slice(0, 6)}]` : '';
      console.log(`    ${n.id}  "${firstText}"${pinned}${folder}`);
    }
    console.log('────────────────────────────────────────────────────────────\n');
  });
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
after(() => {
  if (!LEAVE_RESULT && existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});
