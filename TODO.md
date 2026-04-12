# TODO — Deferred Items

## V2 Features
- Real-time collaboration (WebSockets / CRDT)
- Public note sharing (share_token URL)
- Semantic / embedding search (beyond full-text)
- Mobile native app (React Native or Capacitor)
- Markdown as import/export format
- Billing / subscription system

## Infrastructure
- Object storage for attachments (S3/Tigris on Fly) — currently filesystem
- Push notifications (PWA push API)
- Analytics / telemetry

## Editor
- Offline writes queue (PWA)
- In-note find highlighting (Cmd+F)
- Diff-based revision storage (currently full snapshots)
- Image resize in editor

## Import
- Markdown zip import
- Evernote ENEX import
- Notion HTML/Markdown zip import
- Bear .bearbk import
- Apple Notes deduplication on re-import

## AI / Thinking
- Streaming UI for think prompt runs
- Thought linking UI (connect two notes visually)
- Embedding search after thoughts
- Claude modifying note content (opt-in per prompt)

## MCP
- SSE streaming endpoint at GET /mcp/sse
- More granular tool permissions
- Per-token scope restrictions
