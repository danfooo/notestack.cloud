# notestack.cloud — Claude Instructions

## What this project is
notestack.cloud is a personal knowledge system. Users write notes. Claude reads them, thinks about them, and surfaces connections, summaries, and action items. It exposes an MCP server so Claude Code can use it as persistent memory.

## Stack
- **Server**: Node + Express + TypeScript (tsx watch in dev), port 3000
- **Client**: React 18 + Vite + TypeScript + Tailwind CSS, port 5173
- **DB**: better-sqlite3, WAL mode, file at `server/data/notestack.db`
- **Auth**: bcrypt + JWT (jose), 30-day expiry
- **AI**: @anthropic-ai/sdk, default model claude-opus-4-6
- **MCP**: Manual JSON-RPC at POST /mcp

## Node version
This project requires **Node 20**. A `.nvmrc` is committed. Always run `nvm use` (no version argument) before any npm/node commands — it reads the version from `.nvmrc`:
```bash
nvm use   # reads .nvmrc → Node 20
```
If you see a `better-sqlite3` binding error, you're on the wrong Node — run `nvm use` and `npm rebuild better-sqlite3`.
For tool binaries (tsx, tsc, vite, etc.) use `./node_modules/.bin/<tool>` or `npx <tool>` — never assume global installs.

## Dev commands
```bash
npm run dev          # start both server + client
npm run dev:server   # server only
npm run dev:client   # client only
npm run build        # build client
npm run build:server # build server (TypeScript check)
cd server && npm run seed  # create first admin user
```

## Key conventions
- All DB timestamps are Unix integers (seconds). Use `(unixepoch())` as default.
- Note body stored as JSON-stringified TipTap/ProseMirror JSON. body_text is plain text for search.
- nanoid for all IDs (not UUID).
- Routes follow REST conventions, all prefixed `/api/`.
- MCP endpoint at `/mcp` (no `/api/` prefix).
- Fire-and-forget on_save think prompts (don't await).

## Environment
- Copy `.env.example` to `.env` and fill in values.
- `JWT_SECRET` must be set in production.
- `ANTHROPIC_API_KEY` required for think prompts.
- `RESEND_API_KEY` required for emails (falls back to console.log in dev).

## File layout
- `server/src/` — Express app
- `server/src/db/` — SQLite schema + helpers
- `server/src/middleware/` — auth middleware
- `server/src/routes/` — route handlers
- `server/src/services/` — email, claude AI wrapper
- `client/src/` — React app
- `client/src/api/` — axios API layer
- `client/src/stores/` — Zustand stores
- `client/src/pages/` — page components
- `client/src/components/` — shared components
