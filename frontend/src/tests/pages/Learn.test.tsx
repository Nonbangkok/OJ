import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '../../components/ui';
import LearnHome from '../../pages/learn/LearnHome';
import TrackPage from '../../pages/learn/TrackPage';
import LessonPage from '../../pages/learn/LessonPage';
import learnService from '../../services/learnService';
import type { LearnLessonResponse, LearnTrackResponse, LearnTracksResponse } from '../../types';

jest.mock('../../services/learnService', () => {
  const actual = jest.requireActual('../../services/learnService');
  return {
    __esModule: true,
    ...actual,
    default: { getTracks: jest.fn(), getTrack: jest.fn(), getLesson: jest.fn(), setCompleted: jest.fn() },
  };
});

type MockUser = { id: number; username: string; role: 'user' | 'staff' | 'admin'; hasAvatar: boolean } | null;
let mockUser: MockUser = { id: 1, username: 'nattapat', role: 'user', hasAvatar: false };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, isLoading: false, login: jest.fn(), logout: jest.fn() }),
}));

const service = jest.mocked(learnService);

const notFound = () => {
  const error = new AxiosError('Not found', 'ERR_BAD_REQUEST');
  error.response = { status: 404, data: { message: 'Lesson not found.' }, statusText: '', headers: {}, config: {} } as AxiosResponse;
  return error;
};

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

const renderAt = (path: string) => render(
  <ToastProvider>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/learn" element={<LearnHome />} />
        <Route path="/learn/:trackSlug" element={<TrackPage />} />
        <Route path="/learn/:trackSlug/:lessonSlug" element={<LessonPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>
  </ToastProvider>,
);

const tracks: LearnTracksResponse = {
  tracks: [
    { slug: 'foundations', title: 'Foundations', description: 'พื้นฐานที่ใช้บ่อย', isVisible: true, moduleCount: 2, lessonCount: 5, completedCount: 2 },
    { slug: 'graphs', title: 'Graphs', description: null, isVisible: false, moduleCount: 1, lessonCount: 1, completedCount: 0 },
  ],
  continueLesson: { trackSlug: 'foundations', trackTitle: 'Foundations', moduleTitle: 'Complexity', lessonSlug: 'prefix-sums', lessonTitle: 'Prefix Sums', minutes: 12 },
};

const track: LearnTrackResponse = {
  track: { slug: 'foundations', title: 'Foundations', description: 'พื้นฐานที่ใช้บ่อย', isVisible: true },
  modules: [{
    slug: 'complexity', title: 'Complexity', summary: 'นับเวลาให้เป็น',
    lessons: [
      { slug: 'time-complexity', title: 'Time Complexity', summary: null, minutes: 8, completed: true, problemCount: 1, solvedCount: 1 },
      { slug: 'prefix-sums', title: 'Prefix Sums', summary: 'ผลรวมช่วงใน O(1)', minutes: 12, completed: false, problemCount: 3, solvedCount: 1 },
    ],
  }],
};

const lesson = (overrides: Partial<LearnLessonResponse['lesson']> = {}): LearnLessonResponse => ({
  lesson: {
    slug: 'prefix-sums', title: 'Prefix Sums', summary: null, minutes: 12,
    html: '<h2 id="section-1">ไอเดีย</h2><p>เตรียมไว้ก่อนเลย</p><div data-lesson="problem" data-problem="P0002"></div>',
    toc: [{ id: 'section-1', text: 'ไอเดีย', level: 2 }], updatedAt: '2026-11-18T10:00:00Z', completed: false, ...overrides,
  },
  track: { slug: 'foundations', title: 'Foundations' },
  module: { slug: 'complexity', title: 'Complexity', lessonCount: 2, completedCount: 1 },
  previous: { slug: 'time-complexity', title: 'Time Complexity' },
  next: null,
  problems: [
    { position: 1, role: 'example', available: true, id: 'P0002', title: 'Range Sum', difficulty: 900, problemType: 'standard', status: 'solved', bestScore: 100, caseStatuses: ['Accepted', 'Accepted'] },
    { position: 2, role: 'practice', available: false, id: null, title: null, difficulty: null, problemType: null, status: null, bestScore: null, caseStatuses: null },
  ],
});

beforeEach(() => {
  mockUser = { id: 1, username: 'nattapat', role: 'user', hasAvatar: false };
  // Pages a test navigates to keep loading unless the test says otherwise.
  const pending = () => new Promise<never>(() => {});
  service.getTracks.mockImplementation(pending);
  service.getTrack.mockImplementation(pending);
  service.getLesson.mockImplementation(pending);
});

describe('LearnHome', () => {
  it('lists tracks with progress and continues the next lesson', async () => {
    service.getTracks.mockResolvedValue(tracks);
    renderAt('/learn');
    expect(await screen.findByRole('heading', { name: 'Learn' })).toBeInTheDocument();
    expect(await screen.findByText('2 / 6 lessons completed')).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getByRole('link', { name: /Foundations/ })).toHaveAttribute('href', '/learn/foundations');
    expect(within(list).getByText('Hidden')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/learn/foundations/prefix-sums');
  });

  it('shows guests the tracks with a log-in hint and no progress', async () => {
    mockUser = null;
    service.getTracks.mockResolvedValue({
      tracks: tracks.tracks.map((t) => ({ ...t, completedCount: null })),
      continueLesson: null,
    });
    renderAt('/learn');
    expect(await screen.findByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login?returnTo=%2Flearn');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('offers a first track to a learner who has not started', async () => {
    service.getTracks.mockResolvedValue({ tracks: tracks.tracks.map((t) => ({ ...t, completedCount: 0 })), continueLesson: null });
    renderAt('/learn');
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/learn/foundations');
  });

  it('points staff at the import page when there are no lessons', async () => {
    mockUser = { id: 2, username: 'pim', role: 'staff', hasAvatar: false };
    service.getTracks.mockResolvedValue({ tracks: [], continueLesson: null });
    renderAt('/learn');
    expect(await screen.findByRole('link', { name: 'Manage › Lessons' })).toHaveAttribute('href', '/admin/lessons');
  });

  it('retries after a failed load', async () => {
    service.getTracks.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(tracks);
    renderAt('/learn');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Foundations', { selector: 'span' })).toBeInTheDocument();
  });
});

describe('TrackPage', () => {
  it('shows modules and lessons with completion and solved counts', async () => {
    service.getTrack.mockResolvedValue(track);
    renderAt('/learn/foundations');
    expect(await screen.findByRole('heading', { name: 'Foundations', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText('1 / 2 completed')).toHaveLength(2);
    const row = screen.getByRole('link', { name: /Time Complexity/ });
    expect(row).toHaveAttribute('href', '/learn/foundations/time-complexity');
    expect(row).toHaveTextContent('(completed)');
    expect(screen.getByRole('link', { name: /Prefix Sums/ })).toHaveTextContent('Solved 1 / 3');
    expect(service.getTrack).toHaveBeenCalledWith('foundations');
  });

  it('shows problem counts to guests', async () => {
    service.getTrack.mockResolvedValue({
      ...track,
      modules: track.modules.map((m) => ({ ...m, lessons: m.lessons.map((l) => ({ ...l, completed: null, solvedCount: null })) })),
    });
    renderAt('/learn/foundations');
    expect(await screen.findByRole('link', { name: /Prefix Sums/ })).toHaveTextContent('3 problems');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('says when a track does not exist', async () => {
    service.getTrack.mockRejectedValue(notFound());
    renderAt('/learn/nope');
    expect(await screen.findByText('Track not found')).toBeInTheDocument();
  });
});

describe('LessonPage', () => {
  it('renders the lesson, its problems and the table of contents', async () => {
    service.getLesson.mockResolvedValue(lesson());
    renderAt('/learn/foundations/prefix-sums');
    expect(await screen.findByRole('heading', { name: 'Prefix Sums', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('12 min read · 2 problems · Updated 18 Nov 2026')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'On this page' })).toHaveTextContent('ไอเดีย');
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: 'Range Sum' })).toHaveAttribute('href', '/problems/P0002');
    expect(within(table).getByText('Problem unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous lesson: Time Complexity' })).toHaveAttribute('href', '/learn/foundations/time-complexity');
    expect(screen.getByText('Solved 1 / 2')).toBeInTheDocument();
  });

  it('marks the lesson complete and can undo it', async () => {
    service.getLesson.mockResolvedValue(lesson());
    service.setCompleted.mockResolvedValue({ completed: true, completedAt: '2026-11-20T00:00:00Z' });
    renderAt('/learn/foundations/prefix-sums');
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as completed' }));
    expect(await screen.findByRole('button', { name: 'Mark as not completed' })).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('2 / 2 completed')).toBeInTheDocument();
    expect(service.setCompleted).toHaveBeenCalledWith('prefix-sums', true);
  });

  it('rolls back and says so when saving fails', async () => {
    service.getLesson.mockResolvedValue(lesson());
    service.setCompleted.mockRejectedValue(new Error('offline'));
    renderAt('/learn/foundations/prefix-sums');
    const button = await screen.findByRole('button', { name: 'Mark as completed' });
    await act(async () => { fireEvent.click(button); });
    expect(await screen.findByText("Couldn't save your progress. Try again.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark as completed' })).toBeEnabled());
    expect(screen.queryByText('Completed')).toBeNull();
  });

  it('asks guests to log in instead of offering completion', async () => {
    mockUser = null;
    service.getLesson.mockResolvedValue({ ...lesson({ completed: null }), module: { ...lesson().module, completedCount: null } });
    renderAt('/learn/foundations/prefix-sums');
    expect(await screen.findByRole('link', { name: 'Log in to save progress' }))
      .toHaveAttribute('href', '/login?returnTo=%2Flearn%2Ffoundations%2Fprefix-sums');
    expect(screen.queryByRole('button', { name: /Mark as/ })).toBeNull();
  });

  it('moves an old link to the lesson’s current track', async () => {
    service.getLesson.mockResolvedValue(lesson());
    renderAt('/learn/old-track/prefix-sums');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/learn/foundations/prefix-sums'));
  });

  it('shows staff why a problem is unavailable', async () => {
    mockUser = { id: 2, username: 'pim', role: 'staff', hasAvatar: false };
    const data = lesson();
    data.problems[1] = { ...data.problems[1], id: 'P0003', title: 'Subarray Sum K', unavailableReason: 'in_contest', status: 'not_tried', caseStatuses: [] };
    service.getLesson.mockResolvedValue(data);
    renderAt('/learn/foundations/prefix-sums');
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: 'Subarray Sum K' })).toBeInTheDocument();
    expect(within(table).getByText('In a contest')).toBeInTheDocument();
  });

  it('says when a lesson does not exist', async () => {
    service.getLesson.mockRejectedValue(notFound());
    renderAt('/learn/foundations/nope');
    expect(await screen.findByText('Lesson not found')).toBeInTheDocument();
  });
});
