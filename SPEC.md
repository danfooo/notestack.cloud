# brains — Product Specification

> Version: 0.1 (pre-implementation)
> This spec describes intended behaviour. Move items to TODO.md once deferred, and keep this in sync with what is actually built.

---

## 1. What brains is

**brains** is a personal knowledge system. Users write notes. Claude reads them, thinks about them, and surfaces connections, summaries, and action items — on a cadence the user defines, or triggered by saving a note. Everything is accessible from a web app, a PWA, and an MCP server that Claude Code and other agents can read from and write to.

The editing experience is modelled on Apple Notes: fast, distraction-free, folder-organised. The keyboard shortcuts are drawn from Google Docs. Notes are rich text under the hood but can also be viewed and edited as raw markup.

The MCP server makes brains the persistent memory layer for Claude across chat sessions and Claude Code workspaces — a place where project plans, todo lists, summaries, and Claude's own "thoughts" live outside any single conversation.

---

## 2. Users & Auth

### 2.1 Overview

- Multi-user from day one. Public registration is **disabled by default** — invite-only.
- The first (owner) account is created via a seed script at setup time.
- Auth methods: **email + password** and **Google OAuth**. No Apple Sign-In (no native apps).
- JWTs, 30-day expiry, signed with `JWT_SECRET`. Same middleware pattern as dropby.

### 2.2 Users table

```
users
  id                              TEXT PRIMARY KEY   (randomUUID)
  email                           TEXT UNIQUE NOT NULL
  display_name                    TEXT NOT NULL
  password_hash                   TEXT               (null for Google-only accounts)
  google_id                       TEXT UNIQUE
  avatar_url                      TEXT               (Google picture URL or uploaded)
  email_verified                  INTEGER DEFAULT 0
  email_verification_token        TEXT
  email_verification_expires_at   INTEGER
  password_reset_token            TEXT
  password_reset_expires_at       INTEGER
  created_at                      INTEGER DEFAULT (unixepoch())
```

### 2.3 Auth flows

**Email signup**
1. `POST /api/auth/signup` — requires `email`, `password`, `display_name`, `invite_token`.
2. Invite token is validated (must exist, not revoked, not expired).
3. Account created with `email_verified = 0`.
4. Verification email sent via Resend with a 24-hour token.
5. `POST /api/auth/verify-email` — verifies token, auto-logs in (returns JWT).
6. `POST /api/auth/resend-verification` — re-sends verification email (rate-limit: one email per request, always returns success to prevent enumeration).

**Email login**
1. `POST /api/auth/login` — `email` + `password`.
2. Returns `403 EMAIL_NOT_VERIFIED` if account exists but is unverified.

**Google OAuth**
1. Client renders Google Sign-In button (`@react-oauth/google`), receives a credential (ID token).
2. `POST /api/auth/google` — server verifies the ID token using `google-auth-library`.
3. **New user**: invite token required (`INVITE_REQUIRED` if missing/invalid). Account created with `email_verified = 1`, Google picture stored as `avatar_url`.
4. **Existing user**: linked to Google ID if not already. Google picture only set if `avatar_url` is currently null. No invite token required for existing accounts.
5. `gmail.com` / `googlemail.com` are treated as the same mailbox.

**Forgot / reset password**
- `POST /api/auth/forgot-password` — sends reset email (1-hour token). Always returns success (prevents enumeration). No-op for Google-only accounts (no `password_hash`).
- `POST /api/auth/reset-password` — validates token, sets new password (min 8 chars), auto-logs in.

### 2.4 Invite system

Invites gate all new account creation (both email signup and Google OAuth for new users).

**invite_links table**
```
invite_links
  id              TEXT PRIMARY KEY
  token           TEXT UNIQUE NOT NULL   (random hex, 32 chars)
  created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
  invited_email   TEXT                   (null = open link; set = email-targeted)
  revoked         INTEGER DEFAULT 0
  expires_at      INTEGER NOT NULL
  created_at      INTEGER DEFAULT (unixepoch())
```

**Creating invites**
- `POST /api/invites` — generates an open invite link, valid for **7 days**. Returns `{ token, url, expires_at }`. URL: `APP_URL/invite/:token`.
- `POST /api/invites/email` — sends an invite email to a specific address, valid for **30 days**. Records `invited_email`.

**Reading invites**
- `GET /api/invites/:token` — public (no auth). Returns inviter info, validity, expiry state. Errors: `INVALID_TOKEN`, `REVOKED`, `EXPIRED`.
- `GET /api/invites/open-links` — lists active open-link invites created by the current user.
- `GET /api/invites/pending` — lists active email-targeted invites created by the current user.

**Revoking**
- `POST /api/invites/:token/revoke` — sets `revoked = 1`. Only the creator can revoke.

**Validation rule** (enforced in signup and Google OAuth):
- Token must exist, `revoked = 0`, and `expires_at > now()`.

### 2.5 Profile management

- `GET  /api/auth/me` — returns current user object.
- `PUT  /api/auth/me` — update `display_name`.
- `PUT  /api/auth/avatar` — upload avatar image (multipart, max 5 MB, images only). Stored at `/data/avatars/<uuid>.<ext>`, served at `/avatars/<filename>`.
- `DELETE /api/auth/avatar` — removes custom avatar (clears `avatar_url`).
- `DELETE /api/auth/me` — hard-deletes the account and all associated data.

### 2.6 JWT middleware

- `requireAuth` — extracts `Authorization: Bearer <token>`, verifies with `jose`, attaches `req.userId` and `req.user`. Returns `401` if missing or invalid.
- `optionalAuth` — same but passes through unauthenticated requests without error (used on public invite routes).

### 2.7 Env vars required

| Var | Purpose |
|---|---|
| `JWT_SECRET` | Required in production. Defaults to insecure dev value. |
| `GOOGLE_CLIENT_ID` | Enables Google OAuth. |
| `RESEND_API_KEY` | Email delivery. Logs to console if absent (dev). |
| `EMAIL_FROM` | From address. Default: `brains <noreply@brains.app>`. |
| `APP_URL` | Used in email links. Default: `http://localhost:5173`. |

---

## 3. Notes

### 3.1 Data model

```
notes
  id            TEXT PRIMARY KEY   (nanoid)
  user_id       TEXT NOT NULL
  title         TEXT               (derived from first line if blank)
  body          TEXT               (ProseMirror JSON — see §4)
  body_text     TEXT               (plain-text index, updated on save)
  folder_id     TEXT               (nullable FK → folders)
  pinned        BOOLEAN DEFAULT 0
  archived      BOOLEAN DEFAULT 0
  deleted_at    TEXT               (soft delete)
  created_at    TEXT
  updated_at    TEXT
```

### 3.2 Folders

Folders are hierarchical (unlimited depth). A note belongs to exactly one folder (or none — the root "All Notes" view). Notes can be surfaced in multiple places via tags (see §3.3), which decouples display from storage.

```
folders
  id            TEXT PRIMARY KEY
  user_id       TEXT NOT NULL
  parent_id     TEXT               (nullable — root folders have no parent)
  name          TEXT NOT NULL
  position      INTEGER            (manual sort order within parent)
  created_at    TEXT
  updated_at    TEXT
```

### 3.3 Tags

Tags are freeform strings attached to notes. The UI exposes them as a secondary organisational layer — a note can appear in a smart folder (saved tag query) without being moved. Folders are the primary hierarchy; tags are cross-cutting.

```
note_tags
  note_id   TEXT
  tag       TEXT
  PRIMARY KEY (note_id, tag)
```

### 3.4 Version history

Every save (auto-save or explicit) appends a revision. UI allows browsing and restoring any revision. Storage is full-body snapshots for simplicity (can be optimised to diffs later).

```
note_revisions
  id          TEXT PRIMARY KEY
  note_id     TEXT NOT NULL
  body        TEXT NOT NULL        (ProseMirror JSON snapshot)
  body_text   TEXT
  saved_by    TEXT                 ('user' | 'import' | 'claude')
  created_at  TEXT
```

### 3.5 Sharing (future-ready, not V1)

Notes have a `shared` flag and a `share_token`. When shared, a public read-only URL is available. V1 does not implement collaborative editing — that is a future feature.

---

## 4. Editor

### 4.1 Framework

- **TipTap** (ProseMirror-based) as the rich text engine.
- Document body stored as ProseMirror/TipTap JSON. Plain text (`body_text`) is extracted and stored separately for full-text search.
- Raw mode: toggle to view/edit the underlying JSON (pretty-printed). Not Markdown — the canonical format is TipTap JSON, which supports the full formatting feature set.
- Auto-save: debounced 1 s after last keystroke, plus explicit Cmd+S.

### 4.2 Supported formatting

All standard Apple Notes formatting, plus Google Docs extras:

| Feature | Notes |
|---|---|
| Headings (H1–H3) | |
| Bold, italic, underline, strikethrough | |
| Inline code | |
| Code block (with language) | |
| Blockquote | |
| Bullet list (unordered) | |
| Numbered list (ordered) | |
| Checklist / task list | |
| Link | |
| Image (inline, uploaded) | |
| Horizontal rule | |
| Table | |
| Text colour & highlight | |
| Indent / outdent | |

### 4.3 Keyboard shortcuts

Default set modelled on Google Docs. Shortcuts are user-configurable — stored per user in DB. The default set is defined in a constants file and can be overridden per-binding.

| Action | Default |
|---|---|
| Bold | Cmd+B |
| Italic | Cmd+I |
| Underline | Cmd+U |
| Strikethrough | Cmd+Shift+X |
| Heading 1 | Cmd+Alt+1 |
| Heading 2 | Cmd+Alt+2 |
| Heading 3 | Cmd+Alt+3 |
| Bullet list | Cmd+Shift+8 |
| Numbered list | Cmd+Shift+7 |
| Checklist | Cmd+Shift+9 |
| Code block | Cmd+Alt+C |
| Link | Cmd+K |
| Undo | Cmd+Z |
| Redo | Cmd+Shift+Z |
| Save | Cmd+S |
| New note | Cmd+N |
| Toggle raw mode | Cmd+Shift+R |
| Search | Cmd+F (within note) / Cmd+P (global) |
| Toggle sidebar | Cmd+\ |

### 4.4 Title

The first line of a note is its title. If the title field is blank, the app derives it from the first non-empty text block in the body. The title is displayed in the note list; the body starts on the next line.

---

## 5. Layout & Navigation

### 5.1 Three-pane layout (desktop)

```
┌────────────┬───────────────────┬──────────────────────────┐
│  Sidebar   │   Note list       │   Editor                 │
│  (folders) │   (sorted/filter) │   (active note)          │
└────────────┴───────────────────┴──────────────────────────┘
```

- **Sidebar**: folder tree + special views (All Notes, Pinned, Archived, Trash, Tags, Thoughts).
- **Note list**: notes in selected folder/view, sorted by `updated_at` desc by default. Displays title + body snippet + updated time.
- **Editor**: active note, full height.
- Sidebar collapsible (Cmd+\). On narrow viewports (tablet/mobile PWA), the layout collapses to single-pane with back navigation.

### 5.2 Dashboard

Accessible from the sidebar as a top-level view. Shows:
- **Pinned notes**
- **Recently edited notes** (last 5)
- **Claude's latest thoughts** — most recent N thoughts, each with a link to the source note + reference anchor
- **Active todos** — checklist items marked as open, extracted by Claude's thinking, surfaced here
- **Topics / themes** — tag cloud or list of recurring themes Claude has identified

### 5.3 Search

- Global search (Cmd+P): searches title + `body_text` across all notes. Results ranked by recency and match density.
- In-note find (Cmd+F): TipTap's built-in find.
- Tag filter: click a tag in the sidebar to filter note list.
- Future: semantic / embedding search.

---

## 6. Thoughts (Claude's Output Layer)

### 6.1 Concept

"Thoughts" are structured outputs that Claude produces when processing notes. They are separate from notes — users do not edit them. They exist to surface insights, extract todos, connect ideas, and provide Claude Code with a queryable knowledge layer.

### 6.2 Data model

```
thoughts
  id              TEXT PRIMARY KEY
  user_id         TEXT NOT NULL
  type            TEXT NOT NULL     -- 'summary' | 'todo' | 'connection' | 'theme' | 'free'
  title           TEXT
  body            TEXT              -- Markdown or plain text
  source_note_id  TEXT              -- FK → notes (nullable)
  source_anchor   TEXT              -- text fragment or block id within the note (nullable)
  prompt_id       TEXT              -- FK → think_prompts (which prompt generated this)
  run_id          TEXT              -- FK → think_runs (which execution)
  created_at      TEXT
  superseded_by   TEXT              -- FK → thoughts (if a newer thought replaces this one)
```

**Types:**
- `summary` — Claude's summary of a note or folder
- `todo` — extracted action item, linked to its origin
- `connection` — Claude noticed a relationship between two notes
- `theme` — a recurring topic Claude identified across multiple notes
- `free` — output of a custom prompt that doesn't fit other types

### 6.3 Linking thoughts to notes

`source_note_id` + `source_anchor` form a two-level reference:
- `source_note_id`: the note the thought is about
- `source_anchor`: a block ID or text fragment within that note (optional; used when a thought refers to a specific paragraph, checklist item, etc.)

The UI renders a "View in note" link that opens the note and scrolls to the anchor.

---

## 7. Thinking System (Claude Integration)

### 7.1 Think Prompts

Users define reusable prompts that instruct Claude how to process notes. Each prompt has:

```
think_prompts
  id            TEXT PRIMARY KEY
  user_id       TEXT NOT NULL
  name          TEXT NOT NULL        -- e.g. "Extract todos", "Weekly summary"
  description   TEXT
  prompt_text   TEXT NOT NULL        -- the system/user prompt sent to Claude
  output_type   TEXT                 -- maps to thoughts.type
  scope         TEXT                 -- 'note' | 'folder' | 'all'
  trigger       TEXT                 -- 'on_save' | 'scheduled' | 'manual'
  schedule      TEXT                 -- cron expression (nullable, used if trigger='scheduled')
  model         TEXT DEFAULT 'claude-opus-4-6'
  enabled       BOOLEAN DEFAULT 1
  created_at    TEXT
  updated_at    TEXT
```

**Scope:**
- `note` — runs against a single note (triggered on save or manually per note)
- `folder` — runs against all notes in a folder
- `all` — runs against all notes

**Trigger:**
- `on_save` — fires whenever the note is saved (scope must be `note`)
- `scheduled` — fires on the cron schedule
- `manual` — only fires when the user explicitly invokes it

### 7.2 Think Runs

Each execution of a think prompt is recorded:

```
think_runs
  id              TEXT PRIMARY KEY
  prompt_id       TEXT NOT NULL
  user_id         TEXT NOT NULL
  scope_note_id   TEXT              -- if scope='note', which note
  scope_folder_id TEXT              -- if scope='folder', which folder
  status          TEXT              -- 'running' | 'done' | 'error'
  input_tokens    INTEGER
  output_tokens   INTEGER
  error           TEXT
  started_at      TEXT
  finished_at     TEXT
```

### 7.3 Execution flow

1. Trigger fires (on_save event or cron job or manual button).
2. Server fetches the note(s) in scope, serialises them to plain text.
3. Builds the prompt: `[system: think_prompts.prompt_text] + [user: serialised notes]`.
4. Calls Claude API (streaming for large notes).
5. Parses the response into one or more `thoughts` rows (the prompt instructs Claude to output structured JSON).
6. Stores thoughts; marks any older thoughts from the same prompt+note as `superseded_by` the new ones.
7. If the prompt instructs Claude to modify a note (opt-in, explicit in prompt definition), the server applies the changes and saves a new revision with `saved_by = 'claude'`.

### 7.4 Built-in default prompts (seeded)

These are created for every new user:

| Name | Trigger | Scope | Type |
|---|---|---|---|
| Extract todos | on_save | note | todo |
| Summarise note | manual | note | summary |
| Weekly digest | scheduled (Mon 8am) | all | summary + theme |
| Find connections | scheduled (daily 2am) | all | connection |

---

## 8. MCP Server

### 8.1 Overview

brains exposes an HTTP MCP server at `/mcp`. It uses the standard MCP protocol (JSON-RPC over HTTP + SSE for streaming). Authentication uses a per-user MCP API token (generated on demand, stored as a hash).

### 8.2 Tools exposed

| Tool | Description |
|---|---|
| `search_notes` | Full-text search across notes. Args: `query`, `folder_id?`, `limit?` |
| `get_note` | Fetch a note by ID (returns title + plain text body). Args: `note_id` |
| `list_notes` | List notes in a folder or all notes. Args: `folder_id?`, `limit?`, `offset?` |
| `create_note` | Create a new note. Args: `title`, `body_markdown`, `folder_id?`, `tags?` |
| `update_note` | Update an existing note's body. Args: `note_id`, `body_markdown` |
| `list_folders` | Return the folder tree. |
| `list_thoughts` | Return recent thoughts. Args: `type?`, `note_id?`, `limit?` |
| `create_thought` | Write a new thought (Claude Code can store its own thoughts here). Args: `type`, `title`, `body`, `source_note_id?`, `source_anchor?` |
| `get_dashboard` | Return a structured dashboard summary: pinned notes, recent notes, active todos, recent thoughts. |
| `run_prompt` | Trigger a named think prompt manually. Args: `prompt_name`, `note_id?` |

### 8.3 MCP token

- Each user can generate one or more named MCP tokens from Settings.
- Tokens are shown once on creation and stored as a bcrypt hash.
- Passed as `Authorization: Bearer <token>` on each MCP request.

### 8.4 Claude Code integration

The MCP server URL + token is configured in the user's Claude Code settings (`~/.claude/settings.json`) under `mcpServers`. From there, Claude Code has access to all tools above, enabling it to:

- Query project plans and todos stored as notes
- Surface relevant thoughts at the start of a session
- Store session summaries and decisions as thoughts
- Create or update notes during a project

---

## 9. Import

### 9.1 Apple Notes (primary)

Apple's EU data export produces a zip containing notes in a structured format (likely HTML or ENEX-style XML — exact format confirmed when the export arrives). The import pipeline:

1. User uploads the zip via the web UI (Settings → Import).
2. Server extracts, parses each note file.
3. Each note is converted to TipTap JSON (HTML → ProseMirror via a server-side parser).
4. Folder structure is reconstructed from the Apple folder/album metadata.
5. Attachments (images) are extracted and stored.
6. Notes are inserted with `saved_by = 'import'` in their initial revision.
7. Duplicates: no deduplication — re-importing appends new notes. User is warned with a count before confirming.

### 9.2 Other formats (future)

The import system is designed as a pluggable pipeline. Future importers:
- Markdown files / zip of `.md` files
- Evernote (`.enex`)
- Notion export (HTML/Markdown zip)
- Bear (`.bearbk`)

### 9.3 Image & attachment storage

Imported images and inline attachments are stored on the server filesystem under `/data/attachments/<user_id>/`. Served via `/attachments/:user_id/:filename` (auth-gated). Production: migrate to object storage (S3/Tigris on Fly) — tracked in TODO.

---

## 10. Stack

Identical to dropby wherever possible:

| Layer | Technology |
|---|---|
| Client | React 18 + Vite + TypeScript + Tailwind CSS |
| Editor | TipTap 2 (ProseMirror) |
| State | Zustand (UI state) + TanStack React Query (server state) |
| Server | Node + Express + TypeScript |
| DB | better-sqlite3 (single file, WAL mode) |
| Auth | bcrypt + JWT (jose) |
| Email | Resend |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) |
| MCP | `@modelcontextprotocol/sdk` |
| Cron | node-cron |
| PWA | vite-plugin-pwa |
| Deploy | Fly.io |
| Dev | tsx watch, concurrently |

No native apps. Web + PWA only.

---

## 11. API Surface (REST)

All routes prefixed `/api`. Auth via `Authorization: Bearer <jwt>` except `/api/auth/*`.

### Auth
- `POST /api/auth/signup` — email + password + display_name + invite_token → 201 (sends verification email)
- `POST /api/auth/verify-email` — token → JWT + user
- `POST /api/auth/resend-verification` — email → (re-sends verification)
- `POST /api/auth/login` — email + password → JWT + user
- `POST /api/auth/google` — Google ID token + invite_token? → JWT + user
- `POST /api/auth/forgot-password` — email → (sends reset email)
- `POST /api/auth/reset-password` — token + password → JWT + user
- `GET  /api/auth/me` — current user
- `PUT  /api/auth/me` — update display_name
- `PUT  /api/auth/avatar` — upload avatar image (multipart)
- `DELETE /api/auth/avatar` — remove avatar
- `DELETE /api/auth/me` — delete account

### Invites
- `POST   /api/invites` — create open invite link (7 days)
- `POST   /api/invites/email` — send email invite (30 days)
- `GET    /api/invites/open-links` — list active open-link invites by current user
- `GET    /api/invites/pending` — list active email invites by current user
- `GET    /api/invites/:token` — get invite info (public)
- `POST   /api/invites/:token/revoke` — revoke invite

### Notes
- `GET    /api/notes` — list (query: `folder_id`, `tag`, `q`, `limit`, `offset`, `archived`)
- `POST   /api/notes` — create
- `GET    /api/notes/:id` — get with body
- `PATCH  /api/notes/:id` — update (title, body, folder_id, pinned, archived, tags)
- `DELETE /api/notes/:id` — soft delete
- `GET    /api/notes/:id/revisions` — list revisions
- `POST   /api/notes/:id/revisions/:rev_id/restore` — restore revision

### Folders
- `GET    /api/folders` — full tree
- `POST   /api/folders` — create
- `PATCH  /api/folders/:id` — rename / reparent / reorder
- `DELETE /api/folders/:id` — delete (notes move to root)

### Thoughts
- `GET    /api/thoughts` — list (query: `type`, `note_id`, `limit`, `offset`)
- `GET    /api/thoughts/:id` — get
- `DELETE /api/thoughts/:id` — delete (admin/user only, not expected in normal flow)

### Think Prompts
- `GET    /api/think-prompts` — list user's prompts
- `POST   /api/think-prompts` — create
- `PATCH  /api/think-prompts/:id` — update
- `DELETE /api/think-prompts/:id` — delete
- `POST   /api/think-prompts/:id/run` — trigger manually

### Think Runs
- `GET    /api/think-runs` — history (query: `prompt_id`, `limit`)
- `GET    /api/think-runs/:id` — get run + its thoughts

### Import
- `POST   /api/import/apple-notes` — multipart upload (zip)
- `GET    /api/import/:job_id` — poll import job status

### Settings
- `GET    /api/settings` — user settings (shortcuts, preferences)
- `PATCH  /api/settings` — update
- `GET    /api/settings/mcp-tokens` — list tokens (names only)
- `POST   /api/settings/mcp-tokens` — generate new token (returns plaintext once)
- `DELETE /api/settings/mcp-tokens/:id` — revoke

### Dashboard
- `GET /api/dashboard` — aggregated: pinned notes, recent notes, active todos, recent thoughts

### Attachments
- `POST /api/attachments` — upload image/file
- `GET  /attachments/:user_id/:filename` — serve (auth-gated)

### MCP
- `POST /mcp` — MCP JSON-RPC endpoint
- `GET  /mcp/sse` — SSE stream for MCP (if needed by client)

---

## 12. Key Screens

### 12.1 Notes (main view)
Three-pane layout. Sidebar has: All Notes, Pinned, Recent, Trash, Folders tree, Tags, Thoughts, Dashboard. Note list shows title + snippet + timestamp. Editor is TipTap, full height, floating toolbar on selection.

### 12.2 Dashboard
Card grid: Pinned notes, Recent notes, Todos (extracted by Claude), Themes/topics, Latest thoughts. Each thought card shows title, type badge, body snippet, "View in note" link.

### 12.3 Thoughts view
Filterable list of all thoughts. Filter by type, by note, by date. Each thought is expandable. "View in note" navigates to the source note and highlights the anchor text.

### 12.4 Think Prompts (Settings sub-page)
List of prompts. Create / edit / delete. Per-prompt: name, description, prompt text, scope, trigger, schedule, model, enabled toggle. Run history per prompt.

### 12.5 Import (Settings sub-page)
Upload zone. Shows progress bar for active import jobs. After completion: summary (N notes imported, N folders created, N attachments). Link to view imported notes.

### 12.6 MCP Tokens (Settings sub-page)
List of named tokens (no secret shown). Create new token (name it → one-time display of the token value). Revoke any token. Shows last-used timestamp.

---

## 13. PWA

- Installable on desktop and mobile.
- Service worker: caches the app shell and recently viewed notes for offline reading.
- Offline writes: queued and synced on reconnect.
- No push notifications in V1.

---

## 14. What brains is not (V1)

- No real-time collaboration
- No public note sharing (URL sharing is future)
- No mobile native app
- No Markdown as the canonical storage format (TipTap JSON is canonical; Markdown is an import/export format only)
- No embedding / semantic search (full-text only in V1)
- No billing / subscription system
