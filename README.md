# notestack.cloud

A personal knowledge system. Write notes, and Claude reads them, surfaces connections, summaries, and action items. Exposes an MCP server so Claude Code can use it as persistent memory.

## Local development

### Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)

### Setup

**1. Install dependencies**

```bash
npm install
```

**2. Configure environment**

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

| Variable | Description |
|---|---|
| `JWT_SECRET` | Any long random string |
| `ANTHROPIC_API_KEY` | Shared team Anthropic API key |

The other variables are optional for local dev — email falls back to `console.log` and Google OAuth can be skipped.

**3. Create your first user**

Add your credentials to `.env`:

```
SEED_EMAIL=you@example.com
SEED_PASSWORD=yourpassword
SEED_NAME=Your Name
```

Then run:

```bash
cd server && npm run seed
```

**4. Start the dev server**

```bash
npm run dev
```

This starts both the server (port 3000) and client (port 5173) with hot reload. Open [http://localhost:5173](http://localhost:5173) and log in with your seed credentials.

---

## Production deployment (Fly.io)

The app is deployed on [Fly.io](https://fly.io). Config lives in `fly.toml`. Non-secret config (`NODE_ENV`, `PORT`, `DATA_DIR`) is already set there.

Secrets are stored in Fly's secret store and never committed to the repo. To check what's already set:

```bash
fly secrets list
```

To set a missing secret:

```bash
fly secrets set JWT_SECRET=your-value
```

Required secrets:

| Secret | Description |
|---|---|
| `JWT_SECRET` | Long random string, consistent across deploys |
| `ANTHROPIC_API_KEY` | Shared team Anthropic API key |
| `RESEND_API_KEY` | [Resend](https://resend.com) API key for emails |
| `EMAIL_FROM` | From address, e.g. `notestack.cloud <noreply@notestack.cloud>` |
| `APP_URL` | Public URL, e.g. `https://notestack.cloud` |

To deploy:

```bash
fly deploy
```

---

## Other commands

```bash
npm run build         # build client for production
npm run build:server  # typecheck server
npm test              # run server tests
```
