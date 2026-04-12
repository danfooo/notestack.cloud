import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db } from './db/index.js';
import { seedDefaultPrompts } from './routes/auth.js';

async function main() {
  const email = process.env.SEED_EMAIL;
  const password = process.env.SEED_PASSWORD;
  const name = process.env.SEED_NAME || 'Admin';

  if (!email || !password) {
    console.error('SEED_EMAIL and SEED_PASSWORD env vars required');
    process.exit(1);
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    console.log(`User ${email} already exists`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 10);
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO users (id, email, display_name, password_hash, email_verified, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(id, email.toLowerCase(), name, hash, now);

  seedDefaultPrompts(id);

  console.log(`Created user: ${email} (id: ${id})`);
  console.log('Default think prompts seeded.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
