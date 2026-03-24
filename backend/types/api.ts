/**
 * API-layer shapes that are not direct DB rows.
 * Covers request bodies, composite response payloads, and
 * callback parameter types used inside controllers.
 */

// ---------------------------------------------------------------------------
// Admin — Batch User Creation
// ---------------------------------------------------------------------------

/**
 * A single entry in the batch-user-creation response array.
 * Replaces the `any[]` typed `generatedUsers` in adminController.
 */
export interface BatchUserEntry {
    username: string;
    password: string;
}

// ---------------------------------------------------------------------------
// Problem — Batch Upload Progress
// ---------------------------------------------------------------------------

/**
 * The shape of data emitted by `processBatchUpload`'s progress callback.
 * Extra keys are allowed via the index signature since the service may add
 * task-specific fields dynamically.
 */
export interface BatchUploadProgressData {
    status: string;
    message: string;
    [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Problem — Export Config
// ---------------------------------------------------------------------------

/**
 * The `config.json` written inside each problem folder during export.
 */
export interface ProblemExportConfig {
    id: string;
    title: string;
    author: string | null;
    time_limit_ms: number;
    memory_limit_mb: number;
}
