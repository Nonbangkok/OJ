import api from './api';

import type { HomeSummary } from '../types';

const homeService = {
  /** Everything the logged-in Home page shows, in one call. */
  getHome: async (): Promise<HomeSummary> => {
    const response = await api.get<HomeSummary>('/me/home');
    return response.data;
  },
};

export default homeService;
