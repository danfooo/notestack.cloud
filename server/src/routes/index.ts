import { Router } from 'express';
import authRouter from './auth.js';
import invitesRouter from './invites.js';
import foldersRouter from './folders.js';
import notesRouter from './notes.js';
import thoughtsRouter from './thoughts.js';
import thinkPromptsRouter from './thinkPrompts.js';
import thinkRunsRouter from './thinkRuns.js';
import dashboardRouter from './dashboard.js';
import settingsRouter from './settings.js';
import attachmentsRouter from './attachments.js';
import importRouter from './import.js';

const router = Router();

router.use('/auth', authRouter);
router.use('/invites', invitesRouter);
router.use('/folders', foldersRouter);
router.use('/notes', notesRouter);
router.use('/thoughts', thoughtsRouter);
router.use('/think-prompts', thinkPromptsRouter);
router.use('/think-runs', thinkRunsRouter);
router.use('/dashboard', dashboardRouter);
router.use('/settings', settingsRouter);
router.use('/attachments', attachmentsRouter);
router.use('/import', importRouter);

export default router;
