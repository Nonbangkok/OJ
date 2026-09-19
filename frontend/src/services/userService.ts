import api from './api';

import type { UserProfileResponse, UpdateAvatarResponse } from '../types';

const userService = {
  getProfile: async (username: string): Promise<UserProfileResponse> => {
    const response = await api.get<UserProfileResponse>(`/users/${username}/profile`);
    return response.data;
  },

  updateAvatar: async (avatarPng: Blob): Promise<UpdateAvatarResponse> => {
    const body = new FormData();
    body.append('avatar', avatarPng, 'avatar.png');
    const response = await api.put<UpdateAvatarResponse>('/profile/avatar', body, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
};

export default userService;
