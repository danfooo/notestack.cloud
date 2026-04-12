import { Request, Response, NextFunction } from 'express';
import { jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET env var must be set in production');
}
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-change-in-production'
);

export interface AuthRequest extends Request {
  userId?: string;
  user?: {
    id: string;
    email: string;
    display_name: string;
    avatar_url: string | null;
    email_verified: number;
    google_id: string | null;
    created_at: number;
  };
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.sub as string;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as AuthRequest['user'];
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.userId = userId;
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();

  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.sub as string;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as AuthRequest['user'];
    if (user) {
      req.userId = userId;
      req.user = user;
    }
  } catch {
    // ignore
  }
  next();
}

export async function mcpAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'MCP token required' });
  }

  const token = authHeader.slice(7);
  try {
    // Find all tokens and compare against hash
    const tokens = db.prepare('SELECT * FROM mcp_tokens').all() as Array<{
      id: string;
      user_id: string;
      token_hash: string;
    }>;

    let matchedUserId: string | null = null;
    let matchedTokenId: string | null = null;

    for (const t of tokens) {
      const match = await bcrypt.compare(token, t.token_hash);
      if (match) {
        matchedUserId = t.user_id;
        matchedTokenId = t.id;
        break;
      }
    }

    if (!matchedUserId) {
      return res.status(401).json({ error: 'Invalid MCP token' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(matchedUserId) as AuthRequest['user'];
    if (!user) return res.status(401).json({ error: 'User not found' });

    // Update last_used_at
    db.prepare('UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?').run(
      Math.floor(Date.now() / 1000),
      matchedTokenId
    );

    req.userId = matchedUserId;
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid MCP token' });
  }
}

export async function signJwt(userId: string): Promise<string> {
  const { SignJWT } = await import('jose');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(JWT_SECRET);
}
