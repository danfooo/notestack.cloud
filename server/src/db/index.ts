import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, 'brains.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                              TEXT PRIMARY KEY,
    email                           TEXT UNIQUE NOT NULL,
    display_name                    TEXT NOT NULL,
    password_hash                   TEXT,
    google_id                       TEXT UNIQUE,
    avatar_url                      TEXT,
    email_verified                  INTEGER NOT NULL DEFAULT 0,
    email_verification_token        TEXT,
    email_verification_expires_at   INTEGER,
    password_reset_token            TEXT,
    password_reset_expires_at       INTEGER,
    created_at                      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS invite_links (
    id              TEXT PRIMARY KEY,
    token           TEXT UNIQUE NOT NULL,
    created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_email   TEXT,
    revoked         INTEGER NOT NULL DEFAULT 0,
    expires_at      INTEGER NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS folders (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT,
    body        TEXT,
    body_text   TEXT,
    folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
    pinned      INTEGER NOT NULL DEFAULT 0,
    archived    INTEGER NOT NULL DEFAULT 0,
    deleted_at  INTEGER,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS note_tags (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    PRIMARY KEY (note_id, tag)
  );

  CREATE TABLE IF NOT EXISTS note_revisions (
    id          TEXT PRIMARY KEY,
    note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    body_text   TEXT,
    saved_by    TEXT NOT NULL DEFAULT 'user',
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS thoughts (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    title           TEXT,
    body            TEXT,
    source_note_id  TEXT REFERENCES notes(id) ON DELETE SET NULL,
    source_anchor   TEXT,
    prompt_id       TEXT REFERENCES think_prompts(id) ON DELETE SET NULL,
    run_id          TEXT REFERENCES think_runs(id) ON DELETE SET NULL,
    superseded_by   TEXT REFERENCES thoughts(id) ON DELETE SET NULL,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS think_prompts (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT,
    prompt_text   TEXT NOT NULL,
    output_type   TEXT NOT NULL DEFAULT 'free',
    scope         TEXT NOT NULL DEFAULT 'note',
    trigger       TEXT NOT NULL DEFAULT 'manual',
    schedule      TEXT,
    model         TEXT NOT NULL DEFAULT 'claude-opus-4-6',
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS think_runs (
    id              TEXT PRIMARY KEY,
    prompt_id       TEXT NOT NULL REFERENCES think_prompts(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope_note_id   TEXT REFERENCES notes(id) ON DELETE SET NULL,
    scope_folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'running',
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    error           TEXT,
    started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    finished_at     INTEGER
  );

  CREATE TABLE IF NOT EXISTS mcp_tokens (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    token_hash    TEXT NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    last_used_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS user_shortcuts (
    user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    shortcuts_json  TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
  CREATE INDEX IF NOT EXISTS idx_notes_folder_id ON notes(folder_id);
  CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);
  CREATE INDEX IF NOT EXISTS idx_note_revisions_note_id ON note_revisions(note_id);
  CREATE INDEX IF NOT EXISTS idx_thoughts_user_id ON thoughts(user_id);
  CREATE INDEX IF NOT EXISTS idx_thoughts_source_note_id ON thoughts(source_note_id);
  CREATE INDEX IF NOT EXISTS idx_think_runs_prompt_id ON think_runs(prompt_id);
  CREATE INDEX IF NOT EXISTS idx_think_runs_user_id ON think_runs(user_id);
  CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
`);

export default db;
