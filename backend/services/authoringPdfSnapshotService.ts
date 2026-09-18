import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { ProblemDraftRow } from '../types/authoring';
import { pdfSnapshotSchema } from '../authoring/protocol';
import { compileStatementSource } from '../authoring/statementCompiler';
import { createFallbackAuthorAvatar } from './authorProfileImageService';

/** Called only while holding the draft lock. Raw bytes stay outside bounded request JSON. */
export async function capturePdfSnapshot(client: PoolClient, draft: ProblemDraftRow) {
  const assets = (await client.query(`SELECT filename,mime_type AS "mimeType",size_bytes::int AS "sizeBytes",
    checksum_sha256 AS sha256 FROM problem_draft_assets WHERE draft_id=$1 ORDER BY filename`, [draft.id])).rows;
  const avatar = draft.author_profile_image_png ?? await createFallbackAuthorAvatar(draft.author_aka_name);
  const snapshot = pdfSnapshotSchema.parse({
    document: { templateVersion: draft.template_version, title: draft.title, taskCode: draft.problem_id,
      akaName: draft.author_aka_name, realName: draft.author_real_name, language: draft.language,
      countryCode: draft.country_code, statementHtml: compileStatementSource(draft.statement_html, assets.map(a => a.filename)) },
    assets, avatar: { filename: 'avatar.png', mimeType: 'image/png', sizeBytes: avatar.length,
      sha256: createHash('sha256').update(avatar).digest('hex') },
  });
  return { snapshot, avatar };
}
