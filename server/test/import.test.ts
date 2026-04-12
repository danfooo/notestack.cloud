/**
 * Import pipeline tests
 *
 * Three synthetic Apple Notes exports, each quietly probing a different
 * behaviour of the parser without shouting about it in the test name.
 *
 * Run (clean):          npm test
 * Run (leave artefacts): npm test -- --leave-result
 *   → writes a real SQLite DB to server/data/test-result/ and prints note IDs
 *   → attach SQLite browser to server/data/test-result/brains.db to inspect
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

process.env.DATA_DIR    = TEST_DATA_DIR;
process.env.JWT_SECRET  = 'test-secret-not-for-production';

// Deferred require so modules pick up DATA_DIR above
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { classifyLine, sortAttachmentNames, parseTxtFile, textToTipTap } =
  require('../src/services/importParser') as typeof import('../src/services/importParser');

// ── Shared photo fixture (used by the third test) ─────────────────────────────
const PHOTO_PATH = join(__dirname, '../../metadata/test-data/photo-1774306612483-e280d8e7f913.jpeg');

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 — "Flock Dynamics"
//
// A field note about migrating geese. Uses both bullet markers in the same
// document to verify they produce two visually distinct list types in the
// output, and that a marker switch mid-note starts a fresh list node.
// ─────────────────────────────────────────────────────────────────────────────
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

describe('Flock Dynamics — two bullet flavours stay separate', () => {
  test('star lines become a standard bulletList with no extra attrs', () => {
    const { bodyJson } = parseTxtFile(FLOCK_DYNAMICS);
    const doc = JSON.parse(bodyJson);
    const lists = doc.content.filter((n: any) => n.type === 'bulletList');

    // There should be exactly two bullet lists
    assert.equal(lists.length, 2, 'expected two separate bulletList nodes');

    // The first (from * markers) has no listStyle attribute
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

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2 — "The Crossing"
//
// A river-crossing checklist — half the tasks were done before the rain came.
// Confirms that the checked / unchecked TAB-encoded characters survive
// round-trip through the parser, land in the right TipTap node type, and
// carry the correct boolean on each item.
// ─────────────────────────────────────────────────────────────────────────────
const THE_CROSSING = `The Crossing
\t\u25E6\tLeave before the tide turns
\t\u25E6\tCheck the weather window
\t\u2713\tPack the dry bag
\t\u2713\tTell someone the route
`;

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
    const items = doc.content[0].content as any[];
    assert.equal(items[0].attrs.checked, false, 'first item should be unchecked');
    assert.equal(items[1].attrs.checked, false, 'second item should be unchecked');
  });

  test('checked items carry checked=true and correct text', () => {
    const { bodyJson } = parseTxtFile(THE_CROSSING);
    const doc = JSON.parse(bodyJson);
    const items = doc.content[0].content as any[];
    assert.equal(items[2].attrs.checked, true);
    assert.equal(items[2].content[0].content[0].text, 'Pack the dry bag');
    assert.equal(items[3].attrs.checked, true);
    assert.equal(items[3].content[0].content[0].text, 'Tell someone the route');
  });

  test('body_text joins item text without the Unicode markers', () => {
    const { bodyText } = parseTxtFile(THE_CROSSING);
    assert.ok(bodyText.includes('Leave before the tide turns'));
    assert.ok(!bodyText.includes('\t'), 'body_text must not contain raw tabs');
    assert.ok(!bodyText.includes('\u25E6'), 'body_text must not contain ◦');
    assert.ok(!bodyText.includes('\u2713'), 'body_text must not contain ✓');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3 — "Amber Morning"
//
// A brief note about a morning walk that ends with a photograph. The ￼
// placeholder should resolve to a saved file URL and become a TipTap image
// node at exactly that position in the content stream, with text before and
// after it intact.
//
// In --leave-result mode this test also runs the full import pipeline against
// a real DB and prints the resulting note ID for manual inspection.
// ─────────────────────────────────────────────────────────────────────────────
const AMBER_MORNING_TEXT = `Amber Morning

The light came in low through the valley.

\uFFFC

Not a sound until the birds started up.
`;

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

    // Expected sequence: paragraph, image, paragraph
    const types = doc.content.map((n: any) => n.type);
    assert.ok(types.includes('image'), 'image node should be present');

    const imageIdx = types.indexOf('image');
    assert.ok(imageIdx > 0,              'image must not be the first node');
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

  // Integration leg — only meaningful when the photo fixture exists
  test('full import writes note + saves attachment file to disk', async (t) => {
    if (!existsSync(PHOTO_PATH)) {
      t.skip('photo fixture not found, skipping integration leg');
      return;
    }

    // Build a minimal Apple Notes zip in memory
    const JSZip = require('jszip') as typeof import('jszip');
    const zip = new JSZip();

    const photoBytes = readFileSync(PHOTO_PATH);

    zip.file('iCloud Notes/Notes Details.csv',
      'Title, Created On, Modified On, Pinned, Deleted, Drawing/Handwriting, ContentHash at Import\n' +
      'Amber Morning,04-12-2026 09:00:00,04-12-2026 09:00:00,No,No,No,\n');

    zip.file('iCloud Notes/Notes/Amber Morning/Amber Morning.txt', AMBER_MORNING_TEXT);
    zip.file('iCloud Notes/Notes/Amber Morning/Attachment.jpeg', photoBytes);

    // Write zip to disk
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    const zipPath = join(TEST_DATA_DIR, 'amber-morning-test.zip');
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    writeFileSync(zipPath, zipBuffer);

    // Bootstrap a test user in the test DB
    const { db }    = require('../src/db/index') as typeof import('../src/db/index');
    const { nanoid } = require('nanoid') as typeof import('nanoid');
    const userId = nanoid();
    db.prepare(`
      INSERT INTO users (id, email, display_name, email_verified, created_at)
      VALUES (?, ?, 'Test User', 1, ?)
    `).run(userId, `test-${userId}@example.com`, Math.floor(Date.now() / 1000));

    // Run the actual import (runImport creates the job entry internally)
    const { runImport } = require('../src/routes/import') as { runImport: Function };
    await runImport(zipPath, userId);

    // Verify DB state
    const note = db.prepare('SELECT * FROM notes WHERE user_id = ? AND title = ?')
      .get(userId, 'Amber Morning') as any;

    assert.ok(note, 'note should exist in DB');
    assert.equal(note.deleted_at, null, 'note should not be soft-deleted');

    const body = JSON.parse(note.body);
    const imageNode = body.content.find((n: any) => n.type === 'image');
    assert.ok(imageNode, 'TipTap body should contain an image node');
    assert.ok(imageNode.attrs.src.startsWith('/attachments/'), 'image src should be a served path');

    // Confirm the file actually landed on disk
    const savedPath = join(TEST_DATA_DIR, 'attachments', userId, imageNode.attrs.src.split('/').pop()!);
    assert.ok(existsSync(savedPath), `attachment file should exist at ${savedPath}`);

    if (LEAVE_RESULT) {
      console.log('\n── Leave-result artefacts ──────────────────────────────────');
      console.log(`  DB:          ${join(TEST_DATA_DIR, 'brains.db')}`);
      console.log(`  note id:     ${note.id}`);
      console.log(`  image src:   ${imageNode.attrs.src}`);
      console.log(`  attachment:  ${savedPath}`);
      console.log('────────────────────────────────────────────────────────────\n');
    }
  });
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
after(() => {
  if (!LEAVE_RESULT && existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});
