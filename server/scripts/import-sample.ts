/**
 * Imports the three test-suite notes into the local dev DB.
 * Usage: cd server && ../node_modules/.bin/tsx --env-file=../.env scripts/import-sample.ts
 */

import { join } from 'path';
import { writeFileSync, rmSync, readFileSync } from 'fs';

process.env.DATA_DIR   = process.env.DATA_DIR   ?? join(process.cwd(), 'data');
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';

const SEED_EMAIL = process.env.SEED_EMAIL ?? 'admin@example.com';

async function main() {
  const { db }        = await import('../src/db/index.js');
  const { runImport } = await import('../src/routes/import.js');
  const JSZip         = (await import('jszip')).default;

  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(SEED_EMAIL) as any;
  if (!user) {
    console.error(`User ${SEED_EMAIL} not found. Run: npm run seed`);
    process.exit(1);
  }
  console.log(`Importing for: ${user.email} (${user.id})`);

  // ── The same three notes used by the test suite ───────────────────────────
  const UNCHECKED = '\t\u25E6\t';
  const CHECKED   = '\t\u2713\t';
  const OBJ       = '\uFFFC';
  const PHOTO     = join(process.cwd(), '..', 'metadata', 'test-data', 'photo-1774306612483-e280d8e7f913.jpeg');

  const flockDynamics = [
    'Flock Dynamics',
    '',
    'The geese arrived well before sunrise.',
    '',
    '* Barnacle goose',
    '* Pink-footed goose',
    '* Brent goose',
    '',
    'Conditions logged at the estuary:',
    '',
    '- Wind from the northwest',
    '- Visibility excellent',
    '- Temperature dropping at dusk',
  ].join('\n');

  const theCrossing = [
    'The Crossing',
    `${UNCHECKED}Leave before the tide turns`,
    `${UNCHECKED}Check the weather window`,
    `${CHECKED}Pack the dry bag`,
    `${CHECKED}Tell someone the route`,
  ].join('\n');

  const amberMorning = [
    'Amber Morning',
    '',
    'The light came in low through the valley.',
    '',
    OBJ,
    '',
    'Not a sound until the birds started up.',
  ].join('\n');

  const notesCsv = [
    'Title, Created On, Modified On, Pinned, Deleted, Drawing/Handwriting, ContentHash at Import',
    'Flock Dynamics,04-12-2026 08:00:00,04-12-2026 08:00:00,No,No,No,',
    'The Crossing,04-12-2026 09:00:00,04-12-2026 09:30:00,No,No,No,',
    'Amber Morning,04-12-2026 07:00:00,04-12-2026 07:15:00,Yes,No,No,',
  ].join('\n');

  const zip = new JSZip();
  zip.file('iCloud Notes/Notes Details.csv', notesCsv);
  zip.file('iCloud Notes/Notes/Flock Dynamics/Flock Dynamics.txt', flockDynamics);
  zip.file('iCloud Notes/Notes/The Crossing/The Crossing.txt', theCrossing);
  zip.file('iCloud Notes/Notes/Amber Morning/Amber Morning.txt', amberMorning);
  zip.file('iCloud Notes/Notes/Amber Morning/Attachment.jpeg', readFileSync(PHOTO));

  const buf     = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const zipPath = join(process.env.DATA_DIR!, 'tmp', `sample-${Date.now()}.zip`);
  writeFileSync(zipPath, buf);

  console.log('Running import...');
  await runImport(zipPath, user.id);
  rmSync(zipPath);

  const notes = db.prepare('SELECT id, title FROM notes WHERE user_id = ? ORDER BY created_at').all(user.id) as any[];
  console.log('\nImported notes:');
  notes.forEach(n => console.log(`  ${n.id}  ${n.title}`));
}

main().catch(err => { console.error(err); process.exit(1); });
