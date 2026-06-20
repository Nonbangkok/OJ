import api, { getLargeUploadBaseUrl } from '../../services/api';
import adminService from '../../services/adminService';
import type { AxiosResponse } from 'axios';
import type {
    AdminProblemDetailResponse,
    AdminUsersResponse,
    ApiMessageResponse,
    ContestProblemsMutationResponse,
    RegistrationSettingsUpdateResponse,
    UpdateUserRequest,
} from '../../types';

jest.mock('../../services/api');

describe('adminService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('User Management', () => {
        it('getUsers calls api.get with correct path', async () => {
            const mockData: AdminUsersResponse = [{ id: 1, username: 'admin', role: 'admin' }];
            jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });
            const result = await adminService.getUsers();
            expect(api.get).toHaveBeenCalledWith('/admin/users');
            expect(result).toEqual(mockData);
        });

        it('createUser calls api.post with correct data', async () => {
            const userData = { username: 'newuser', password: 'password123' };
            jest.mocked(api.post).mockResolvedValueOnce({ data: { id: 2, ...userData } });
            const result = await adminService.createUser(userData);
            expect(api.post).toHaveBeenCalledWith('/admin/users', userData);
            expect(result.username).toBe('newuser');
        });

        it('updateUser calls api.put with correct path and data', async () => {
            const userData: UpdateUserRequest = { username: 'existing-user', role: 'staff' };
            jest.mocked(api.put).mockResolvedValueOnce({ data: { id: 1, ...userData } });
            const result = await adminService.updateUser(1, userData);
            expect(api.put).toHaveBeenCalledWith('/admin/users/1', userData);
            expect(result.role).toBe('staff');
        });

        it('deleteUser calls api.delete with correct path', async () => {
            const response: ApiMessageResponse = { message: 'Deleted' };
            jest.mocked(api.delete).mockResolvedValueOnce({ data: response });
            await adminService.deleteUser(1);
            expect(api.delete).toHaveBeenCalledWith('/admin/users/1');
        });
    });

    describe('Problem Management', () => {
        it('getProblems calls api.get with correct path', async () => {
            jest.mocked(api.get).mockResolvedValueOnce({ data: [] });
            await adminService.getProblems();
            expect(api.get).toHaveBeenCalledWith('/admin/problems');
        });

        it('updateProblemVisibility calls api.put with correct body', async () => {
            const response: ApiMessageResponse = { message: 'Updated' };
            jest.mocked(api.put).mockResolvedValueOnce({ data: response });
            await adminService.updateProblemVisibility(10, true);
            expect(api.put).toHaveBeenCalledWith('/admin/problems/10/visibility', { isVisible: true });
        });

        it('getProblemDetail calls api.get with correct path', async () => {
            const detail: AdminProblemDetailResponse = {
                id: 'P1',
                title: 'Problem 1',
                author: 'admin',
                time_limit_ms: 1000,
                memory_limit_mb: 256,
            };
            jest.mocked(api.get).mockResolvedValueOnce({ data: detail });
            const result = await adminService.getProblemDetail('P1');
            expect(api.get).toHaveBeenCalledWith('/admin/problems/P1');
            expect(result.id).toBe('P1');
        });

        it('exportProblems calls api.post and returns full response', async () => {
            const mockResponse = {
                data: new Blob(['blob-data']),
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/zip' },
                config: { headers: {} },
            } as unknown as AxiosResponse<Blob>;
            jest.mocked(api.post).mockResolvedValueOnce(mockResponse);
            const result = await adminService.exportProblems(['1', '2']);
            expect(api.post).toHaveBeenCalledWith('/admin/problems/export', { problemIds: ['1', '2'] }, { responseType: 'blob' });
            expect(result).toBe(mockResponse);
        });
    });

    describe('Contest Management', () => {
        it('getContests calls api.get', async () => {
            jest.mocked(api.get).mockResolvedValueOnce({ data: [] });
            await adminService.getContests();
            expect(api.get).toHaveBeenCalledWith('/admin/contests');
        });

        it('migrateContestProblems calls api.post with correct action', async () => {
            const response: ContestProblemsMutationResponse = { message: 'Migrated' };
            jest.mocked(api.post).mockResolvedValueOnce({ data: response });
            await adminService.migrateContestProblems(5, ['1', '2'], 'move_to_contest');
            expect(api.post).toHaveBeenCalledWith('/admin/contests/5/problems', {
                problemIds: ['1', '2'],
                action: 'move_to_contest'
            });
        });
    });

    describe('Settings & Database', () => {
        it('getRegistrationSettings calls api.get', async () => {
            jest.mocked(api.get).mockResolvedValueOnce({ data: { enabled: true } });
            const result = await adminService.getRegistrationSettings();
            expect(api.get).toHaveBeenCalledWith('/admin/settings/registration');
            expect(result.enabled).toBe(true);
        });

        it('exportDatabase calls api.post with responseType blob', async () => {
            const response = {
                data: new Blob(['sql-dump']),
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/sql' },
                config: { headers: {} },
            } as unknown as AxiosResponse<Blob>;
            jest.mocked(api.post).mockResolvedValueOnce(response);
            await adminService.exportDatabase();
            expect(api.post).toHaveBeenCalledWith('/admin/database/export', {}, { responseType: 'blob' });
        });

        it('getBatchUploadProgressEventSource returns EventSource with correct URL', () => {
            const originalEventSource = globalThis.EventSource;
            const mockEventSource = jest.fn() as unknown as typeof EventSource;
            globalThis.EventSource = mockEventSource;

            jest.mocked(getLargeUploadBaseUrl).mockReturnValue('http://api.test');
            const progressId = 'test-id';

            adminService.getBatchUploadProgressEventSource(progressId);

            expect(mockEventSource).toHaveBeenCalledWith(
                'http://api.test/admin/problems/batch-upload-progress/test-id',
                { withCredentials: true }
            );

            globalThis.EventSource = originalEventSource;
        });
    });
});
