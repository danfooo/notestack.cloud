import { Router } from 'express';
import { join, extname } from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

const ATTACHMENTS_DIR = join(process.cwd(), 'data', 'attachments');
mkdirSync(ATTACHMENTS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const authReq = req as AuthRequest;
      const userDir = join(ATTACHMENTS_DIR, authReq.userId!);
      mkdirSync(userDir, { recursive: true });
      cb(null, userDir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// POST /api/attachments
router.post('/', requireAuth, upload.single('file'), (req: AuthRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const url = `/attachments/${req.userId}/${req.file.filename}`;
  res.status(201).json({
    url,
    filename: req.file.filename,
    original_name: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
});

export default router;
