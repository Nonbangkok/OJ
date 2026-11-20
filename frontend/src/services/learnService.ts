import api from './api';

import type {
  LearnLessonResponse,
  LearnTrackResponse,
  LearnTracksResponse,
  LessonProgressResponse,
} from '../types';

const LESSON_ASSET_PLACEHOLDER = '{{ASSET_BASE}}';

/** URL prefix of a lesson's images (the lesson HTML stores `{{ASSET_BASE}}/<name>`). */
export const lessonAssetBase = (lessonSlug: string): string =>
  `${api.defaults.baseURL ?? ''}/learn/lessons/${encodeURIComponent(lessonSlug)}/assets`;

/** Point the stored lesson HTML's image placeholders at this lesson's asset route. */
export const resolveLessonAssets = (html: string, lessonSlug: string): string =>
  html.split(LESSON_ASSET_PLACEHOLDER).join(lessonAssetBase(lessonSlug));

const learnService = {
  /** Visible tracks with progress counts, plus the next lesson to continue (signed in). */
  getTracks: async (): Promise<LearnTracksResponse> => {
    const response = await api.get<LearnTracksResponse>('/learn/tracks');
    return response.data;
  },

  getTrack: async (trackSlug: string): Promise<LearnTrackResponse> => {
    const response = await api.get<LearnTrackResponse>(`/learn/tracks/${encodeURIComponent(trackSlug)}`);
    return response.data;
  },

  getLesson: async (lessonSlug: string): Promise<LearnLessonResponse> => {
    const response = await api.get<LearnLessonResponse>(`/learn/lessons/${encodeURIComponent(lessonSlug)}`);
    return response.data;
  },

  setCompleted: async (lessonSlug: string, completed: boolean): Promise<LessonProgressResponse> => {
    const response = await api.put<LessonProgressResponse>(
      `/learn/lessons/${encodeURIComponent(lessonSlug)}/progress`,
      { completed },
    );
    return response.data;
  },
};

export default learnService;
