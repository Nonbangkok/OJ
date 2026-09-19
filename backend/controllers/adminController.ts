import express, { Request, Response, Router } from 'express';
import { requireAuth, requireAdmin, requireStaffOrAdmin } from '../middleware/auth';
import { USER_VALIDATION, SECURITY_CONFIG } from '../constants';
import { diskUpload } from '../middleware/upload';
import {
  BatchCreateUsersRequestBody,
  BatchCreateUsersSuccessResponse,
  CreateAdminUserRequestBody,
  UpdateAdminUserRequestBody,
  UpdateRegistrationSettingRequestBody,
} from '../types/api';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { validateRequest } from '../middleware/validation';
import {
  batchCreateUsersSchema,
  createAdminUserSchema,
  idParamSchema,
  updateAdminUserSchema,
  updateRegistrationSettingSchema,
} from '../schemas/requestSchemas';
import {
  buildDatabaseExportRequest,
  getDatabaseImportProgress,
  runCommand,
  startDatabaseImport,
  unlinkIfExists,
} from '../services/adminDatabaseService';
import {
  createAdminUser,
  createBatchUsers,
  deleteAdminUser,
  getAdminUsers,
  getAuthors,
  getRegistrationEnabled,
  updateAdminUser,
  updateRegistrationEnabled,
} from '../services/adminQueryService';

const router: Router = express.Router();

// Admin API Endpoints
router.get('/admin/users', requireAuth, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const users = await getAdminUsers();
  res.json(users);
}));

router.post('/admin/users', requireAuth, requireAdmin,
  validateRequest({ body: createAdminUserSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const { username, password, role } = req.body as CreateAdminUserRequestBody;
  const createResult = await createAdminUser(username, password, role, SECURITY_CONFIG.SALT_ROUNDS);
  if (createResult.kind === 'duplicate_username') {
    throw new AppError('Username already exists.', 409);
  }
  res.status(201).json(createResult.data);
}));

router.put('/admin/users/:id', requireAuth, requireAdmin,
  validateRequest({ params: idParamSchema, body: updateAdminUserSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { username, role } = req.body as UpdateAdminUserRequestBody;

  if (req.session.userId === Number(id)) {
    throw new AppError('Admins cannot edit their own account.', 403);
  }

  const updateResult = await updateAdminUser(id, username, role);
  if (updateResult.kind === 'not_found') {
    throw new AppError('User not found.', 404);
  }
  if (updateResult.kind === 'protected_user') {
    throw new AppError('The "Nonbangkok" account cannot be edited.', 403);
  }
  if (updateResult.kind === 'duplicate_username') {
    throw new AppError('Username is already taken.', 409);
  }
  res.json(updateResult.data);
}));

router.delete('/admin/users/:id', requireAuth, requireAdmin,
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);

  if (req.session.userId === Number(id)) {
    throw new AppError('Admins cannot delete their own account.', 403);
  }

  const deleteResult = await deleteAdminUser(id);
  if (deleteResult.kind === 'protected_user') {
    throw new AppError('The "Nonbangkok" account cannot be deleted.', 403);
  }
  res.status(200).json({ message: `User ${id} deleted successfully` });
}));

router.post('/admin/users/batch', requireAuth, requireAdmin,
  validateRequest({ body: batchCreateUsersSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const { prefix, count } = req.body as BatchCreateUsersRequestBody;
  const batchResult = await createBatchUsers({
    prefix,
    count,
    saltRounds: SECURITY_CONFIG.SALT_ROUNDS,
    passwordLength: USER_VALIDATION.RANDOM_PASSWORD_LENGTH,
  });
  if (batchResult.kind === 'duplicate_username') {
    throw new AppError(`Username '${batchResult.username}' already exists. Aborting operation.`, 409);
  }
  const responseBody: BatchCreateUsersSuccessResponse = {
    message: `${count} users created successfully.`,
    users: batchResult.users,
  };
  res.status(201).json(responseBody);
}));

router.get('/admin/authors', requireAuth, requireStaffOrAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const authors = await getAuthors();
  res.json(authors);
}));

router.post('/admin/database/import', requireAuth, requireAdmin, diskUpload.single('databaseDump'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No database dump file uploaded.' });
  }

  const startResult = await startDatabaseImport(req.file.originalname, req.file.path);
  if ('kind' in startResult) {
    return res.status(400).json({ message: 'Unsupported file type. Only .sql, .dump, or .tar files are allowed.' });
  }

  res.status(202).json({
    message: 'Database import started. Check progress endpoint for status updates.',
    jobId: startResult.jobId,
    token: startResult.token,
  });
});

// No session middleware runs for this path (server.ts skips it because the import
// drops the session table). Authenticate with the per-job token returned by the
// import start endpoint instead of being fully open. Header-only: a query-string
// token would land in nginx/proxy access logs.
router.get('/admin/database/import-progress/:jobId', (req: Request, res: Response) => {
  const token = Array.isArray(req.headers['x-import-token'])
    ? req.headers['x-import-token'][0]
    : req.headers['x-import-token'];
  const progress = getDatabaseImportProgress(String(req.params.jobId), token);

  if (progress === null) {
    return res.status(404).json({ message: 'Import job not found.' });
  }
  if (progress === 'unauthorized') {
    return res.status(401).json({ message: 'Invalid or missing import token.' });
  }
  res.json(progress);
});

router.post('/admin/database/export', requireAuth, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const { command, dumpFilePath, downloadName } = buildDatabaseExportRequest();

  await runCommand(command);

  // Send the file as a download
  res.download(dumpFilePath, downloadName, (err) => {
    if (err) {
      console.error('Error sending file:', err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error downloading backup file.' });
      }
    }
    // Clean up the temporary dump file
    void unlinkIfExists(dumpFilePath);
  });
}));

router.get('/admin/settings/registration', requireAuth, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const enabled = await getRegistrationEnabled();
  res.json({ enabled });
}));

router.put('/admin/settings/registration', requireAuth, requireAdmin,
  validateRequest({ body: updateRegistrationSettingSchema }),
  asyncHandler(async (req: Request, res: Response) => {
  const { enabled } = req.body as UpdateRegistrationSettingRequestBody;
  await updateRegistrationEnabled(enabled);
  res.status(200).json({ message: 'Registration setting updated successfully.' });
}));

export default router;
