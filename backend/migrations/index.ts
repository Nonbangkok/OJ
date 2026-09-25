import { coreSchemaSql } from './0001CoreSchema';
import { problemAuthoringFoundationSql } from './0002ProblemAuthoringFoundation';
import { Migration } from './migrationRunner';
import { authoringJobDeliverySql } from './0003AuthoringJobDelivery';
import { authoringJobInputsSql } from './0004AuthoringJobInputs';
import { authoringJobFilesSql } from './0005AuthoringJobFiles';
import { authoringPublishedProblemProvenanceSql } from './0006AuthoringPublishedProblemProvenance';
import { problemCategorySql } from './0007ProblemCategory';
import { userProfileSql } from './0008UserProfile';
import { profileSyncSql } from './0009ProfileSync';
import { submissionIndexesSql } from './0010SubmissionIndexes';
import { authoringDraftCategorySql } from './0011AuthoringDraftCategory';
import { problemCategoriesSql } from './0012ProblemCategories';
import { problemCollectionsSql } from './0014ProblemCollections';
import { dropCollectionDescriptionSql } from './0015DropCollectionDescription';
import { userProblemRewardsSql } from './0016UserProblemRewards';
import { siteAccessModeSql } from './0017SiteAccessMode';
import { integrityFixesSql } from './0018IntegrityFixes';
import { passwordChangeEnabledSql } from './0019PasswordChangeEnabled';
import { problemDifficultySql } from './0013ProblemDifficulty';

export const coreMigrations: readonly Migration[] = Object.freeze([
  {
    version: '0001_core_schema',
    sql: coreSchemaSql,
  },
]);

export const migrations: readonly Migration[] = Object.freeze([
  ...coreMigrations,
  {
    version: '0002_problem_authoring_foundation',
    sql: problemAuthoringFoundationSql,
  },
  { version: '0003_authoring_job_delivery', sql: authoringJobDeliverySql },
  { version: '0004_authoring_job_inputs', sql: authoringJobInputsSql },
  { version: '0005_authoring_job_files', sql: authoringJobFilesSql },
  { version: '0006_authoring_published_problem_provenance', sql: authoringPublishedProblemProvenanceSql },
  { version: '0007_problem_category', sql: problemCategorySql },
  { version: '0008_user_profile', sql: userProfileSql },
  { version: '0009_profile_sync', sql: profileSyncSql },
  { version: '0010_submission_indexes', sql: submissionIndexesSql },
  { version: '0011_authoring_draft_category', sql: authoringDraftCategorySql },
  { version: '0012_problem_categories', sql: problemCategoriesSql },
  { version: '0013_problem_difficulty', sql: problemDifficultySql },
  { version: '0014_problem_collections', sql: problemCollectionsSql },
  { version: '0015_drop_collection_description', sql: dropCollectionDescriptionSql },
  { version: '0016_user_problem_rewards', sql: userProblemRewardsSql },
  { version: '0017_site_access_mode', sql: siteAccessModeSql },
  { version: '0018_integrity_fixes', sql: integrityFixesSql },
  { version: '0019_password_change_enabled', sql: passwordChangeEnabledSql },
]);
