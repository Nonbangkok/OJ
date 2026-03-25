import express, { Request, Response, Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
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
import { env } from '../config/env';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { validateRequest } from '../middleware/validation';
import {
  batchCreateUsersSchema,
  createAdminUserSchema,
  idParamSchema,
  updateAdminUserSchema,
  updateRegistrationSettingSchema,
} from '../schemas/requestSchemas';
import { getErrorMessage } from '../utils/errorMessage';
import {
  buildDatabaseExportCommand,
  buildDatabaseExportFilePath,
  buildDatabaseImportCommand,
} from '../services/adminSystemService';
import {
  createAdminUser,
  createBatchUsers,
  deleteAdminUser,
  dropAllTablesForImport,
  getAdminUsers,
  getAuthors,
  getRegistrationEnabled,
  updateAdminUser,
  updateRegistrationEnabled,
} from '../services/adminQueryService';

const router: Router = express.Router();
const execPromise = promisify(exec);

const unlinkIfExists = async (filePath: string): Promise<void> => {
  if (!fs.existsSync(filePath)) {
    return;
  }
  try {
    await fs.promises.unlink(filePath);
  } catch (unlinkError: unknown) {
    console.error(`Error deleting temporary file (${filePath}):`, unlinkError);
  }
};

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

  const dumpFilePath = req.file.path;
  try {
    const dbName = env.PGDATABASE;
    const dbUser = env.PGUSER;
    const dbHost = env.PGHOST;
    const dbPort = env.PGPORT;

    const importCommandResult = buildDatabaseImportCommand(
      req.file.originalname,
      dumpFilePath,
      dbName,
      dbUser,
      dbHost,
      dbPort,
      env.PGPASSWORD,
    );
    if (importCommandResult.kind === 'unsupported_extension') {
      await unlinkIfExists(dumpFilePath);
      return res.status(400).json({ message: 'Unsupported file type. Only .sql, .dump, or .tar files are allowed.' });
    }

    // IMPORTANT: Drop all existing tables before importing to ensure a clean state.
    console.log('Dropping existing tables before import...');

    await dropAllTablesForImport();

    console.log(`Executing database import command: ${importCommandResult.command}`);
    await execPromise(importCommandResult.command);

    res.status(200).json({ message: 'Database imported successfully.' });

  } catch (error: unknown) {
    console.error('Error during database import:', error);
    const message = getErrorMessage(error);
    res.status(500).json({ message: 'Failed to import database.', error: message });
  } finally {
    await unlinkIfExists(dumpFilePath);
  }
});

router.post('/admin/database/export', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const dbName = env.PGDATABASE;
    const dbUser = env.PGUSER;
    const dbHost = env.PGHOST;
    const dbPort = env.PGPORT;

    const timestamp = Date.now();
    const dumpFilePath = buildDatabaseExportFilePath(timestamp);
    const pgDumpCommand = buildDatabaseExportCommand(
      dumpFilePath,
      dbName,
      dbUser,
      dbHost,
      dbPort,
      env.PGPASSWORD,
    );

    console.log(`Executing pg_dump command: ${pgDumpCommand}`);
    await execPromise(pgDumpCommand);

    // Send the file as a download
    res.download(dumpFilePath, `oj_backup_${timestamp}.sql`, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).json({ message: 'Error downloading backup file.' });
        }
      }
      // Clean up the temporary dump file
      void unlinkIfExists(dumpFilePath);
    });

  } catch (error: unknown) {
    console.error('Error during database export:', error);
    if (!res.headersSent) {
      const message = getErrorMessage(error);
      res.status(500).json({ message: 'Failed to export database.', error: message });
    }
  }
});

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
