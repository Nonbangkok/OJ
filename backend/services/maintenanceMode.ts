import { Request, Response, NextFunction } from 'express';

/**
 * DB-05: in-process maintenance mode for the database import window.
 *
 * The import drops and recreates the whole public schema before restoring the
 * dump, so any API request that touches the database during that window fails
 * with a 500. This module is a simple process-wide flag:
 *
 *  - `beginMaintenanceMode()` claims the window (returns false when another
 *    import is already running — the caller rejects the second import).
 *  - The `maintenanceGate` middleware (mounted in app.ts before the session
 *    middleware) fails every request fast with a 503 while the flag is set,
 *    except the paths that must stay reachable: health checks (liveness) and
 *    the token-authenticated import-progress endpoint.
 *
 * Deliberately simple: single-process state, no DB reads (the DB is being
 * dropped). The contest scheduler additionally checks the flag so it pauses
 * its ticks for the duration (see contestScheduler.pause/resume), and judge
 * intake stops naturally because /submit is 503'd.
 */

let maintenanceActive = false;

/** Whether the API is currently in the import maintenance window. */
export const isMaintenanceActive = (): boolean => maintenanceActive;

/**
 * Claim the maintenance window. Returns false when one is already active
 * (a second concurrent import must be rejected, not queued).
 */
export const beginMaintenanceMode = (): boolean => {
  if (maintenanceActive) {
    return false;
  }
  maintenanceActive = true;
  return true;
};

/** Release the maintenance window (idempotent). */
export const endMaintenanceMode = (): void => {
  maintenanceActive = false;
};

/** Paths that stay reachable while maintenance is active. */
const MAINTENANCE_EXEMPT_PREFIXES = [
  // Liveness/readiness probes run before session middleware already, but the
  // gate sits above them defensively — a 503-ing health check would make the
  // container orchestrator kill the backend mid-import.
  '/health',
  // Token-authenticated (not session-authenticated) import progress reader;
  // the frontend polls it during the import.
  '/admin/database/import-progress/',
];

/**
 * Global middleware: 503 every request while maintenance mode is active.
 * Mounted early in app.ts (before the session store is touched).
 */
export const maintenanceGate = (req: Request, res: Response, next: NextFunction): void => {
  if (!maintenanceActive) {
    next();
    return;
  }
  if (MAINTENANCE_EXEMPT_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(prefix))) {
    next();
    return;
  }
  res.status(503).json({
    message: 'The system is undergoing database maintenance (import in progress). Please try again shortly.',
  });
};
