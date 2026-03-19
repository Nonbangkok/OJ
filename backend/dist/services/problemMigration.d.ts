/**
 * Problem Migration Service
 *
 * This service handles the movement of problems between the main system and contests.
 * Key functions:
 * - moveProblemsToContest: Move problems from main system to a contest
 * - moveProblemsBackToMain: Move problems from contest back to main system
 * - migrateSubmissionsAfterContest: Migrate contest submissions to main submissions
 */
/**
 * Move problems from main system to a contest
 * @param {number} contestId - The contest ID to move problems to
 * @param {string[]} problemIds - Array of problem IDs to move
 * @returns {Promise<Object>} Result object with success status and details
 */
export function moveProblemsToContest(contestId: number, problemIds: string[]): Promise<Object>;
/**
 * Move problems from contest back to main system
 * @param {number} contestId - The contest ID to move problems from
 * @param {string[]} [problemIds=null] - Optional array of problem IDs to move. If null, all problems are moved.
 * @returns {Promise<Object>} Result object with success status and details
 */
export function moveProblemsBackToMain(contestId: number, problemIds?: string[]): Promise<Object>;
/**
 * Migrate all contest submissions to main submissions table and generate final scoreboard
 * @param {number} contestId - The contest ID to migrate submissions from
 * @returns {Promise<Object>} Result object with migration details
 */
export function migrateSubmissionsAfterContest(contestId: number): Promise<Object>;
/**
 * Get problems available for moving to contest (problems in main system)
 * @returns {Promise<Array>} Array of available problems
 */
export function getAvailableProblemsForContest(): Promise<any[]>;
/**
 * Get problems currently in a contest
 * @param {number} contestId - The contest ID
 * @returns {Promise<Array>} Array of problems in the contest
 */
export function getProblemsInContest(contestId: number): Promise<any[]>;
