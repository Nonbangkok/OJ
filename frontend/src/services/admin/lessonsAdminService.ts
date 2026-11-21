import axios from 'axios';

import api from '../api';

import type { AdminLessonOverview, LessonImportOutcome, LessonImportPlan } from '../../types';

/** Manage › Lessons (staff/admin). */
const lessonsAdminService = {
  getLessonOverview: async (): Promise<AdminLessonOverview> => {
    const response = await api.get<AdminLessonOverview>('/admin/lessons');
    return response.data;
  },

  /**
   * Upload a bundle. A dry run only previews; a real import answers 400 when the
   * bundle has problems and 409 when it would delete completed lessons — both are
   * returned as outcomes (with the plan) rather than thrown. Other failures throw.
   */
  importLessonBundle: async (
    file: File,
    options: { dryRun: boolean; confirmRemovals?: boolean },
  ): Promise<LessonImportOutcome> => {
    const form = new FormData();
    form.append('bundle', file);
    const params: Record<string, string> = {};
    if (options.dryRun) params.dryRun = '1';
    if (options.confirmRemovals) params.confirmRemovals = '1';
    try {
      const response = await api.post<{ plan: LessonImportPlan; importId?: number }>('/admin/lessons/import', form, { params });
      if (options.dryRun || response.data.importId === undefined) return { kind: 'preview', plan: response.data.plan };
      return { kind: 'imported', plan: response.data.plan, importId: response.data.importId };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.plan) {
        const { plan, message } = error.response.data as { plan: LessonImportPlan; message: string };
        if (error.response.status === 400) return { kind: 'invalid', plan, message };
        if (error.response.status === 409) return { kind: 'needs_confirmation', plan, message };
      }
      throw error;
    }
  },

  setLessonTrackVisibility: async (trackId: number, isVisible: boolean): Promise<{ id: number; isVisible: boolean }> => {
    const response = await api.patch<{ id: number; isVisible: boolean }>(`/admin/lessons/tracks/${trackId}`, { isVisible });
    return response.data;
  },
};

export default lessonsAdminService;
