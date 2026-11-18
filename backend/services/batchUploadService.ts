import fs from 'fs';
const fsPromises = fs.promises;
import path from 'path';
import * as unzipper from 'unzipper';
import { Transform, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import type { PoolClient } from 'pg';
import * as db from '../db';
import { UPLOAD_STATUS, FILE_CONFIG, DEFAULT_SUBMISSION_FILENAME, ARCHIVE_LIMITS, type ProblemFileRole } from '../constants';
import { BatchUploadProgressData } from '../types/api';
import {
  BatchUploadResult,
  ProblemProcessResult,
  TestcasePairMap,
} from '../types/service';
import {
  formatProblemZipConfigError,
  problemZipConfigSchema,
  type ProblemZipConfig,
} from '../schemas/problemZipConfig';
import { resolveCollectionIdByName } from './collectionQueryService';
import { replaceProblemFiles } from './problemFilesService';
import type { ProblemFileInput } from '../utils/headerProblemFiles';
import { pairFlatDirTestcaseFiles, pairZippedTestcaseFiles } from './testcaseZipPairing';
import { assertSafeArchive, MAX_ARCHIVE_ENTRIES, type ArchiveEntryLike } from '../utils/archiveSafety';
import { privateTempDir, removePrivateTemp } from '../utils/privateTemp';
import { isMaintenanceActive } from './maintenanceMode';

// Re-exported for the callers that have always imported the archive guard from
// this service; the implementation now lives in `utils/archiveSafety`.
export { assertSafeArchive, MAX_ARCHIVE_ENTRIES };
export type { ArchiveEntryLike };

const PDF_MAGIC = Buffer.from('%PDF');

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

/** Bytes inflated so far from one archive, shared by all of its entries. */
interface InflateBudget {
  total: number;
}

/**
 * Inflate one archive entry into `sink`, counting the bytes it actually
 * produces. The entry may not produce more than the uncompressedSize its
 * central directory declares (which assertSafeArchive summed against the cap),
 * so a lying size aborts the inflate at once instead of filling the disk or
 * the heap; it may not end short of it either; and the archive's running total
 * may not pass ARCHIVE_LIMITS.MAX_UNCOMPRESSED_BYTES. Every read of an archive
 * entry goes through here: extraction to disk and in-memory reads alike.
 */
async function inflateEntryBounded(entry: unzipper.File, budget: InflateBudget, sink: Writable): Promise<void> {
  const declared = entry.uncompressedSize;
  if (!Number.isSafeInteger(declared) || declared < 0) {
    throw new Error(`Archive rejected: entry "${entry.path}" has no valid declared size.`);
  }
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      budget.total += chunk.length;
      if (size > declared) {
        done(new Error(`Archive rejected: entry "${entry.path}" inflates past its declared size of ${declared} bytes.`));
        return;
      }
      if (budget.total > ARCHIVE_LIMITS.MAX_UNCOMPRESSED_BYTES) {
        done(new Error(`Archive rejected: uncompressed size exceeds ${ARCHIVE_LIMITS.MAX_UNCOMPRESSED_BYTES} bytes (decompression bomb).`));
        return;
      }
      done(null, chunk);
    },
  });
  await pipeline(entry.stream(), counter, sink);
  if (size !== declared) {
    throw new Error(`Archive rejected: entry "${entry.path}" holds ${size} bytes but declares ${declared}.`);
  }
}

/** Read one archive entry into memory through inflateEntryBounded. */
async function readEntryBounded(entry: unzipper.File, budget: InflateBudget): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await inflateEntryBounded(entry, budget, new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk);
      done();
    },
  }));
  return Buffer.concat(chunks);
}

/**
 * Extract an archive entry by entry into `destination` (a private temp dir),
 * each entry through inflateEntryBounded. Directories are 0700 and files
 * 0600. Call assertSafeArchive first; paths are re-checked here so nothing
 * lands outside `destination`, and a duplicate entry is rejected.
 */
async function extractArchiveBounded(entries: unzipper.File[], destination: string): Promise<void> {
  const root = path.resolve(destination);
  const budget: InflateBudget = { total: 0 };
  for (const entry of entries) {
    const target = path.resolve(root, entry.path.replace(/\\/g, '/'));
    const relative = path.relative(root, target);
    if (relative === '') continue;
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Archive rejected: path traversal in entry "${entry.path}".`);
    }
    if (entry.type === 'Directory') {
      await fsPromises.mkdir(target, { recursive: true, mode: 0o700 });
      continue;
    }
    await fsPromises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });

    try {
      await inflateEntryBounded(entry, budget, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Archive rejected: duplicate entry "${entry.path}".`);
      }
      throw error;
    }
  }
}

/**
 * Import a problem's testcase ZIP whole or not at all. The flat layout inserts
 * pair by pair as it reads, so an entry rejected part-way (lying or short
 * size, over the cap) or a failed insert rolls back to the savepoint, leaving
 * the problem with no testcases rather than a partial set.
 */
async function processTestcasesFromZip(client: PoolClient, problemId: string, zipPath: string, log: string[]): Promise<number> {
  await client.query('SAVEPOINT testcase_zip');
  try {
    const count = await insertTestcasesFromZip(client, problemId, zipPath, log);
    await client.query('RELEASE SAVEPOINT testcase_zip');
    return count;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT testcase_zip');
    throw error;
  }
}

async function insertTestcasesFromZip(client: PoolClient, problemId: string, zipPath: string, log: string[]): Promise<number> {
  const zip = await unzipper.Open.file(zipPath);

  // Check for input/output directory structure within the zip
  const inputDirPattern = /\/input\//i;
  const outputDirPattern = /\/output\//i;

  const firstInputFile = zip.files.find(file => !file.path.startsWith('__MACOSX') && inputDirPattern.test('/' + file.path));
  const firstOutputFile = zip.files.find(file => !file.path.startsWith('__MACOSX') && outputDirPattern.test('/' + file.path));

  if (firstInputFile && firstOutputFile) {
    // --- New Logic: Handle zipped input/output directories ---
    log.push('Detected input/output directory structure inside zip.');

    let tempExtractDir: string | undefined;

    try {
      // Validate entries (zip-slip / zip-bomb) before extracting to disk.
      assertSafeArchive(zip.files as unknown as ArchiveEntryLike[]);

      // Extract the entire zip into a private directory, bounded by real size.
      tempExtractDir = await privateTempDir('inner-zip-');
      await extractArchiveBounded(zip.files, tempExtractDir);

      // Find the common base path of the input/output directories.
      const basePathInZip = path.dirname(firstInputFile.path).split('/input')[0];

      const inputDir = path.join(tempExtractDir, basePathInZip, 'input');
      const outputDir = path.join(tempExtractDir, basePathInZip, 'output');

      return await processTestcasesFromInputOutputDirs(client, problemId, inputDir, outputDir, log);

    } finally {
      // Clean up the temporary extraction directory (no shell — avoids injection).
      if (tempExtractDir) await removePrivateTemp(tempExtractDir);
    }

  } else {
    // --- Fallback to original logic for flat zip files ---
    // Nothing is extracted here: the paired entries are read into memory, so
    // validate the whole archive first and read each one bounded by real size.
    log.push('Detected flat file structure inside zip.');
    assertSafeArchive(zip.files as unknown as ArchiveEntryLike[]);
    const testcaseFiles = pairZippedTestcaseFiles(zip.files);
    const budget: InflateBudget = { total: 0 };
    return processPairedFiles(client, problemId, testcaseFiles, (file) => readEntryBounded(file, budget), log);
  }
}

async function processTestcasesFromInputOutputDirs(client: PoolClient, problemId: string, inputDir: string, outputDir: string, log: string[]): Promise<number> {
  const inputFilenames = (await fsPromises.readdir(inputDir)).filter(f => f !== '.DS_Store');
  const outputFilenames = (await fsPromises.readdir(outputDir)).filter(f => f !== '.DS_Store');

  if (inputFilenames.length !== outputFilenames.length) {
    log.push(`Mismatch: Found ${inputFilenames.length} input files but ${outputFilenames.length} output files. Cannot pair them.`);
    return 0;
  }

  if (inputFilenames.length === 0) {
    log.push(`No testcase files found in input/output directories.`);
    return 0;
  }

  const sortOptions: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };
  inputFilenames.sort((a, b) => a.localeCompare(b, undefined, sortOptions));
  outputFilenames.sort((a, b) => a.localeCompare(b, undefined, sortOptions));

  const testcaseFiles: TestcasePairMap<string> = {};
  for (let i = 0; i < inputFilenames.length; i++) {
    const key = i + 1; // Use 1-based indexing for pairs
    testcaseFiles[key] = {
      in: path.join(inputDir, inputFilenames[i]),
      out: path.join(outputDir, outputFilenames[i])
    };
  }

  return processPairedFiles(client, problemId, testcaseFiles, (filePath: string) => fsPromises.readFile(filePath), log);
}

async function processTestcasesFromFlatDir(client: PoolClient, problemId: string, dirPath: string, log: string[]): Promise<number> {
  const allFiles = await fsPromises.readdir(dirPath);
  const testcaseFiles = pairFlatDirTestcaseFiles(allFiles, dirPath);
  return processPairedFiles(client, problemId, testcaseFiles, (filePath: string) => fsPromises.readFile(filePath), log);
}

async function processPairedFiles<TSource>(
  client: PoolClient,
  problemId: string,
  pairedFiles: TestcasePairMap<TSource>,
  readFileFunc: (source: TSource) => Promise<Buffer>,
  log: string[],
): Promise<number> {
  const keys = Object.keys(pairedFiles).map(Number).sort((a, b) => a - b);
  const pairedCases = keys.filter(key => pairedFiles[key].in && pairedFiles[key].out);

  if (pairedCases.length === 0) {
    log.push(`No valid testcase pairs found.`);
    return 0;
  }

  let caseCounter = 1;
  for (const key of keys) {
    const pair = pairedFiles[key];
    if (pair && pair.in && pair.out) {
      const inputData = await readFileFunc(pair.in);
      const outputData = await readFileFunc(pair.out);

      await client.query(
        'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, $2, $3, $4)',
        [problemId, caseCounter, inputData.toString('utf-8'), outputData.toString('utf-8')]
      );
      caseCounter++;
    }
  }
  return caseCounter - 1;
}

/**
 * Read and validate config.json for one problem directory. Single- and
 * batch-problem ZIPs share this parser: both reach here via
 * processProblemDirectory.
 *
 * Per-problem error messages name the offending problem and field, e.g.
 * `Problem "tree-dp": Unknown category "Graphs". Allowed: ...` — never a
 * generic "invalid config.json".
 */
async function readProblemConfig(problemPath: string): Promise<ProblemZipConfig> {
  const configPath = path.join(problemPath, 'config.json');
  let raw: unknown;
  try {
    const configFile = await fsPromises.readFile(configPath, 'utf-8');
    raw = JSON.parse(configFile);
  } catch (e) {
    throw new Error(`Cannot read or parse config.json.`);
  }

  // Best-effort problem id for the error message: fall back to the directory
  // name when the id is missing or not a usable string.
  let problemIdForError = path.basename(problemPath);
  if (raw !== null && typeof raw === 'object' && 'id' in raw) {
    const id = (raw as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim() !== '') {
      problemIdForError = id.trim();
    }
  }

  const parsed = problemZipConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Problem "${problemIdForError}": ${formatProblemZipConfigError(parsed.error)}`);
  }
  return parsed.data;
}

/** Role subfolders of a header problem; never testcase directories. */
const HEADER_FILE_DIRS: readonly ProblemFileRole[] = ['grader', 'starter'];

/**
 * Read one flat role folder (`grader/` or `starter/`) of a problem directory.
 * A missing folder is an empty set; a nested folder is a per-problem error.
 */
async function readRoleDirectory(problemPath: string, role: ProblemFileRole): Promise<ProblemFileInput[]> {
  const dirPath = path.join(problemPath, role);
  let entries: fs.Dirent[];
  try {
    entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
  } catch (e) {
    const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: string }).code : undefined;
    if (code === 'ENOENT' || code === undefined) return [];
    throw e;
  }
  const files: ProblemFileInput[] = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    if (entry.isDirectory()) {
      throw new Error(`${role}/ must be flat: found folder "${entry.name}".`);
    }
    files.push({ filename: entry.name, content: await fsPromises.readFile(path.join(dirPath, entry.name)) });
  }
  return files.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
}

/**
 * Persist one problem directory inside a single transaction (per-problem
 * boundary: one problem failing rolls back only itself — a batch continues
 * with the other directories and reports this one as an error).
 *
 * Metadata semantics (categories / difficulty / collection):
 *  - New problem: an omitted field applies the same defaults as the admin
 *    create form (no categories, Unrated, no collection).
 *  - Existing problem: an omitted field preserves the stored value; an
 *    explicit null / [] clears it. The schema layer preserves field
 *    presence, so this distinction is decided here, not lost to parsing.
 *
 * The collection is resolved by name (reuse-or-create, race-free upsert) on
 * the same client, so a failing problem insert rolls the collection back too
 * — an import can never leave an orphaned collection behind.
 */
async function processProblemDirectory(problemPath: string): Promise<ProblemProcessResult> {
  const log: string[] = [];

  const config = await readProblemConfig(problemPath);

  const { id: problemId, title, author, time_limit_ms, memory_limit_mb } = config;

  const filesInProblemDir = await fsPromises.readdir(problemPath);

  return db.withTransaction(async (client) => {
    // Resolve the collection (if any) inside the same transaction as the
    // problem persist, so a later failure rolls back an auto-created
    // collection. A null/absent collection simply means no collection.
    let collectionId: number | null = null;
    if (config.collection !== undefined && config.collection !== null) {
      collectionId = await resolveCollectionIdByName(client, config.collection);
    }

    const isHeader = config.problem_type === 'header';
    const problemType = isHeader ? 'header' : 'standard';
    const submissionFilename = isHeader ? (config.submission_filename ?? DEFAULT_SUBMISSION_FILENAME) : null;

    const insertResult = await client.query(`
          INSERT INTO problems (id, title, author, time_limit_ms, memory_limit_mb, is_visible,
            categories, difficulty, collection_id, problem_type, submission_filename)
          VALUES ($1, $2, $3, $4, $5, false, $6::text[], $7, $8, $9, $10)
          ON CONFLICT (id) DO NOTHING;
      `, [problemId, title, author, time_limit_ms, memory_limit_mb,
        [...config.categories ?? []], config.difficulty ?? null, collectionId,
        problemType, submissionFilename]);

    if (insertResult.rowCount === 0) {
      // Existing problem: omitted metadata fields preserve the stored
      // values; explicit values (including null / []) replace them.
      const categoriesProvided = config.categories !== undefined;
      const difficultyProvided = config.difficulty !== undefined;
      const collectionProvided = config.collection !== undefined;
      await client.query(`
          UPDATE problems SET
            categories = CASE WHEN $2::boolean THEN $3::text[] ELSE categories END,
            difficulty = CASE WHEN $4::boolean THEN $5 ELSE difficulty END,
            collection_id = CASE WHEN $6::boolean THEN $7 ELSE collection_id END
          WHERE id = $1;
        `, [problemId, categoriesProvided, [...config.categories ?? []],
          difficultyProvided, config.difficulty ?? null,
          collectionProvided, collectionId]);
      return { status: UPLOAD_STATUS.SKIPPED, problemId };
    }

    // grader/ and starter/ are read only for a header problem. Next to any
    // other config (problem_type absent or misspelled, which the schema
    // strips) they would be dropped silently and the secret grader lost, so
    // the new problem fails instead.
    if (!isHeader) {
      const roleFolders = HEADER_FILE_DIRS.filter((role) => filesInProblemDir.includes(role));
      if (roleFolders.length > 0) {
        throw new Error(`Problem "${problemId}": ${roleFolders.map((role) => `${role}/`).join(' and ')} `
          + 'found, but config.json does not set "problem_type": "header".');
      }
    }

    const pdfFileName = filesInProblemDir.find(f => f.toLowerCase().endsWith('.pdf'));
    if (pdfFileName) {
      try {
        const pdfPath = path.join(problemPath, pdfFileName);
        const pdfBuffer = await fsPromises.readFile(pdfPath);
        // Validate the PDF magic bytes before persisting / later serving it.
        if (pdfBuffer.length < PDF_MAGIC.length || !pdfBuffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
          log.push(`Skipped ${pdfFileName}: not a valid PDF (missing %PDF header).`);
        } else {
          await client.query('UPDATE problems SET problem_pdf = $1 WHERE id = $2', [pdfBuffer, problemId]);
          log.push(`Uploaded ${pdfFileName}.`);
        }
      } catch (e) {
        log.push(`ERROR: Could not read PDF file ${pdfFileName}.`);
      }
    } else {
      log.push('No .pdf file found, skipping PDF upload.');
    }

    if (isHeader) {
      // Validation failure throws -> whole problem rolls back and is reported.
      for (const role of HEADER_FILE_DIRS) {
        const files = await readRoleDirectory(problemPath, role);
        if (role === 'grader' && files.length === 0) {
          // Same state admin create allows (and export writes): the problem
          // exists but is not submittable until a grader is uploaded. A
          // non-empty grader set must still include a .cpp.
          log.push('No grader files yet; the problem is not submittable until a grader is uploaded.');
          continue;
        }
        try {
          await replaceProblemFiles(client, problemId, role, files);
        } catch (e) {
          throw new Error(`Problem "${problemId}": ${getErrorMessage(e)}`);
        }
        log.push(`Stored ${files.length} ${role} file(s).`);
      }
    }

    await client.query('DELETE FROM testcases WHERE problem_id = $1', [problemId]);

    const zipFileName = filesInProblemDir.find(f => f.toLowerCase().endsWith('.zip'));
    let testcasesFound = false;

    if (zipFileName) {
      const zipPath = path.join(problemPath, zipFileName);
      try {
        const processedCount = await processTestcasesFromZip(client, problemId, zipPath, log);
        log.push(`Processed ${processedCount} test cases from ${zipFileName}.`);
        testcasesFound = true;
      } catch (e) {
        log.push(`ERROR: Failed to process zip file ${zipFileName}.`);
      }
    } else {
      const items = await fsPromises.readdir(problemPath, { withFileTypes: true });
      const subdirectories = items
        .filter(d => d.isDirectory() && !(HEADER_FILE_DIRS as readonly string[]).includes(d.name))
        .map(d => d.name);

      for (const dirName of subdirectories) {
        const testcaseRootPath = path.join(problemPath, dirName);
        const inputPath = path.join(testcaseRootPath, 'input');
        const outputPath = path.join(testcaseRootPath, 'output');

        try {
          const inputStats = await fsPromises.stat(inputPath);
          const outputStats = await fsPromises.stat(outputPath);

          if (inputStats.isDirectory() && outputStats.isDirectory()) {
            const processedCount = await processTestcasesFromInputOutputDirs(client, problemId, inputPath, outputPath, log);
            if (processedCount > 0) {
              log.push(`Processed ${processedCount} test cases from '${dirName}/input-output' subdirectories.`);
              testcasesFound = true;
            }
          }
        } catch (e) { }

        if (!testcasesFound) {
          try {
            const processedCount = await processTestcasesFromFlatDir(client, problemId, testcaseRootPath, log);
            if (processedCount > 0) {
              log.push(`Processed ${processedCount} flat test cases from '${dirName}/' directory.`);
              testcasesFound = true;
            }
          } catch (flatDirError) { }
        }

        if (testcasesFound) break;
      }
    }

    if (!testcasesFound) {
      log.push('No .zip file or valid testcase directory found.');
    }

    return { status: UPLOAD_STATUS.ADDED, problemId, log };
  });
}

/**
 * A2-03: batch uploads being processed right now. Each one runs after its
 * request has been answered 202, one transaction per problem, so the
 * database import cannot rely on the maintenance gate to keep it out.
 */
let runningBatchUploads = 0;

/** A2-03: whether a batch upload may still write problems; a database import refuses to start while one does. */
export const isBatchUploadRunning = (): boolean => runningBatchUploads > 0;

export async function processBatchUpload(
  zipFilePath: string,
  onProgress?: (progress: BatchUploadProgressData) => void,
): Promise<BatchUploadResult> {
  const results: BatchUploadResult = { added: [], skipped: [], errors: [] };
  let tempDir: string | undefined;
  runningBatchUploads += 1;

  try {
    const directory = await unzipper.Open.file(zipFilePath);

    // Validate entries (zip-slip / zip-bomb) before extracting to disk.
    assertSafeArchive(directory.files as unknown as ArchiveEntryLike[]);

    // Graders and hidden testcases: extract only into a private 0700
    // directory, never a predictable /tmp path judged programs can read.
    tempDir = await privateTempDir('batch-');
    await extractArchiveBounded(directory.files, tempDir);

    const junkDirs = new Set(['__MACOSX', '.vscode']);
    const topLevelItems = await fsPromises.readdir(tempDir, { withFileTypes: true });
    let problemSourceDir = tempDir;

    const significantTopLevelItems = topLevelItems.filter(item => !junkDirs.has(item.name));

    if (significantTopLevelItems.length === 1 && significantTopLevelItems[0].isDirectory()) {
      problemSourceDir = path.join(tempDir, significantTopLevelItems[0].name);
    }

    const itemsInSource = await fsPromises.readdir(problemSourceDir);
    const problemPathsToProcess: string[] = [];

    if (itemsInSource.includes('config.json')) {
      problemPathsToProcess.push(problemSourceDir);
    } else {
      const dirents = await fsPromises.readdir(problemSourceDir, { withFileTypes: true });
      for (const dirent of dirents) {
        if (dirent.isDirectory() && !junkDirs.has(dirent.name)) {
          problemPathsToProcess.push(path.join(problemSourceDir, dirent.name));
        }
      }
    }

    let processedCount = 0;
    const totalProblems = problemPathsToProcess.length;

    for (const [index, problemPath] of problemPathsToProcess.entries()) {
      // A2-03: an import is dropping and restoring the database (this batch
      // reached its first problem after the import began). Write nothing more.
      if (isMaintenanceActive()) {
        const notProcessed = totalProblems - index;
        results.errors.push({
          directory: 'Batch Process',
          message: `Stopped because a database import started: ${notProcessed} of ${totalProblems} problems were not processed. Upload them again after the import has finished.`,
        });
        break;
      }
      try {
        const result = await processProblemDirectory(problemPath);
        if (result.status === UPLOAD_STATUS.ADDED) {
          results.added.push(result.problemId);
        } else if (result.status === UPLOAD_STATUS.SKIPPED) {
          results.skipped.push(result.problemId);
        }
      } catch (error: unknown) {
        results.errors.push({ directory: path.basename(problemPath), message: getErrorMessage(error) });
      } finally {
        processedCount++;
        if (onProgress) {
          const progressPayload: BatchUploadProgressData = {
            processed: processedCount,
            total: totalProblems,
            status: 'processing',
            currentProblem: path.basename(problemPath),
            message: `Processing ${path.basename(problemPath)} (${processedCount}/${totalProblems})`,
          };
          onProgress(progressPayload);
        }
      }
    }
  } catch (error: unknown) {
    console.error('An unexpected error occurred during the batch upload process:', error);
    results.errors.push({ directory: 'Batch Process', message: getErrorMessage(error) || 'A critical error occurred.' });
  } finally {
    // Only temporary files are touched from here on.
    runningBatchUploads -= 1;
    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
    if (tempDir) {
      await delay(FILE_CONFIG.CLEANUP_DELAY_MS);
      await removePrivateTemp(tempDir);
    }

    try {
      await fsPromises.unlink(zipFilePath);
    } catch (unlinkError: unknown) {
      const errorCode = typeof unlinkError === 'object' && unlinkError !== null && 'code' in unlinkError
        ? (unlinkError as { code?: string }).code
        : undefined;
      if (errorCode !== 'ENOENT') {
        console.warn('Failed to delete uploaded zip file:', unlinkError);
      }
    }
  }

  return results;
}
