import express from 'express';
import cors from 'cors';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import apiRouter from './routes/index.js';
import mcpRouter from './routes/mcp.js';

// Start cron jobs
import './cron.js';

const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

// Ensure data directories exist
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data');
mkdirSync(join(dataDir, 'avatars'), { recursive: true });
mkdirSync(join(dataDir, 'attachments'), { recursive: true });

const allowedOrigins = isDev
  ? ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173']
  : [process.env.APP_URL ?? 'https://notestack.cloud'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (!isDev) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// Serve uploaded avatars
const avatarsDir = join(dataDir, 'avatars');
app.use('/avatars', express.static(avatarsDir));

// Serve attachments (auth-gated in future; for now static serve is fine since paths are UUIDs)
const attachmentsDir = join(dataDir, 'attachments');
app.use('/attachments', express.static(attachmentsDir));

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// API routes
app.use('/api', apiRouter);

// MCP endpoint (no /api prefix)
app.use('/mcp', mcpRouter);

// Serve static client in production
if (!isDev) {
  const clientDist = join(process.cwd(), 'client', 'dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => res.sendFile(join(clientDist, 'index.html')));
  }
}

app.listen(PORT, () => {
  console.log(`notestack.cloud server running on http://localhost:${PORT}`);
});

export default app;
