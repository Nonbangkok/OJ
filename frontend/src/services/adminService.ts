import api from './api';
import type { User, Problem, Contest, AdminSettings, BatchUserCreation } from '../types';

/**
 * Service for administrative operations such as managing users, problems, and contests.
 */
interface AdminService {
  // User Management
  getUsers(): Promise<User[]>;
  createUser(userData: Partial<User>): Promise<User>;
  updateUser(userId: string | number, userData: Partial<User>): Promise<User>;
  getAuthors(): Promise<User[]>;
  deleteUser(userId: string | number): Promise<{ message: string }>;
  createBatchUsers(batchData: BatchUserCreation): Promise<{ users: User[] }>;

  // Problem Management
  getProblems(): Promise<Problem[]>;
  createProblem(problemData: Partial<Problem>): Promise<Problem>;
  updateProblem(problemId: string | number, problemData: Partial<Problem>): Promise<Problem>;
  deleteProblem(problemId: string | number): Promise<{ message: string }>;
  getProblemDetail(problemId: string | number): Promise<Problem>;
  updateProblemVisibility(problemId: string | number, isVisible: boolean): Promise<{ message: string }>;
  exportProblems(problemIds: string[]): Promise<any>;
  batchUploadProblems(formData: FormData): Promise<any>;
  uploadFiles(problemId: string | number, formData: FormData): Promise<{ message: string }>;

  // Contest Management
  getContests(): Promise<Contest[]>;
  createContest(contestData: Partial<Contest>): Promise<Contest>;
  updateContest(contestId: string | number, contestData: Partial<Contest>): Promise<Contest>;
  deleteContest(contestId: string | number): Promise<{ message: string }>;
  getAvailableProblems(): Promise<Problem[]>;
  getContestProblemsAdmin(contestId: string | number): Promise<Problem[]>;
  migrateContestProblems(contestId: string | number, problemIds: string[], action: 'add' | 'remove'): Promise<{ message: string }>;

  // Settings & Database
  getRegistrationSettings(): Promise<AdminSettings>;
  updateRegistrationSettings(enabled: boolean): Promise<AdminSettings>;
  exportDatabase(): Promise<any>;
  importDatabase(formData: FormData): Promise<{ message: string }>;
  getUploadProgress(jobId: string): Promise<{ progress: number; status: string }>;
  getBatchUploadProgressEventSource(progressId: string): EventSource;
}

const adminService: AdminService = {
    // User Management
    /**
     * Fetches all registered users.
     * @returns {Promise<User[]>} Array of user objects
     */
    getUsers: async (): Promise<User[]> => {
        const response = await api.get('/admin/users');
        return response.data;
    },
    /**
     * Creates a new user account.
     * @param {Partial<User>} userData 
     * @returns {Promise<User>} Created user data
     */
    createUser: async (userData: Partial<User>): Promise<User> => {
        const response = await api.post('/admin/users', userData);
        return response.data;
    },
    /**
     * Updates an existing user's information.
     * @param {string | number} userId 
     * @param {Partial<User>} userData 
     * @returns {Promise<User>} Updated user data
     */
    updateUser: async (userId: string | number, userData: Partial<User>): Promise<User> => {
        const response = await api.put(`/admin/users/${userId}`, userData);
        return response.data;
    },
    /**
     * Fetches users eligible to be problem authors.
     * @returns {Promise<User[]>} Array of author data
     */
    getAuthors: async (): Promise<User[]> => {
        const response = await api.get('/admin/authors');
        return response.data;
    },
    /**
     * Deletes a user by ID.
     * @param {string | number} userId 
     * @returns {Promise<{ message: string }>} Success message
     */
    deleteUser: async (userId: string | number): Promise<{ message: string }> => {
        const response = await api.delete(`/admin/users/${userId}`);
        return response.data;
    },
    /**
     * Creates multiple users simultaneously from batch data.
     * @param {BatchUserCreation} batchData 
     * @returns {Promise<{ users: User[] }>} Batch creation results
     */
    createBatchUsers: async (batchData: BatchUserCreation): Promise<{ users: User[] }> => {
        const response = await api.post('/admin/users/batch', batchData);
        return response.data;
    },

    // Problem Management
    /**
     * Fetches all problems (including hidden ones).
     * @returns {Promise<Problem[]>} Array of problem objects
     */
    getProblems: async (): Promise<Problem[]> => {
        const response = await api.get('/admin/problems');
        return response.data;
    },
    /**
     * Creates a new problem.
     * @param {Partial<Problem>} problemData 
     * @returns {Promise<Problem>} Created problem data
     */
    createProblem: async (problemData: Partial<Problem>): Promise<Problem> => {
        const response = await api.post('/admin/problems', problemData);
        return response.data;
    },
    /**
     * Updates an existing problem.
     * @param {string | number} problemId 
     * @param {Partial<Problem>} problemData 
     * @returns {Promise<Problem>} Updated problem data
     */
    updateProblem: async (problemId: string | number, problemData: Partial<Problem>): Promise<Problem> => {
        const response = await api.put(`/admin/problems/${problemId}`, problemData);
        return response.data;
    },
    /**
     * Deletes a problem.
     * @param {string | number} problemId 
     * @returns {Promise<{ message: string }>} Success message
     */
    deleteProblem: async (problemId: string | number): Promise<{ message: string }> => {
        const response = await api.delete(`/admin/problems/${problemId}`);
        return response.data;
    },
    /**
     * Fetches detailed information for a specific problem.
     * @param {string | number} problemId 
     * @returns {Promise<Problem>} Detailed problem data
     */
    getProblemDetail: async (problemId: string | number): Promise<Problem> => {
        const response = await api.get(`/admin/problems/${problemId}`);
        return response.data;
    },
    /**
     * Updates the visibility status of a problem.
     * @param {string | number} problemId 
     * @param {boolean} isVisible 
     * @returns {Promise<{ message: string }>} Success message
     */
    updateProblemVisibility: async (problemId: string | number, isVisible: boolean): Promise<{ message: string }> => {
        const response = await api.put(`/admin/problems/${problemId}/visibility`, { isVisible });
        return response.data;
    },
    /**
     * Exports selected problems as a zip archive.
     * @param {string[]} problemIds 
     * @returns {Promise<any>} Blob response containing the zip file
     */
    exportProblems: async (problemIds: string[]): Promise<any> => {
        const response = await api.post('/admin/problems/export', { problemIds }, { responseType: 'blob' });
        return response;
    },
    /**
     * Uploads a batch of problems from a zip file.
     * @param {FormData} formData - Must contain the zip file
     * @returns {Promise<any>} Validation or upload response
     */
    batchUploadProblems: async (formData: FormData): Promise<any> => {
        const response = await api.post('/admin/problems/batch-upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response;
    },
    /**
     * Uploads test case or PDF files for a specific problem.
     * @param {string | number} problemId 
     * @param {FormData} formData 
     * @returns {Promise<{ message: string }>} Success message
     */
    uploadFiles: async (problemId: string | number, formData: FormData): Promise<{ message: string }> => {
        const response = await api.post(`/admin/problems/${problemId}/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    },

    // Contest Management
    /**
     * Fetches all contests for administration.
     * @returns {Promise<Contest[]>} Array of contests
     */
    getContests: async (): Promise<Contest[]> => {
        const response = await api.get('/admin/contests');
        return response.data;
    },
    /**
     * Creates a new contest.
     * @param {Partial<Contest>} contestData 
     * @returns {Promise<Contest>} Created contest data
     */
    createContest: async (contestData: Partial<Contest>): Promise<Contest> => {
        const response = await api.post('/admin/contests', contestData);
        return response.data;
    },
    /**
     * Updates an existing contest.
     * @param {string | number} contestId 
     * @param {Partial<Contest>} contestData 
     * @returns {Promise<Contest>} Updated contest data
     */
    updateContest: async (contestId: string | number, contestData: Partial<Contest>): Promise<Contest> => {
        const response = await api.put(`/admin/contests/${contestId}`, contestData);
        return response.data;
    },
    /**
     * Deletes a contest.
     * @param {string | number} contestId 
     * @returns {Promise<{ message: string }>} Success message
     */
    deleteContest: async (contestId: string | number): Promise<{ message: string }> => {
        const response = await api.delete(`/admin/contests/${contestId}`);
        return response.data;
    },
    /**
     * Fetches all problems available to be added to a contest.
     * @returns {Promise<Problem[]>} Array of available problems
     */
    getAvailableProblems: async (): Promise<Problem[]> => {
        const response = await api.get('/admin/contests/available-problems');
        return response.data;
    },
    /**
     * Fetches problems currently assigned to a specific contest.
     * @param {string | number} contestId 
     * @returns {Promise<Problem[]>} Array of contest problems
     */
    getContestProblemsAdmin: async (contestId: string | number): Promise<Problem[]> => {
        const response = await api.get(`/admin/contests/${contestId}/admin-problems`);
        return response.data;
    },
    /**
     * Adds or removes problems from a contest.
     * @param {string | number} contestId 
     * @param {string[]} problemIds 
     * @param {'add' | 'remove'} action - 'add' or 'remove'
     * @returns {Promise<{ message: string }>} Success message
     */
    migrateContestProblems: async (contestId: string | number, problemIds: string[], action: 'add' | 'remove'): Promise<{ message: string }> => {
        const response = await api.post(`/admin/contests/${contestId}/problems`, {
            problemIds,
            action
        });
        return response.data;
    },

    // Settings & Database
    /**
     * Fetches system registration settings.
     * @returns {Promise<AdminSettings>} Registration settings configuration
     */
    getRegistrationSettings: async (): Promise<AdminSettings> => {
        const response = await api.get('/admin/settings/registration');
        return response.data;
    },
    /**
     * Enables or disables system-wide user registration.
     * @param {boolean} enabled 
     * @returns {Promise<AdminSettings>} Updated configuration
     */
    updateRegistrationSettings: async (enabled: boolean): Promise<AdminSettings> => {
        const response = await api.put('/admin/settings/registration', { enabled });
        return response.data;
    },
    /**
     * Triggers a full database export backup.
     * @returns {Promise<any>} Blob response containing the SQL dump
     */
    exportDatabase: async (): Promise<any> => {
        const response = await api.post('/admin/database/export', {}, { responseType: 'blob' });
        return response;
    },
    /**
     * Imports a SQL dump into database.
     * @param {FormData} formData - Must contain the SQL dump file
     * @returns {Promise<{ message: string }>} Standard success response
     */
    importDatabase: async (formData: FormData): Promise<{ message: string }> => {
        const response = await api.post('/admin/database/import', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    },
    /**
     * Fetches the current progress of an asynchronous upload job.
     * @param {string} jobId 
     * @returns {Promise<{ progress: number; status: string }>} Job state data
     */
    getUploadProgress: async (jobId: string): Promise<{ progress: number; status: string }> => {
        const response = await api.get(`/admin/upload-progress/${jobId}`);
        return response.data;
    },
    /**
     * Initiates a Server-Sent Events (SSE) stream for real-time progress.
     * @param {string} progressId 
     * @returns {EventSource} Connection to the SSE endpoint
     */
    getBatchUploadProgressEventSource: (progressId: string): EventSource => {
        const baseUrl = api.defaults.baseURL || '';
        return new EventSource(`${baseUrl}/admin/problems/batch-upload-progress/${progressId}`, { withCredentials: true });
    }
};

export default adminService;
