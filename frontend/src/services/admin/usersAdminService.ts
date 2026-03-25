import api from '../api';

import type {
  AdminAuthorsResponse,
  AdminCreateUserResponse,
  AdminUpdateUserResponse,
  AdminUsersResponse,
  ApiMessageResponse,
  BatchCreateUsersResponse,
} from '../../types';
import type { BatchCreateUsersRequest, CreateUserRequest, UpdateUserRequest } from '../../types';

const usersAdminService = {
  getUsers: async (): Promise<AdminUsersResponse> => {
    const response = await api.get<AdminUsersResponse>('/admin/users');
    return response.data;
  },

  createUser: async (userData: CreateUserRequest): Promise<AdminCreateUserResponse> => {
    const response = await api.post<AdminCreateUserResponse>('/admin/users', userData);
    return response.data;
  },

  updateUser: async (
    userId: string | number,
    userData: UpdateUserRequest,
  ): Promise<AdminUpdateUserResponse> => {
    const response = await api.put<AdminUpdateUserResponse>(`/admin/users/${userId}`, userData);
    return response.data;
  },

  getAuthors: async (): Promise<AdminAuthorsResponse> => {
    const response = await api.get<AdminAuthorsResponse>('/admin/authors');
    return response.data;
  },

  deleteUser: async (userId: string | number): Promise<ApiMessageResponse> => {
    const response = await api.delete<ApiMessageResponse>(`/admin/users/${userId}`);
    return response.data;
  },

  createBatchUsers: async (batchData: BatchCreateUsersRequest): Promise<BatchCreateUsersResponse> => {
    const response = await api.post<BatchCreateUsersResponse>('/admin/users/batch', batchData);
    return response.data;
  },
};

export default usersAdminService;
