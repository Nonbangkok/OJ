import * as db from '../db';
import { AUTHORING_RUNNER, jobSnapshotSchema } from '../authoring/protocol';
import { AuthoringSpool } from '../authoring/spool';
import { TestcaseError } from '../authoring/testcases';
import { ACTIVE_JOB_STATUSES, AUTHORING_COORDINATOR_LOCK, applyJobResult, DurableJob, failAuthoringJob, getAuthoringJob, JobDatabase, readQueuedInput, readQueuedFile, setJobActivityListener } from './authoringJobQueryService';
import { reconcileProfileSyncs } from './authoringProfileSyncService';

/** Reconciles durable queue entries with disk, including both crash windows around result import. */
export async function reconcileAuthoringJobs(spool: AuthoringSpool, database: JobDatabase = db, now = Date.now()): Promise<void> {
  const lock = await database.pool.connect();
  let locked = false;
  try {
    locked = (await lock.query('SELECT pg_try_advisory_lock($1) AS locked', [AUTHORING_COORDINATOR_LOCK])).rows[0].locked;
    if (!locked) return;
    const jobs = await database.query<Pick<DurableJob, 'id'>>('SELECT id FROM authoring_jobs WHERE status=ANY($1::text[]) ORDER BY created_at, id', [ACTIVE_JOB_STATUSES]);
    for (const { id } of jobs.rows) {
      // Load one source snapshot at a time, not the entire queue into backend memory.
      const job = await getAuthoringJob(id, database);
      if (!job || !ACTIVE_JOB_STATUSES.includes(job.status)) continue;
      let result;
      try { result = await spool.readResult(job.id); }
      catch (error) {
        // Filesystem outages are retryable; corrupt/schema-invalid results are terminal.
        if ((error as NodeJS.ErrnoException).code && !['ELOOP'].includes((error as NodeJS.ErrnoException).code!)) throw error;
        await failAuthoringJob(job.id, 'invalid_runner_result', false, database);
        continue;
      }
      if (result) {
        if (result.jobId !== job.id || result.draftId !== job.draft_id || result.revision !== job.draft_revision) {
          await failAuthoringJob(job.id, 'result_identity_mismatch', false, database);
        } else {
          try { await applyJobResult(job.id, result, database, (index, artifact) => job.job_type === 'generate_outputs'
            ? spool.readOutput(job.id, index, artifact) : spool.readInput(job.id, index, artifact), artifact => spool.readPdf(job.id, artifact)); }
          catch (error) {
            if (!(error instanceof TestcaseError)) throw error;
            await failAuthoringJob(job.id, error.code, false, database);
          }
        }
        continue;
      }
      const snapshot = jobSnapshotSchema.safeParse(job.request_snapshot);
      if (!snapshot.success) { await failAuthoringJob(job.id, 'missing_snapshot', false, database); continue; }
      if (Date.parse(snapshot.data.deadline) <= now) {
        await failAuthoringJob(job.id, 'job_expired', true, database);
      } else if (await spool.isActive(job.id)) {
        await database.query("UPDATE authoring_jobs SET status='compiling', started_at=COALESCE(started_at,NOW()) WHERE id=$1 AND status='queued'", [job.id]);
      } else {
        try { await spool.deliver(snapshot.data, (_index, artifact) => readQueuedInput(job.id, artifact.caseId, database),
          name => readQueuedFile(job.id, name, database)); }
        catch (error) {
          if (!(error instanceof TestcaseError)) throw error;
          await failAuthoringJob(job.id, job.job_type === 'build_pdf' ? 'invalid_pdf_inputs' : 'invalid_job_inputs', false, database);
        }
      }
    }
    // A crash after DB commit but before file cleanup is harmless and recovered here.
    for (const id of await spool.jobIds()) {
      const job = await getAuthoringJob(id, database);
      if (!job || !ACTIVE_JOB_STATUSES.includes(job.status)) await spool.cleanup(id);
    }
    await spool.cleanupStaging(now);
    // Run after result import so items that just became terminal finalize their
    // sync run in the same tick.
    await reconcileProfileSyncs(database, now);
  } finally {
    try {
      if (locked) await lock.query('SELECT pg_advisory_unlock($1)', [AUTHORING_COORDINATOR_LOCK]);
    } catch (error) {
      // Destroy an uncertain session instead of leaking it or returning its lock to the pool.
      lock.release(true);
      throw error;
    }
    lock.release();
  }
}

/** Starts a non-overlapping polling loop; the next tick retries transient DB/disk failures.
 *  `kick()` runs a reconciliation immediately — called when a job is enqueued so
 *  delivery to the runner doesn't wait for the next poll tick. */
export async function startAuthoringCoordinator(root: string): Promise<() => void> {
  const spool = new AuthoringSpool(root);
  await spool.initialize();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let kicked = false;
  const tick = async () => {
    if (running) { kicked = true; return; } // a kick during a running tick reruns after it
    running = true;
    try { await reconcileAuthoringJobs(spool); }
    catch { console.error('Authoring job reconciliation failed; will retry'); }
    finally { running = false; }
    if (stopped) return;
    if (kicked) { kicked = false; timer = setTimeout(tick, 0); }
    else timer = setTimeout(tick, AUTHORING_RUNNER.POLL_MS);
    timer.unref();
  };
  const kick = () => {
    if (stopped) return;
    if (running) { kicked = true; return; }
    clearTimeout(timer);
    timer = setTimeout(tick, 0);
    timer.unref();
  };
  await tick();
  // Job writes (enqueue, result import) call this so delivery and follow-up
  // reconciliation start immediately instead of on the next poll tick.
  setJobActivityListener(kick);
  return () => { stopped = true; clearTimeout(timer); setJobActivityListener(undefined); };
}
