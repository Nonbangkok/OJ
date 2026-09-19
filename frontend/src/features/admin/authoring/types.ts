export interface DraftFields {
  problemId: string; title: string; authorProfileId: string | null;
  authorAkaName: string; authorRealName: string; language: string; countryCode: string;
  timeLimitMs: number; memoryLimitMb: number; statementHtml: string;
  solutionCpp: string; generatorCpp: string | null; templateVersion: string;
}
export interface Draft extends DraftFields {
  id: string; revision: number; verifiedRevision: number | null;
  status: 'draft' | 'generated' | 'ready' | 'published';
  hasLatestPdf: boolean; latestPdfRevision: number | null; hasAuthorProfileImage: boolean;
  updatedAt: string; publishedAt: string | null;
}
export interface Profile {
  id: string;
  userId: number | null;
  akaName: string;
  realName: string;
  defaultLanguage: string;
  countryCode: string;
  hasProfileImage: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface Asset { id: string; filename: string; sizeBytes: number }
/** Gate response when an author-relevant profile edit would cascade to drafts. */
export interface ProfileUpdateConfirmation {
  confirmationRequired: true;
  affectedDrafts: number;
  affectedPublishedProblems: number;
  profile: Profile;
}
export interface TestcaseMetadata {
  id: string;
  caseNumber: number;
  filename: string;
  inputBytes: number;
  outputBytes: number | null;
  hasOutput: boolean;
  source: string;
  sourceRevision: number;
  createdAt: string;
  updatedAt: string;
}
export interface Job {
  id: string; draftId: string; draftRevision: number; jobType: string; status: string;
  createdAt: string; log?: string; errorCode: string | null; errorMessage: string | null;
  resultSummary?: {
    durationMs?: number; verifiedRevision?: number; errorCode?: string; warnings?: string[];
    pdf?: { sizeBytes: number; templateVersion: string };
    failedCase?: { caseNumber: number; durationMs: number };
    verification?: { checks: Record<string, string>; caseCount: number; totalTestcaseBytes: number;
      memoryLimitMb: number; peakMemoryBytes: null; warnings: string[];
      cases: { caseId: string; caseNumber: number; durationMs: number }[] };
  } | null;
}
export const draftBase = (id: string) => `/admin/authoring/drafts/${encodeURIComponent(id)}`;export const isActive = (job: Job) => ['queued', 'compiling', 'running'].includes(job.status);
/** One draft inside a profile-sync cascade (GET /admin/authoring/profile-syncs/:id). */
export interface ProfileSyncItem {
  draftId: string; problemId: string; title: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed' | 'deferred';
  attempts: number; errorMessage: string | null;
  draftStatus: Draft['status']; published: boolean;
}
/** A profile-sync cascade run (list rows omit items). */
export interface ProfileSyncRun {
  id: string; profileId: string; profileAkaName?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  resultSummary: { synced: number; failed: number; deferred: number; warnings?: string[] } | null;
  createdAt: string; startedAt?: string | null; finishedAt: string | null;
  progress: { total: number; synced: number; failed: number };
  items?: ProfileSyncItem[];
}
export const editableFields: (keyof DraftFields)[] = ['problemId', 'title', 'authorProfileId', 'authorAkaName',
  'authorRealName', 'language', 'countryCode', 'timeLimitMs', 'memoryLimitMb', 'statementHtml',
  'solutionCpp', 'generatorCpp', 'templateVersion'];
