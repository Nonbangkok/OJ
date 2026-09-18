import * as db from '../db';
import { ProblemDraftRow } from '../types/authoring';
import { createFallbackAuthorAvatar } from './authorProfileImageService';
import {
  AuthorProfileDatabase,
  getAuthorProfile,
} from './authorProfileQueryService';
import {
  AuthoringDraftDatabase,
  getProblemDraft,
  UpdateProblemDraftResult,
  updateProblemDraft,
} from './authoringDraftQueryService';

export type AuthorProfileSnapshot = Pick<
  ProblemDraftRow,
  | 'author_profile_id'
  | 'author_aka_name'
  | 'author_real_name'
  | 'language'
  | 'country_code'
> & { author_profile_image_png: Buffer };

export type AuthorProfileSnapshotResult =
  | { kind: 'resolved'; snapshot: AuthorProfileSnapshot }
  | { kind: 'profile_not_found' };

export type RefreshProblemDraftAuthorResult = UpdateProblemDraftResult
  | { kind: 'profile_not_selected'; draft: ProblemDraftRow }
  | { kind: 'profile_not_found'; draft: ProblemDraftRow };

type AuthorSnapshotDatabase = AuthorProfileDatabase & AuthoringDraftDatabase;

export type ManualAuthorSnapshotInput = Pick<
  ProblemDraftRow,
  'author_aka_name' | 'author_real_name' | 'language' | 'country_code'
>;

/** Creates a draft author snapshot when no reusable profile is selected. */
export const createManualAuthorSnapshot = async (
  input: ManualAuthorSnapshotInput,
): Promise<AuthorProfileSnapshot> => {
  try {
    return {
      author_profile_id: null,
      ...input,
      author_profile_image_png: await createFallbackAuthorAvatar(input.author_aka_name),
    };
  } catch (error) {
    throw error;
  }
};

/** Resolves immutable author display fields and canonical PNG bytes for a draft. */
export const getAuthorProfileSnapshot = async (
  profileId: string,
  database: AuthorProfileDatabase = db,
): Promise<AuthorProfileSnapshotResult> => {
  try {
    const profile = await getAuthorProfile(profileId, database);
    if (!profile) {
      return { kind: 'profile_not_found' };
    }

    const profileImage = profile.profile_image_png
      ?? await createFallbackAuthorAvatar(profile.aka_name);
    return {
      kind: 'resolved',
      snapshot: {
        author_profile_id: profile.id,
        author_aka_name: profile.aka_name,
        author_real_name: profile.real_name,
        language: profile.default_language,
        country_code: profile.country_code,
        author_profile_image_png: profileImage,
      },
    };
  } catch (error) {
    throw error;
  }
};

/** Refreshes a linked profile snapshot only when the caller's draft revision is current. */
export const refreshProblemDraftAuthor = async (
  draftId: string,
  expectedRevision: number,
  database: AuthorSnapshotDatabase = db,
): Promise<RefreshProblemDraftAuthorResult> => {
  try {
    const draft = await getProblemDraft(draftId, database);
    if (!draft) {
      return { kind: 'not_found' };
    }
    if (draft.status === 'published') {
      return { kind: 'published', draft };
    }
    if (draft.revision !== expectedRevision) {
      return { kind: 'revision_conflict', draft };
    }
    if (!draft.author_profile_id) {
      return { kind: 'profile_not_selected', draft };
    }

    const snapshotResult = await getAuthorProfileSnapshot(draft.author_profile_id, database);
    if (snapshotResult.kind === 'profile_not_found') {
      return { kind: 'profile_not_found', draft };
    }

    return updateProblemDraft(
      draftId,
      expectedRevision,
      snapshotResult.snapshot,
      database,
    );
  } catch (error) {
    throw error;
  }
};
