import { query } from '../db';
import { isTooShortForComparison, normalizeSource, similarity, templateShingles } from '../utils/codeSimilarity';
import { contestSubmissionsSql } from './contestSubmissionsSql';

/** Default similarity cutoff reported to staff (tunable per request). */
export const SIMILARITY_THRESHOLD = 0.6;

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
 * A5-05: on a header problem every student starts from the same starter
 * files (the student.h template, main.cpp, the data-structure header), so
 * two independent solutions share most of their tokens. Their shingles are
 * set aside before comparing, per header problem.
 */
const loadHeaderStarterShingles = async (problemIds: string[]): Promise<Map<string, Set<string>>> => {
    const starters = new Map<string, Set<string>>();
    if (problemIds.length === 0) return starters;
    const files = await query<{ problem_id: string; content: Buffer }>(`
        SELECT f.problem_id, f.content
        FROM problem_files f
        JOIN problems p ON p.id = f.problem_id
        WHERE f.problem_id = ANY($1::text[]) AND f.role = 'starter' AND p.problem_type = 'header'
    `, [problemIds]);
    const sources = new Map<string, string[]>();
    for (const file of files.rows) {
        const list = sources.get(file.problem_id) ?? [];
        list.push(Buffer.from(file.content).toString('utf8'));
        sources.set(file.problem_id, list);
    }
    for (const [problemId, list] of sources) starters.set(problemId, templateShingles(list));
    return starters;
};

/**
 * Pairwise similarity between different users' contest submissions for the
 * same problem. Staff-facing cheat detection: reports pairs at or above
 * SIMILARITY_THRESHOLD. Skips trivially short sources (nothing to compare)
 * and self-comparisons. On header problems only what each student added to
 * the starter files is compared.
 */
export const findSimilarContestPairs = async (
    contestId: number,
    threshold: number = SIMILARITY_THRESHOLD,
): Promise<SimilarPair[]> => {
    // Latest submission per (user, problem) — one program per student per
    // problem keeps the pair count linear in participants. A5-04: a finished
    // contest's submissions are its migrated rows in `submissions`.
    const rows = await query<SubmissionRow & { problem_id: string }>(`
        SELECT DISTINCT ON (cs.user_id, cs.problem_id)
            cs.id,
            cs.user_id,
            cs.problem_id,
            u.username,
            cs.code
        FROM ${contestSubmissionsSql('$1', 'id, contest_id, user_id, problem_id, code, submitted_at')} cs
        JOIN users u ON u.id = cs.user_id
        WHERE cs.contest_id = $1
        ORDER BY cs.user_id, cs.problem_id, cs.submitted_at DESC, cs.id DESC
    `, [contestId]);

    const grouped = new Map<string, Array<SubmissionRow & { problem_id: string }>>();
    for (const row of rows.rows) {
        if (row.user_id === null || !row.code) continue;
        const list = grouped.get(row.problem_id) ?? [];
        list.push(row);
        grouped.set(row.problem_id, list);
    }

    const starters = await loadHeaderStarterShingles([...grouped.keys()]);

    const pairs: SimilarPair[] = [];
    for (const [problemId, submissions] of grouped) {
        const bounded = submissions.slice(0, MAX_SUBMISSIONS_PER_PROBLEM);
        const ignore = starters.get(problemId);
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
                const score = similarity(a.code, b.code, ignore);
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
