import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom';
import ProblemEditPage from '../../../features/admin/problems/ProblemEditPage';
import adminService from '../../../services/adminService';
import { useAuth } from '../../../context/AuthContext';

jest.mock('../../../services/adminService');
jest.mock('../../../context/AuthContext');

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'P1', title: 'Interval merge', author: 'Ada', categories: ['Sorting'], difficulty: 1400, collection_id: 2,
  time_limit_ms: 1000, memory_limit_mb: 256, has_pdf: true, is_visible: true, contest_id: null,
  problem_type: 'standard', submission_filename: null, submission_count: 214, type_locked: false,
  testcase_count: 10, testcase_bytes: 2_400_000, ...over,
});
const filesInfo = (over = {}) => ({
  problem_type: 'header', submission_filename: 'student.h',
  files: [{ role: 'grader', filename: 'grader.cpp', bytes: 2048 }, { role: 'starter', filename: 'student.h', bytes: 100 }],
  ...over,
});

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
// A data router, like production, so the unsaved-changes blocker works.
const renderAt = (path = '/admin/problems/P1') => render(
  <RouterProvider router={createMemoryRouter([
    { path: '/admin/problems/:problemId/:tab?', element: <><ProblemEditPage /><Where /></> },
    { path: '/admin/problems', element: <Where /> },
  ], { initialEntries: [path] })} />,
);

describe('ProblemEditPage', () => {
  beforeEach(() => {
    jest.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'kru', role: 'admin' } } as ReturnType<typeof useAuth>);
    jest.mocked(adminService.getProblemDetail).mockResolvedValue(detail() as never);
    jest.mocked(adminService.getProblemFiles).mockResolvedValue(filesInfo({ problem_type: 'standard', submission_filename: null, files: [] }) as never);
    jest.mocked(adminService.getAuthors).mockResolvedValue([{ id: 1, username: 'Ada' }] as never);
    jest.mocked(adminService.getCollections).mockResolvedValue([{ id: 2, name: 'Sorting', problem_count: 3, status: 'all_visible' }] as never);
    jest.mocked(adminService.updateProblem).mockResolvedValue({} as never);
  });

  it('header: breadcrumb, title, type tag, meta, View as student and Save; tabs follow the URL', async () => {
    renderAt();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/Interval merge\s*STANDARD/);
    expect(within(screen.getByRole('navigation', { name: /breadcrumb/i })).getByRole('link', { name: 'Problems' })).toHaveAttribute('href', '/admin/problems');
    expect(screen.getByText(/P1 · Visible · in collection Sorting/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View as student' })).toHaveAttribute('href', '/problems/P1');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Statement' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/problems/P1/statement');
    expect(screen.queryByRole('tab', { name: 'Grader files' })).toBeNull();
  });

  it('a type-locked problem says so up front and disables the type fields', async () => {
    jest.mocked(adminService.getProblemDetail).mockResolvedValue(detail({ type_locked: true }) as never);
    renderAt();
    expect(await screen.findByText(/Type locked · 214 submissions\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Header' })).toBeDisabled();
  });

  it('General shows the difficulty → XP hint', async () => {
    renderAt();
    expect(await screen.findByText('800–3500 · sets the XP for a first solve (+46 XP)')).toBeInTheDocument();
    expect(screen.getByLabelText('Time limit (ms)')).toHaveValue(1000);
    expect(screen.getByLabelText('Collection')).toHaveValue('2');
  });

  it('Save is idle until something changes, then sends only the changed fields', async () => {
    renderAt();
    const save = await screen.findByRole('button', { name: 'Save' });
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Interval merge'));
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Interval merging' } });
    fireEvent.click(save);
    await waitFor(() => expect(adminService.updateProblem).toHaveBeenCalledWith('P1', { id: 'P1', title: 'Interval merging' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('a 400 shows the field errors inline', async () => {
    jest.mocked(adminService.updateProblem).mockRejectedValue({
      response: { status: 400, data: { message: 'Validation failed', errors: [{ path: ['title'], message: 'Title is too short' }] } },
    });
    renderAt();
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Interval merge'));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'I' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Title is too short')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
  });

  it('leaving with unsaved changes asks first', async () => {
    renderAt();
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Interval merge'));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed' } });
    fireEvent.click(within(screen.getByRole('navigation', { name: /breadcrumb/i })).getByRole('link', { name: 'Problems' }));
    const dialog = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/problems/P1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin\/problems$/));
  });

  it('switching a standard problem to Header defaults the filename to student.h', async () => {
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Header' }));
    expect(screen.getByLabelText('Submission filename')).toHaveValue('student.h');
  });

  it('shows the lock message when saving a type change is refused with 409', async () => {
    jest.mocked(adminService.getProblemFiles).mockResolvedValue(filesInfo() as never);
    jest.mocked(adminService.getProblemDetail).mockResolvedValue(detail({ problem_type: 'header', submission_filename: 'student.h' }) as never);
    const message = 'Problem type and submission filename cannot change after submissions exist.';
    jest.mocked(adminService.updateProblem).mockRejectedValue({ response: { status: 409, data: { message } } });
    renderAt();
    await waitFor(() => expect(screen.getByLabelText('Submission filename')).toHaveValue('student.h'));
    fireEvent.change(screen.getByLabelText('Submission filename'), { target: { value: 'other.h' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Submission filename')).toBeDisabled());
    expect(adminService.updateProblem).toHaveBeenCalledWith('P1', { id: 'P1', problem_type: 'header', submission_filename: 'other.h' });
    // The locked fields go back to their saved values, so the other edits can still be saved.
    expect(screen.getByLabelText('Submission filename')).toHaveValue('student.h');
    jest.mocked(adminService.updateProblem).mockResolvedValue({} as never);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Interval merging' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(adminService.updateProblem).toHaveBeenLastCalledWith('P1', { id: 'P1', title: 'Interval merging' }));
  });

  it('sends standard with a null filename when a header problem is switched back', async () => {
    jest.mocked(adminService.getProblemFiles).mockResolvedValue(filesInfo() as never);
    jest.mocked(adminService.getProblemDetail).mockResolvedValue(detail({ problem_type: 'header', submission_filename: 'student.h' }) as never);
    renderAt();
    await waitFor(() => expect(screen.getByLabelText('Submission filename')).toHaveValue('student.h'));
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(adminService.updateProblem).toHaveBeenCalled());
    expect(jest.mocked(adminService.updateProblem).mock.calls[0][1]).toEqual({ id: 'P1', problem_type: 'standard', submission_filename: null });
  });

  it('visibility is a dot with a Hide button behind a plain confirm', async () => {
    jest.mocked(adminService.updateProblemVisibility).mockResolvedValue({ message: 'ok' });
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Hide' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hide Interval merge?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hide problem' }));
    await waitFor(() => expect(adminService.updateProblemVisibility).toHaveBeenCalledWith('P1', false));
    expect(await screen.findByText(/P1 · Hidden/)).toBeInTheDocument();
  });

  it('Statement tab replaces the PDF', async () => {
    jest.mocked(adminService.uploadFiles).mockResolvedValue({} as never);
    renderAt('/admin/problems/P1/statement');
    expect(await screen.findByRole('link', { name: 'Open current PDF' })).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'statement.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(adminService.uploadFiles).toHaveBeenCalledWith('P1', expect.any(FormData)));
    expect((jest.mocked(adminService.uploadFiles).mock.calls[0][1] as FormData).get('problemPdf')).toBeInstanceOf(File);
    expect(await screen.findByRole('status')).toHaveTextContent('Statement replaced');
  });

  it('Testcases and Grader files tabs render inside the editor', async () => {
    jest.mocked(adminService.getProblemTestcases).mockResolvedValue({ testcases: [{ case_number: 1, input_bytes: 10, output_bytes: 5 }], total: 1 });
    jest.mocked(adminService.getProblemDetail).mockResolvedValue(detail({ problem_type: 'header', submission_filename: 'student.h' }) as never);
    jest.mocked(adminService.getProblemFiles).mockResolvedValue(filesInfo() as never);
    renderAt('/admin/problems/P1/testcases');
    expect(await screen.findByText('1 testcase · 15 B')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Grader files' }));
    expect(await screen.findByText('grader.cpp')).toBeInTheDocument();
  });

  it('Danger zone deletes with a typed confirm naming submissions', async () => {
    jest.mocked(adminService.deleteProblem).mockResolvedValue({ message: 'ok' });
    renderAt('/admin/problems/P1/danger');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete problem' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Interval merge?' });
    expect(dialog).toHaveTextContent('214 submissions go with it');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'P1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete problem' }));
    await waitFor(() => expect(adminService.deleteProblem).toHaveBeenCalledWith('P1'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin\/problems$/));
  });
});
