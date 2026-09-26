import api from '../api';
import type {
  Asset,
  Draft,
  DraftFields,
  Job,
  Profile,
  ProfileSyncRun,
  ProfileUpdateConfirmation,
  TestcaseMetadata,
} from '../../features/admin/authoring/types';

const draftsBase = '/admin/authoring/drafts';
const profilesBase = '/admin/author-profiles';
const draftBase = (id: string) => `${draftsBase}/${encodeURIComponent(id)}`;
const testcasesBase = (id: string) => `${draftBase(id)}/testcases`;

export interface DraftSaveRequest {
  expectedRevision: number;
}

export interface JobStartRequest {
  expectedRevision: number;
  target?: string;
  seed?: string;
}

export interface TestcaseListResponse {
  revision: number;
  testcases: TestcaseMetadata[];
}

export interface TestcaseContents extends TestcaseMetadata {
  input: string;
  output: string | null;
}

const authoringService = {
  // Drafts
  /**
   * `scope: 'mine'` asks the backend to filter by the logged-in username ↔
   * Author Profile AKA identity (exact, case-normalized match — never a
   * display-name or substring comparison). Without it every draft is listed.
   */
  listDrafts: async (scope: 'all' | 'mine' = 'all'): Promise<Draft[]> => {
    const response = await api.get<Draft[]>(draftsBase, {
      params: scope === 'mine' ? { scope } : {},
    });
    return response.data;
  },
  createDraft: async (fields: DraftFields): Promise<Draft> => {
    const response = await api.post<Draft>(draftsBase, fields);
    return response.data;
  },
  getDraft: async (id: string): Promise<Draft> => {
    const response = await api.get<Draft>(draftBase(id));
    return response.data;
  },
  saveDraft: async (id: string, body: DraftSaveRequest & Partial<DraftFields>): Promise<Draft> => {
    const response = await api.patch<Draft>(draftBase(id), body);
    return response.data;
  },
  startNewRevision: async (id: string): Promise<Draft> => {
    const response = await api.post<Draft>(`${draftBase(id)}/new-revision`, {});
    return response.data;
  },
  refreshAuthorProfile: async (id: string, expectedRevision: number): Promise<Draft> => {
    const response = await api.post<Draft>(`${draftBase(id)}/refresh-author-profile`, {
      expectedRevision,
    });
    return response.data;
  },
  publishDraft: async (id: string, expectedRevision: number): Promise<void> => {
    await api.post(`${draftBase(id)}/publish`, { expectedRevision });
  },
  previewStatement: async (id: string, statementHtml: string): Promise<{ html: string }> => {
    const response = await api.post<{ html: string }>(`${draftBase(id)}/preview`, {
      statementHtml,
    });
    return response.data;
  },
  draftPdfUrl: (id: string, revision: number | null): string =>
    `${(api.defaults?.baseURL || '').replace(/\/$/, '')}${draftBase(id)}/pdf?revision=${revision}`,

  // Jobs
  getJobs: async (id: string): Promise<Job[]> => {
    const response = await api.get<Job[]>(`${draftBase(id)}/jobs`);
    return response.data;
  },
  getJob: async (jobId: string): Promise<Job> => {
    const response = await api.get<Job>(`/admin/authoring/jobs/${encodeURIComponent(jobId)}`);
    return response.data;
  },
  startJob: async (
    id: string,
    action: 'compile' | 'generate' | 'outputs' | 'pdf' | 'verify',
    body: JobStartRequest
  ): Promise<Job> => {
    const response = await api.post<Job>(`${draftBase(id)}/jobs/${action}`, body);
    return response.data;
  },

  // Profile sync cascades
  listProfileSyncs: async (): Promise<ProfileSyncRun[]> => {
    const response = await api.get<ProfileSyncRun[]>('/admin/authoring/profile-syncs');
    return response.data;
  },
  getProfileSync: async (syncId: string): Promise<ProfileSyncRun> => {
    const response = await api.get<ProfileSyncRun>(`/admin/authoring/profile-syncs/${encodeURIComponent(syncId)}`);
    return response.data;
  },

  // Statement assets
  listAssets: async (id: string): Promise<Asset[]> => {
    const response = await api.get<Asset[]>(`${draftBase(id)}/assets`);
    return response.data;
  },
  uploadAsset: async (id: string, data: FormData): Promise<void> => {
    await api.post(`${draftBase(id)}/assets`, data);
  },
  deleteAsset: async (id: string, assetId: string, expectedRevision: number): Promise<void> => {
    await api.delete(`${draftBase(id)}/assets/${encodeURIComponent(assetId)}`, {
      params: { expectedRevision },
    });
  },

  // Testcase files
  listTestcases: async (id: string): Promise<TestcaseListResponse> => {
    const response = await api.get<TestcaseListResponse>(testcasesBase(id));
    return response.data;
  },
  getTestcase: async (id: string, caseId: string): Promise<TestcaseContents> => {
    const response = await api.get<TestcaseContents>(
      `${testcasesBase(id)}/${encodeURIComponent(caseId)}`
    );
    return response.data;
  },
  appendTestcase: async (id: string, data: FormData): Promise<{ revision: number }> => {
    const response = await api.post<{ revision: number }>(testcasesBase(id), data);
    return response.data;
  },
  replaceTestcase: async (
    id: string,
    caseId: string,
    data: FormData
  ): Promise<{ revision: number }> => {
    const response = await api.patch<{ revision: number }>(
      `${testcasesBase(id)}/${encodeURIComponent(caseId)}`,
      data
    );
    return response.data;
  },
  deleteTestcase: async (
    id: string,
    caseId: string,
    expectedRevision: number
  ): Promise<{ revision: number }> => {
    const response = await api.delete<{ revision: number }>(
      `${testcasesBase(id)}/${encodeURIComponent(caseId)}`,
      { data: { expectedRevision } }
    );
    return response.data;
  },

  // Author profiles
  listProfiles: async (): Promise<Profile[]> => {
    const response = await api.get<Profile[]>(profilesBase);
    return response.data;
  },
  createProfile: async (data: FormData): Promise<Profile> => {
    const response = await api.post<Profile>(profilesBase, data);
    return response.data;
  },
  updateProfile: async (id: string, data: FormData): Promise<Profile> => {
    const response = await api.patch<Profile>(
      `${profilesBase}/${encodeURIComponent(id)}`,
      data
    );
    return response.data;
  },
  /**
   * Profile update with the confirmation gate: an author-relevant change
   * without `confirmed` returns the cascade impact instead of saving, so the
   * caller can ask the admin before cascading to drafts and published problems.
   */
  updateProfileWithGate: async (
    id: string,
    data: FormData,
    confirmed = false
  ): Promise<Profile | ProfileUpdateConfirmation> => {
    if (confirmed) data.append('confirmed', 'true');
    const response = await api.patch<Profile | ProfileUpdateConfirmation>(
      `${profilesBase}/${encodeURIComponent(id)}`,
      data
    );
    return response.data;
  },
  profileImageUrl: (id: string): string => `${profilesBase}/${encodeURIComponent(id)}/image`,
};

export default authoringService;
