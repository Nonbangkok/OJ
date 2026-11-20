import { AxiosError, type AxiosResponse } from 'axios';
import api from '../../services/api';
import learnService, { lessonAssetBase, resolveLessonAssets } from '../../services/learnService';
import lessonsAdminService from '../../services/admin/lessonsAdminService';
import type { LessonImportPlan } from '../../types';

jest.mock('../../services/api');

const plan: LessonImportPlan = {
  bundleSha256: 'a'.repeat(64),
  sourceCommit: 'a1b2c3d',
  lessons: { added: [], changed: [], removed: [], unchanged: 2 },
  tracks: { added: [], removed: [] },
  issues: [],
};

const httpError = (status: number, data: unknown) => {
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST');
  error.response = { status, data, statusText: '', headers: {}, config: {} } as AxiosResponse;
  return error;
};

describe('learnService', () => {
  it('reads tracks, a track and a lesson by slug', async () => {
    jest.mocked(api.get).mockResolvedValue({ data: { ok: true } });
    await learnService.getTracks();
    await learnService.getTrack('foundations');
    await learnService.getLesson('prefix-sums');
    expect(api.get).toHaveBeenNthCalledWith(1, '/learn/tracks');
    expect(api.get).toHaveBeenNthCalledWith(2, '/learn/tracks/foundations');
    expect(api.get).toHaveBeenNthCalledWith(3, '/learn/lessons/prefix-sums');
  });

  it('marks a lesson complete', async () => {
    jest.mocked(api.put).mockResolvedValueOnce({ data: { completed: true, completedAt: '2026-11-20T00:00:00Z' } });
    await expect(learnService.setCompleted('prefix-sums', true)).resolves.toEqual({ completed: true, completedAt: '2026-11-20T00:00:00Z' });
    expect(api.put).toHaveBeenCalledWith('/learn/lessons/prefix-sums/progress', { completed: true });
  });

  it('resolves the asset placeholder to the lesson asset route', () => {
    const html = '<img src="{{ASSET_BASE}}/a.png"><img src="{{ASSET_BASE}}/b.png">';
    const base = lessonAssetBase('prefix-sums');
    expect(base.endsWith('/learn/lessons/prefix-sums/assets')).toBe(true);
    expect(resolveLessonAssets(html, 'prefix-sums')).toBe(`<img src="${base}/a.png"><img src="${base}/b.png">`);
  });
});

describe('lessonsAdminService', () => {
  const file = new File(['zip'], 'lessons-bundle.zip', { type: 'application/zip' });

  it('loads the overview and toggles a track', async () => {
    jest.mocked(api.get).mockResolvedValueOnce({ data: { tracks: [], imports: [] } });
    await expect(lessonsAdminService.getLessonOverview()).resolves.toEqual({ tracks: [], imports: [] });
    expect(api.get).toHaveBeenCalledWith('/admin/lessons');

    jest.mocked(api.patch).mockResolvedValueOnce({ data: { id: 3, isVisible: false } });
    await lessonsAdminService.setLessonTrackVisibility(3, false);
    expect(api.patch).toHaveBeenCalledWith('/admin/lessons/tracks/3', { isVisible: false });
  });

  it('previews with dryRun=1 and imports with the confirm flag', async () => {
    jest.mocked(api.post).mockResolvedValueOnce({ data: { dryRun: true, plan } });
    await expect(lessonsAdminService.importLessonBundle(file, { dryRun: true })).resolves.toEqual({ kind: 'preview', plan });
    const [url, form, config] = jest.mocked(api.post).mock.calls[0];
    expect(url).toBe('/admin/lessons/import');
    expect((form as FormData).get('bundle')).toBeInstanceOf(File);
    expect(config).toEqual({ params: { dryRun: '1' } });

    jest.mocked(api.post).mockResolvedValueOnce({ data: { importId: 9, plan } });
    await expect(lessonsAdminService.importLessonBundle(file, { dryRun: false, confirmRemovals: true }))
      .resolves.toEqual({ kind: 'imported', plan, importId: 9 });
    expect(jest.mocked(api.post).mock.calls[1][2]).toEqual({ params: { confirmRemovals: '1' } });
  });

  it('returns invalid / needs_confirmation outcomes and rethrows other errors', async () => {
    jest.mocked(api.post).mockRejectedValueOnce(httpError(400, { message: 'bad', plan }));
    await expect(lessonsAdminService.importLessonBundle(file, { dryRun: false })).resolves.toEqual({ kind: 'invalid', plan, message: 'bad' });

    jest.mocked(api.post).mockRejectedValueOnce(httpError(409, { message: 'confirm', plan }));
    await expect(lessonsAdminService.importLessonBundle(file, { dryRun: false }))
      .resolves.toEqual({ kind: 'needs_confirmation', plan, message: 'confirm' });

    const unreadable = httpError(400, { message: 'The upload is not a readable ZIP file.' });
    jest.mocked(api.post).mockRejectedValueOnce(unreadable);
    await expect(lessonsAdminService.importLessonBundle(file, { dryRun: true })).rejects.toBe(unreadable);

    const conflict = httpError(409, { message: 'A database import is running.' });
    jest.mocked(api.post).mockRejectedValueOnce(conflict);
    await expect(lessonsAdminService.importLessonBundle(file, { dryRun: false })).rejects.toBe(conflict);

    const server = httpError(500, { message: 'oops', plan });
    jest.mocked(api.post).mockRejectedValueOnce(server);
    await expect(lessonsAdminService.importLessonBundle(file, { dryRun: false })).rejects.toBe(server);
  });
});
