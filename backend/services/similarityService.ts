import { query } from '../db';
import { isTooShortForComparison, normalizeSource, similarity } from '../utils/codeSimilarity';

/** Pairs at or above this similarity are reported to staff. */
export const SIMILARITY_THRESHOLD = 0.8;

/** Cap per-contest pair generation so the endpoint stays bounded. */
const MAX_SUBMISSIONS_PER_PROBLEM = 200;

export interface SimilarSubmissionRow {
    user_id: number | null;
    username: string | null;
    code: string;
}

export interface SimilarPair {
    problemId: string;
    userA: string;
    userB: string;
    similarity: number;
    submissionIdA: number;
    submissionIdB: number;
}

interface SubmissionRow {
    id: number;
    user_id: number | null;
    username: string | null;
    code: string;
}

/**
 * Pairwise similarity between different users' contest submissions for the
 * same problem. Staff-facing cheat detection: reports pairs at or above
 * SIMILARITY_THRESHOLD. Skips trivially short sources (nothing to compare)
 * and self-comparisons.
 */
export const findSimilarContestPairs = async (
    contestId: number,
    threshold: number = SIMILARITY_THRESHOLD,
): Promise<SimilarPair[]> => {
    // Latest submission per (user, problem) — one program per student per
    // problem keeps the pair count linear in participants.
    const rows = await query<SubmissionRow & { problem_id: string }>(`
        SELECT DISTINCT ON (cs.user_id, cs.problem_id)
            cs.id,
            cs.user_id,
            cs.problem_id,
            u.username,
            cs.code
        FROM contest_submissions cs
        JOIN users u ON u.id = cs.user_id
        WHERE cs.contest_id = $1
        ORDER BY cs.user_id, cs.problem_id, cs.submitted_at DESC
    `, [contestId]);

    const grouped = new Map<string, Array<SubmissionRow & { problem_id: string }>>();
    for (const row of rows.rows) {
        if (row.user_id === null || !row.code) continue;
        const list = grouped.get(row.problem_id) ?? [];
        list.push(row);
        grouped.set(row.problem_id, list);
    }

    const pairs: SimilarPair[] = [];
    for (const [problemId, submissions] of grouped) {
        const bounded = submissions.slice(0, MAX_SUBMISSIONS_PER_PROBLEM);
        // Pre-normalise once; similarity of raw code would re-normalise twice.
        const normalized = new Map<number, string>();
        for (const submission of bounded) {
            normalized.set(submission.id, normalizeSource(submission.code));
        }

        for (let i = 0; i < bounded.length; i++) {
            for (let j = i + 1; j < bounded.length; j++) {
                const a = bounded[i];
                const b = bounded[j];
                if (a.user_id === b.user_id) continue;
                const normA = normalized.get(a.id);
                const normB = normalized.get(b.id);
                if (!normA || !normB || isTooShortForComparison(normA) || isTooShortForComparison(normB)) {
                    continue;
                }
                const score = similarity(a.code, b.code);
                if (score >= threshold) {
                    pairs.push({
                        problemId,
                        userA: a.username ?? `user ${a.user_id}`,
                        userB: b.username ?? `user ${b.user_id}`,
                        similarity: Math.round(score * 100) / 100,
                        submissionIdA: a.id,
                        submissionIdB: b.id,
                    });
                }
            }
        }
    }

    return pairs.sort((a, b) => b.similarity - a.similarity);
};
