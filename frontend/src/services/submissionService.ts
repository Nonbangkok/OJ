import api from './api';
import type { Submission, CodeSubmission, SubmissionResult, User, Problem } from '../types';

/**
 * Service for handling code submissions and searching relative to submissions.
 */
interface SubmissionService {
  submit(submitData: CodeSubmission): Promise<SubmissionResult>;
  getAll(params?: Record<string, any>): Promise<Submission[]>;
  getById(submissionId: string | number, contestId?: string | number | null): Promise<Submission>;
  searchProblems(query: string, contestId?: string | number | null): Promise<Problem[]>;
  searchUsers(query: string, contestId?: string | number | null): Promise<User[]>;
}

const submissionService: SubmissionService = {
  /**
   * Submits code for a problem.
   * @param {CodeSubmission} submitData
   * @returns {Promise<SubmissionResult>} Submission result
   */
  submit: async (submitData: CodeSubmission): Promise<SubmissionResult> => {
    const response = await api.post('/submit', submitData);
    return response.data;
  },

  /**
   * Fetches all submissions, optionally filtered by params.
   * @param {Record<string, any>} params - Query parameters for filtering
   * @returns {Promise<Submission[]>} Array of submissions
   */
  getAll: async (params?: Record<string, any>): Promise<Submission[]> => {
    const response = await api.get('/submissions', { params });
    return response.data;
  },

  /**
   * Fetches detailed information for a specific submission.
   * @param {string | number} submissionId 
   * @param {string | number | null} [contestId=null] 
   * @returns {Promise<Submission>} Detailed submission data including code and test case results
   */
  getById: async (submissionId: string | number, contestId: string | number | null = null): Promise<Submission> => {
    const params = contestId ? { contestId } : {};
    const response = await api.get(`/submissions/${submissionId}`, { params });
    return response.data;
  },

  /**
   * Searches for problems by ID or title (used for autocomplete filters).
   * @param {string} query 
   * @param {string | number | null} [contestId=null] 
   * @returns {Promise<Problem[]>} Problem suggestions
   */
  searchProblems: async (query: string, contestId: string | number | null = null): Promise<Problem[]> => {
    let url = `/search/problems?q=${query}`;
    if (contestId) url += `&contestId=${contestId}`;
    const response = await api.get(url);
    return response.data;
  },

  /**
   * Searches for users by username (used for autocomplete filters).
   * @param {string} query 
   * @param {string | number | null} [contestId=null] 
   * @returns {Promise<User[]>} User suggestions
   */
  searchUsers: async (query: string, contestId: string | number | null = null): Promise<User[]> => {
    let url = `/search/users?q=${query}`;
    if (contestId) url += `&contestId=${contestId}`;
    const response = await api.get(url);
    return response.data;
  }
};

export default submissionService;