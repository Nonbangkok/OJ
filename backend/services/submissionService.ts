import * as db from '../db';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { judge } from './judgeService';
import { ContestSubmissionRow, SubmissionRow } from '../types/models';
import { CompileCommandError } from '../types/service';
import {
  DEFAULT_SUBMISSION_FILENAME,
  HEADER_CPP_PREPARE,
  JUDGE_CONFIG,
  LANGUAGE_PREPARE,
  RunnableCommand,
  SUBMISSION_QUERY_CONFIG,
  SUBMISSION_STATUS,
  SubmissionLanguage,
} from '../constants';
import { findForbiddenAsm, findForbiddenInclude } from '../utils/compileGuard';
import { logger } from '../utils/logger';
import { publishRealtime } from './realtimeHub';
import { awardSolveReward } from './progressionService';
import { enqueueTrackedJudgeTask } from './judgeQueue';
import { getHeaderJudgeSpec } from './problemFilesService';
import {
  canDropPrivileges,
  chmodSandboxPath,
  createSandboxWorkspace,
  nextSandboxIdentity,
  prlimitWrap,
  removeSandboxFiles,
  removeSandboxWorkspace,
  runBoundedChildProcess,
  SandboxIdentity,
  writeSandboxFile,
} from '../utils/sandboxProcess';

/**
 * Compile (or syntax-check) a submission as an unprivileged uid under prlimit
 * caps (JUDGE_CONFIG.COMPILE_TIMEOUT_MS wall clock, COMPILE_MAX_BUFFER output
 * cap, and the prlimit address-space/process/file-size limits from
 * `prlimitWrap`), never through a shell, and with a whole-process-group
 * SIGKILL on any limit. A runaway g++ therefore cannot hang the judge worker
 * or flood memory, and a timeout surfaces as a normal compile failure.
 *
 * `env` is stripped to a minimal PATH so a malicious source cannot exfiltrate
 * the backend's secrets at COMPILE time either — g++ never inherits
 * DATABASE_URL / PGPASSWORD / SECRET_KEY, so it cannot quote them back in a
 * Compilation Error diagnostic even via `#include "/proc/self/environ"`.
 * (RUNNER-001 / RUNNER-005; the run step is env-stripped too.)
 *
 * `command` / `args` reference the source and output by paths RELATIVE to
 * `cwd` (the per-submission build directory) so diagnostics carry no server
 * directories at all.
 */
async function runBoundedCompile(
  cwd: string,
  command: string,
  args: readonly string[],
  sandbox: SandboxIdentity
): Promise<{ ok: boolean; stderr: string }> {
  const sandboxEnv = {
    PATH: JUDGE_CONFIG.SANDBOX_PATH,
    LANG: 'C.UTF-8',
    TMPDIR: cwd,
  } as unknown as NodeJS.ProcessEnv;
  const result = await runBoundedChildProcess(command, args, {
    cwd,
    env: sandboxEnv,
    ...(canDropPrivileges() ? { uid: sandbox.uid, gid: sandbox.gid } : {}),
    timeoutMs: JUDGE_CONFIG.COMPILE_TIMEOUT_MS,
    maxBufferBytes: JUDGE_CONFIG.COMPILE_MAX_BUFFER,
  });
  return { ok: result.exitCode === 0, stderr: result.stderr || result.stdout };
}

/** The neutral name substituted for the internal temp source path in
 *  compiler/checker output so server filesystem paths are not disclosed. */
const SANITIZED_SOURCE_NAME: Record<SubmissionLanguage, string> = {
  cpp: 'solution.cpp',
  python: 'solution.py',
};

export interface SanitizeStderrOptions {
  /**
   * Keep the submitted file's own name in the output instead of rewriting it
   * to the neutral `solution.cpp`. Header problems set this: the student
   * submits a NAMED file (`student.h`) that the grader includes, so a
   * diagnostic has to keep pointing at it to be of any use — and the grader's
   * file names are an accepted disclosure (their CONTENTS stay hidden:
   * `-fno-diagnostics-show-caret` keeps g++ from echoing source lines).
   */
  keepSourceName?: boolean;
}

/**
 * Replace the internal temporary source path in compiler/checker output with a
 * neutral name so server filesystem paths are not disclosed to submitters.
 * Both the bare source filename and its per-submission directory form are
 * neutralized (compiles run with cwd = the submission directory, so g++
 * diagnostics can print either).
 *
 * Absolute workspace paths that slipped through include resolution are
 * stripped either way (defence in depth): to the neutral name normally, to
 * the plain basename when the real file name is kept.
 */
export function sanitizeCompilerStderr(
  stderr: string | undefined,
  sourcePath: string,
  language: SubmissionLanguage = 'cpp',
  options: SanitizeStderrOptions = {}
): string {
  if (!stderr) {
    return 'Compilation failed';
  }
  const neutralName = SANITIZED_SOURCE_NAME[language];
  const renamed = sourcePath && !options.keepSourceName
    ? stderr
        .split(sourcePath)
        .join(neutralName)
        .split(path.join(path.dirname(sourcePath), neutralName))
        .join(neutralName)
    : stderr;
  return renamed.replace(
    /\/[^\s:]*oj-submissions\/[^\s:]+/g,
    (match) => (options.keepSourceName ? path.basename(match) : neutralName)
  );
}

const FORBIDDEN_INCLUDE_MESSAGE = (target: string): string =>
  `Compilation rejected: #include of a non-permitted path ("${target}") is not allowed. ` +
  `Use standard library headers (e.g. <bits/stdc++.h>) only.`;

const FORBIDDEN_ASM_MESSAGE = (target: string): string =>
  `Compilation rejected: inline assembly ("${target}") is not allowed in this problem.`;

const HEADER_CPP_ONLY_MESSAGE = 'This problem accepts C++ only.';

/**
 * Pre-compile source guard. The `#include` check protects every submission
 * (compile-time arbitrary file read, RUNNER-001). The inline-assembly check
 * is header-only: `asm(".incbin \"main.cpp\"")` would bake the grader's
 * secret bytes into the binary, a vector that only exists when secret files
 * share the translation unit. Returns the submitter-facing message, or null.
 */
function findSourceRejection(code: string, isHeader: boolean): string | null {
  const forbiddenInclude = findForbiddenInclude(code);
  if (forbiddenInclude) {
    return FORBIDDEN_INCLUDE_MESSAGE(forbiddenInclude);
  }
  if (isHeader) {
    const forbiddenAsm = findForbiddenAsm(code);
    if (forbiddenAsm) {
      return FORBIDDEN_ASM_MESSAGE(forbiddenAsm);
    }
  }
  return null;
}

/** Name of the binary produced inside a submission's workspace. */
const BINARY_NAME = 'solution.out';

type HeaderJudgeSpec = NonNullable<Awaited<ReturnType<typeof getHeaderJudgeSpec>>>;

/**
 * Everything that differs between a standard and a header submission, decided
 * ONCE before the workspace exists: which files go into it, how they are
 * compiled, what is scrubbed afterwards, and what the judge runs. The rest of
 * the pipeline stays a single straight-line flow over this plan.
 */
interface PreparePlan {
  /** Files written into the workspace, in order (name + utf-8 content). */
  files: ReadonlyArray<{ name: string; content: string }>;
  /** The submitted source's name inside the workspace. */
  sourceName: string;
  /** Artifact the prepare step produces, or null for interpreted languages. */
  artifactName: string | null;
  /** Compile / syntax-check invocation, with workspace-relative paths. */
  check: RunnableCommand;
  /**
   * Files removed from the workspace after a SUCCESSFUL prepare, before the
   * binary runs: empty for standard problems, every grader source plus the
   * submitted header for header problems.
   */
  scrub: readonly string[];
  /** Keep the submitted file's real name in compile diagnostics. */
  keepSourceName: boolean;
  /** The judge's runnable, built from the artifact (or source) path. */
  runCommand: (targetPath: string) => RunnableCommand;
}

/** The unchanged single-source flow: one file, one compile, nothing scrubbed. */
function standardPreparePlan(language: SubmissionLanguage, code: string): PreparePlan {
  const prepare = LANGUAGE_PREPARE[language];
  const sourceName = `solution${prepare.sourceExtension}`;
  return {
    files: [{ name: sourceName, content: code }],
    sourceName,
    artifactName: prepare.compiledArtifactPath(BINARY_NAME),
    check: prepare.checkCommand(sourceName, BINARY_NAME),
    scrub: [],
    keepSourceName: false,
    runCommand: prepare.runCommand,
  };
}

/**
 * Header problems: the grader files and the submitted header live side by side
 * in the workspace and compile as ONE translation unit (only the grader's
 * `.cpp` names are passed to g++ — headers arrive through `#include`).
 * Everything that was a source is then scrubbed, so the student's binary can
 * never read the grader's secret main.
 */
function headerPreparePlan(code: string, spec: HeaderJudgeSpec): PreparePlan {
  const sourceName = spec.submissionFilename ?? DEFAULT_SUBMISSION_FILENAME;
  const graderNames = spec.graderFiles.map((file) => file.filename);
  const cppSources = graderNames.filter((name) => name.toLowerCase().endsWith('.cpp')).sort();
  if (cppSources.length === 0) {
    // Authoring validation guarantees at least one grader .cpp; a problem that
    // lost its grader files must fail loudly (System Error), never judge as if
    // the submission were at fault.
    throw new Error('header problem has no grader .cpp source to compile');
  }
  return {
    files: [
      ...spec.graderFiles.map((file) => ({ name: file.filename, content: file.content.toString('utf-8') })),
      { name: sourceName, content: code },
    ],
    sourceName,
    artifactName: BINARY_NAME,
    check: HEADER_CPP_PREPARE.checkCommand(cppSources, BINARY_NAME),
    scrub: [...graderNames, sourceName],
    keepSourceName: true,
    runCommand: HEADER_CPP_PREPARE.runCommand,
  };
}

/**
 * Publish a realtime `submission_update` after a status/score transition has
 * been persisted. Kept tiny and side-effect free so every emission point in
 * the pipeline is one readable line; publishRealtime itself never throws.
 * `xpAwarded` is only set on the final Accepted transition when a NEW
 * first-solve reward was created — it drives the submitter's "+N XP" toast.
 */
const publishSubmissionStatus = (
  submissionId: number,
  table: 'submissions' | 'contest_submissions',
  userId: number | null,
  overallStatus: string,
  score: number,
  xpAwarded?: number
): void => {
  publishRealtime({
    type: 'submission_update',
    submissionId,
    table,
    overall_status: overallStatus,
    score,
    user_id: userId,
    ...(xpAwarded !== undefined && xpAwarded > 0 ? { xp_awarded: xpAwarded } : {}),
  });
};

/** Persist a terminal Compilation Error with its submitter-facing output. */
async function recordCompilationError(
  table: 'submissions' | 'contest_submissions',
  submissionId: number,
  userId: number | null,
  output: string
): Promise<void> {
  await db.query(
    `UPDATE ${table} SET overall_status = '${SUBMISSION_STATUS.COMPILATION_ERROR}', results = $1 WHERE id = $2`,
    [JSON.stringify([{ status: SUBMISSION_STATUS.COMPILATION_ERROR, output }]), submissionId]
  );
  publishSubmissionStatus(submissionId, table, userId, SUBMISSION_STATUS.COMPILATION_ERROR, 0);
}

/**
 * Compile a submission's source and run it against the problem's testcases,
 * persisting each status transition. Shared by the standalone
 * (`submissions`) and contest (`contest_submissions`) pipelines — the only
 * differences are the table and the temp-file prefix.
 */
async function runSubmissionPipeline(
  submissionId: number,
  table: 'submissions' | 'contest_submissions',
  filePrefix: string
): Promise<void> {
  // Absolute path of the per-submission workspace directory; cleaned in the
  // finally block (RUNNER-003).
  let workspaceDir = '';
  // Owner of the submission — needed by the System Error handler below, so it
  // must live outside the try block alongside the file paths.
  let userId: number | null = null;
  // Language also escapes the try: the finally-block cleanup needs to know
  // whether this submission produced a compiled binary at all.
  let submissionLanguage: SubmissionLanguage = 'cpp';
  // Whether this pipeline run took the by-construction sandbox path (uid-dropped
  // workspace operations). The finally-block cleanup needs it: a uid-owned
  // workspace can only be removed as its owner in the lockdown container.
  // `cleanupIdentity` holds the sandbox identity even if the pipeline threw
  // after drawing it from the pool (defaults to the dev path until then).
  let privileged = false;
  let cleanupIdentity: SandboxIdentity | null = null;

  try {
    const subRes = await db.query<SubmissionRow | ContestSubmissionRow>(
      `SELECT * FROM ${table} WHERE id = $1`,
      [submissionId]
    );
    if (subRes.rows.length === 0) {
      logger.warn('submission not found for processing', { submissionId, table });
      return;
    }
    const { problem_id, code, language, user_id, contest_id } = subRes.rows[0] as
      Pick<SubmissionRow, 'problem_id' | 'code' | 'language' | 'user_id'> & { contest_id?: number };
    userId = user_id;
    submissionLanguage = (language as SubmissionLanguage) ?? 'cpp';

    await db.query(
      `UPDATE ${table} SET overall_status = '${SUBMISSION_STATUS.COMPILING}' WHERE id = $1`,
      [submissionId]
    );
    publishSubmissionStatus(submissionId, table, user_id, SUBMISSION_STATUS.COMPILING, 0);

    // Header problems (`problem_type = 'header'`) are judged from the
    // problem's SECRET grader files plus the submitted header. The spec is
    // read once here and decides the whole prepare plan below; a standard
    // problem (or a problem row that vanished) takes the unchanged path.
    const headerSpec = await getHeaderJudgeSpec(problem_id);
    const isHeader = headerSpec?.problemType === 'header';

    // Header problems are C++ only: there is no way to compile a Python
    // submission into the grader's translation unit.
    if (isHeader && submissionLanguage !== 'cpp') {
      await recordCompilationError(table, submissionId, user_id, HEADER_CPP_ONLY_MESSAGE);
      return;
    }

    // Reject sources that try to read files outside the submission via
    // #include (and, for header problems, assembler-level file embedding)
    // BEFORE anything is written or compiled — a first line of defence
    // against the compile-time arbitrary file-read vector (the compile also
    // runs unprivileged, see runBoundedCompile).
    const sourceRejection = findSourceRejection(code, isHeader);
    if (sourceRejection) {
      await recordCompilationError(table, submissionId, user_id, sourceRejection);
      return;
    }

    const plan = isHeader
      ? headerPreparePlan(code, headerSpec as HeaderJudgeSpec)
      : standardPreparePlan(submissionLanguage, code);
    const uniqueId = `${filePrefix}_${submissionId}_${Date.now()}`;

    // Per-submission sandbox identity (RUNNER-006): the compile and every
    // testcase run of THIS submission share one pool uid+gid, distinct from
    // any concurrently judged submission's. RLIMIT_NPROC is per-uid, so
    // forking budgets stay independent, and file ownership gives the
    // workspace its privacy below.
    const sandbox = nextSandboxIdentity();
    cleanupIdentity = sandbox;

    // Per-submission workspace (RUNNER-003): every submission gets a private
    // directory under os.tmpdir(), owned by its sandbox identity with mode
    // 0711 — owner rwx, everyone else traverse-only (x) with NO list (r).
    // The sandboxed program can reach its own files by name but cannot
    // readdir a rival submission's workspace; files inside are 0600/0750
    // owner-only, so even known names cannot be read.
    //
    // Hotfix 2026-09 (by-construction ownership): in the lockdown container
    // root has NO CAP_CHOWN/FOWNER/DAC_OVERRIDE, so the old root-creates-
    // then-chowns flow silently left the workspace root-owned and every
    // compile died with "Permission denied". When privileges CAN be dropped
    // (production), the workspace is created and every file in it is written
    // by uid-dropped children — the sandbox identity owns it BY CONSTRUCTION
    // and `chown` is never called. The dev path (no uid drop available)
    // keeps the plain mkdtemp/write flow.
    const privilegedRun = canDropPrivileges();
    privileged = privilegedRun;
    if (privilegedRun) {
      workspaceDir = await createSandboxWorkspace(`${uniqueId}_`, { sandbox, context: uniqueId });
    } else {
      const submissionsRoot = path.join(fs.realpathSync(os.tmpdir()), 'oj-submissions');
      await fs.promises.mkdir(submissionsRoot, { recursive: true, mode: 0o755 });
      workspaceDir = await fs.promises.mkdtemp(path.join(submissionsRoot, `${uniqueId}_`));
      await fs.promises.chmod(workspaceDir, 0o711);
    }

    const sourcePath = path.join(workspaceDir, plan.sourceName);
    const artifactPath = plan.artifactName ? path.join(workspaceDir, plan.artifactName) : null;

    // Every planned file is owned by the submission's sandbox identity with
    // mode 0600: readable by the sandboxed compile/run of THIS submission
    // only — another submission's uid cannot read it even by name, and the
    // traverse-only workspace keeps it out of any directory listing.
    // In the by-construction path the uid-dropped `dd` write makes each file
    // identity-owned from creation (no chown — root cannot chown in the
    // lockdown container; see sandboxProcess.ts). For a header problem this
    // is also where the grader's secret files land; they are scrubbed again
    // the moment the compile succeeds (below).
    for (const file of plan.files) {
      if (privileged) {
        await writeSandboxFile(workspaceDir, file.name, file.content, { sandbox, context: uniqueId });
      } else {
        await fs.promises.writeFile(path.join(workspaceDir, file.name), file.content, { mode: 0o600 });
      }
    }

    // Language-agnostic "prepare" phase: compile (C++) or syntax-check
    // (Python via py_compile), as the submission's sandbox identity under
    // prlimit caps and a hard wall-clock/output kill (RUNNER-001 / RUNNER-005).
    // A failure maps to Compilation Error with the sanitized stderr shown to
    // the submitter. Paths are relative to the workspace so diagnostics carry
    // no server directories at all.
    const compileCommand = prlimitWrap(plan.check.command, plan.check.args);
    const compile = await runBoundedCompile(workspaceDir, compileCommand.command, compileCommand.args, sandbox);
    if (!compile.ok) {
      logger.warn('submission compile failed', { submissionId, table, language: submissionLanguage, stderr: compile.stderr });
      await recordCompilationError(
        table,
        submissionId,
        user_id,
        sanitizeCompilerStderr(compile.stderr, plan.sourceName, submissionLanguage, {
          keepSourceName: plan.keepSourceName,
        })
      );
      return;
    }

    await db.query(
      `UPDATE ${table} SET overall_status = '${SUBMISSION_STATUS.RUNNING}' WHERE id = $1`,
      [submissionId]
    );
    publishSubmissionStatus(submissionId, table, user_id, SUBMISSION_STATUS.RUNNING, 0);

    // HEADER PROBLEMS — scrub before anything runs. The binary was linked
    // against the problem's secret grader sources, which are still sitting in
    // the workspace the program is about to run with (same uid, same
    // directory): without this removal the student's code could simply
    // fopen() main.cpp and print the solution it was graded against. The
    // submitted header goes too — it is no longer needed and keeps the
    // workspace free of ANY source. A failed scrub must never fall through to
    // the run, so removeSandboxFiles throws and the submission becomes a
    // System Error (see utils/sandboxProcess.ts).
    if (plan.scrub.length > 0) {
      if (privileged) {
        await removeSandboxFiles(workspaceDir, plan.scrub, { sandbox, context: uniqueId });
      } else {
        for (const fileName of plan.scrub) {
          await fs.promises.rm(path.join(workspaceDir, fileName), { force: true });
        }
      }
    }

    // Compiled languages run the produced artifact; interpreted languages run
    // the source through their interpreter. The judge applies per-language
    // limit multipliers from here on. g++ wrote the binary as the sandbox
    // identity already; 0750 keeps it owner+group only (the group IS the same
    // identity — one uid per submission — so this is effectively owner-only).
    if (artifactPath) {
      // The artifact is owned by the sandbox identity (g++ wrote it as that
      // uid, or the dev-path compile produced it as this user). Root cannot
      // chmod uid-owned files in the lockdown container (no CAP_FOWNER), so
      // the mode tightening runs as the owner.
      if (privileged) {
        await chmodSandboxPath(artifactPath, '750', { sandbox, context: uniqueId });
      } else {
        await fs.promises.chmod(artifactPath, 0o750);
      }
    }
    const judgeResult = await judge(
      problem_id,
      plan.runCommand(artifactPath ?? sourcePath),
      submissionLanguage,
      sandbox
    );

    const { results, score, overallStatus, maxTimeMs, maxMemoryKb } = judgeResult;
    // Conditional final write (JUDGE-004): the verdict only lands while the
    // row is still in a non-terminal state this pipeline put it in. A stale
    // run (e.g. a judge that outlived a rejudge's fresh verdict, or a
    // contest_submissions row already migrated/deleted at contest end) must
    // not overwrite a newer terminal verdict — rowCount 0 means step aside.
    const finalUpdate = await db.query(
      `UPDATE ${table}
       SET overall_status = $1, score = $2, results = $3, max_time_ms = $4, max_memory_kb = $5
       WHERE id = $6 AND overall_status IN ('${SUBMISSION_STATUS.PENDING}', '${SUBMISSION_STATUS.COMPILING}', '${SUBMISSION_STATUS.RUNNING}')`,
      [overallStatus, score, JSON.stringify(results), maxTimeMs, maxMemoryKb, submissionId]
    );
    if ((finalUpdate.rowCount ?? 0) === 0) {
      logger.warn('stale judge result discarded — row is no longer in a judgeable state', {
        submissionId, table, overallStatus,
      });
      return;
    }

    // First Accepted solve earns XP exactly once — awardSolveReward is
    // idempotent (unique constraint on user_problem_rewards), so rejudges
    // and repeated Accepted submissions award nothing extra. Failures here
    // must never fail the pipeline: the reward is progression metadata,
    // not part of the verdict. Runs BEFORE the final publish so a newly
    // created reward can ride on the Accepted event (xp_awarded) and the
    // submitter's client shows the "+N XP" toast exactly once.
    let xpAwarded: number | undefined;
    if (
      overallStatus === SUBMISSION_STATUS.ACCEPTED
      && user_id != null
      && score >= SUBMISSION_QUERY_CONFIG.FULL_PROBLEM_SCORE
    ) {
      try {
        const xp = await awardSolveReward(user_id, problem_id);
        if (xp > 0) {
          xpAwarded = xp;
          logger.info('xp reward granted', { userId: user_id, problemId: problem_id, xp });
        }
      } catch (xpError) {
        logger.error('failed to award xp reward', { submissionId, problemId: problem_id, err: xpError });
      }
    }

    publishSubmissionStatus(submissionId, table, user_id, overallStatus, score, xpAwarded);
    // A landed contest verdict can move the scoreboard: emit a ping so
    // connected clients refetch the authoritative payload. Chatty-free by
    // design — intermediate statuses don't ping, only final verdicts.
    if (table === 'contest_submissions' && contest_id != null) {
      publishRealtime({ type: 'scoreboard_update', contestId: contest_id });
    }

  } catch (error) {
    logger.error('submission pipeline failed', { submissionId, table, err: error });
    try {
      await db.query(
        `UPDATE ${table} SET overall_status = '${SUBMISSION_STATUS.SYSTEM_ERROR}' WHERE id = $1`,
        [submissionId]
      );
      publishSubmissionStatus(submissionId, table, userId, SUBMISSION_STATUS.SYSTEM_ERROR, 0);
    } catch (dbError) {
      logger.error('failed to record system-error status', { submissionId, table, err: dbError });
    }
  } finally {
    // Remove the whole per-submission workspace (source, binary, compiler
    // scratch). One recursive rmtree replaces the per-file unlinks. In the
    // by-construction path the workspace is uid-owned and root cannot remove
    // it (no CAP_DAC_OVERRIDE in the lockdown container) — the cleanup runs
    // as the owner. Never fatal (mirrors the old fire-and-forget fs.rm).
    if (workspaceDir) {
      if (privileged) {
        await removeSandboxWorkspace(workspaceDir, { sandbox: cleanupIdentity!, context: `submission ${submissionId}` });
      } else {
        fs.rm(workspaceDir, { recursive: true, force: true }, (err) => {
          if (err) logger.warn('failed to delete submission workspace', { submissionId, err });
        });
      }
    }
  }
}

export async function processSubmission(submissionId: number): Promise<void> {
  await runSubmissionPipeline(submissionId, 'submissions', 'sub');
}

// Process contest submissions (same pipeline, different table)
export async function processContestSubmission(submissionId: number): Promise<void> {
  await runSubmissionPipeline(submissionId, 'contest_submissions', 'contest');
}

/**
 * JUDGE-003 / DB-13: boot sweep for submissions orphaned by a restart.
 *
 * The judge queue is in-memory, so a backend restart abandons every
 * submission stuck in a non-terminal state (Pending/Compiling/Running) in
 * BOTH pools — without this sweep they poll as "processing" forever.
 *
 * Policy (documented design choice):
 *  - `Pending` rows never started judging (the queue died before their task
 *    ran), so they are re-enqueued through the normal pipeline — best UX,
 *    and safe because nothing was ever written for them beyond the INSERT.
 *  - `Compiling`/`Running` rows were mid-flight: their per-submission
 *    workspaces (source + binary) were process-local and are gone after the
 *    restart, so the pipeline cannot resume them. Re-running from the stored
 *    code would be possible but would silently DOUBLE judge work and race
 *    any lingering state; instead they are marked System Error with an
 *    explicit "interrupted by server restart" result so the submitter knows
 *    to resubmit. (A `judge_epoch` column would allow faithful re-enqueue;
 *    deferred — see the Phase 2 report.)
 *
 * The contest pool's rows additionally carry a `contest_id`, so re-enqueued
 * Pending rows stay tracked per-contest for the migration drain (JUDGE-005).
 * Must run AFTER migrations and BEFORE the app starts accepting traffic;
 * idempotent (terminal rows never match).
 */
export async function sweepOrphanedSubmissions(): Promise<{
  requeued: number;
  systemErrored: number;
}> {
  let requeued = 0;
  let systemErrored = 0;

  const pools = [
    { table: 'submissions' as const, process: processSubmission },
    { table: 'contest_submissions' as const, process: processContestSubmission },
  ];

  for (const { table, process } of pools) {
    // Pending rows: re-enqueue (they never started). A plain SELECT —
    // resetting them to their current status would be a no-op write.
    const pendingRes = await db.query<{ id: number; contest_id: number | null }>(
      `SELECT id${table === 'contest_submissions' ? ', contest_id' : ', NULL::integer AS contest_id'}
       FROM ${table}
       WHERE overall_status = '${SUBMISSION_STATUS.PENDING}'`,
      []
    );
    for (const row of pendingRes.rows) {
      enqueueTrackedJudgeTask(
        () => process(row.id),
        { table, submissionId: row.id },
        table === 'contest_submissions' ? row.contest_id ?? undefined : undefined
      );
      requeued += 1;
    }

    // Compiling/Running rows: the pipeline cannot resume them — terminal
    // System Error with an explicit interruption message.
    const stuckRes = await db.query(
      `UPDATE ${table}
       SET overall_status = '${SUBMISSION_STATUS.SYSTEM_ERROR}',
           results = $1
       WHERE overall_status IN ('${SUBMISSION_STATUS.COMPILING}', '${SUBMISSION_STATUS.RUNNING}')`,
      [JSON.stringify([{
        status: SUBMISSION_STATUS.SYSTEM_ERROR,
        output: 'Judging was interrupted by a server restart. Please resubmit.',
      }])]
    );
    systemErrored += stuckRes.rowCount ?? 0;
  }

  if (requeued > 0 || systemErrored > 0) {
    logger.info('startup submission sweep', { requeued, systemErrored });
  }
  return { requeued, systemErrored };
}
