import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProblemTestcasesTab from '../../../features/admin/problems/ProblemTestcasesTab';
import ProblemGraderTab from '../../../features/admin/problems/ProblemGraderTab';
import adminService from '../../../services/adminService';
import { countZipTestcases } from '../../../features/admin/problems/countZipTestcases';

jest.mock('../../../services/adminService');
jest.mock('../../../features/admin/problems/countZipTestcases', () => ({ countZipTestcases: jest.fn() }));

const cases = (n: number) => Array.from({ length: n }, (_, i) => ({ case_number: i + 1, input_bytes: 120_000, output_bytes: 120_000 }));
const side = (content: string) => ({ content, truncated: false, bytes: content.length });
const zip = () => new File(['PK'], 'new.zip', { type: 'application/zip' });
const drop = () => fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [zip()] } });

describe('ProblemTestcasesTab', () => {
  beforeEach(() => {
    jest.mocked(adminService.getProblemTestcases).mockResolvedValue({ testcases: cases(10), total: 10 });
    jest.mocked(adminService.uploadFiles).mockResolvedValue({ message: 'ok', jobId: 'j1' } as never);
    jest.mocked(adminService.getUploadProgress).mockResolvedValue({ status: 'completed', message: 'done' });
    jest.mocked(adminService.rejudgeProblem).mockResolvedValue({ message: 'ok' } as never);
    jest.mocked(countZipTestcases).mockResolvedValue(12);
  });

  it('summarises the set and lists each case with its sizes', async () => {
    render(<ProblemTestcasesTab problemId="P1" submissionCount={214} canRejudge />);
    expect(await screen.findByText('10 testcases · 2.4 MB')).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(11);
    expect(rows[1]).toHaveTextContent(/1\s*120 kB\s*120 kB\s*240 kB/);
    expect(adminService.getProblemTestcase).not.toHaveBeenCalled();
  });

  it('View opens a dialog with the start of the input and output', async () => {
    jest.mocked(adminService.getProblemTestcase).mockResolvedValue({
      case_number: 3, input: side('1 2\n'), output: { content: 'x'.repeat(5000), truncated: false, bytes: 5000 },
    } as never);
    render(<ProblemTestcasesTab problemId="P1" submissionCount={0} canRejudge />);
    fireEvent.click(await screen.findByRole('button', { name: 'View case 3' }));
    const dialog = await screen.findByRole('dialog', { name: 'Case 3' });
    await waitFor(() => expect(within(dialog).getByLabelText('Input of case 3')).toHaveTextContent('1 2'));
    expect(within(dialog).getByLabelText('Output of case 3').textContent).toHaveLength(4096);
    expect(dialog).toHaveTextContent('Showing the first 4 KB of 5.0 kB');
    expect(adminService.getProblemTestcase).toHaveBeenCalledWith('P1', 3);
  });

  it('shows the empty state when the problem has no testcases', async () => {
    jest.mocked(adminService.getProblemTestcases).mockResolvedValue({ testcases: [], total: 0 });
    render(<ProblemTestcasesTab problemId="P1" submissionCount={0} canRejudge />);
    expect(await screen.findByText('No testcases yet. Submissions to this problem can’t be judged.')).toBeInTheDocument();
  });

  it('with earlier submissions: confirm names them, rejudge is on, and the primary replaces then rejudges', async () => {
    render(<ProblemTestcasesTab problemId="P1" submissionCount={214} canRejudge />);
    await screen.findByText('10 testcases · 2.4 MB');
    expect(screen.getByText('Replace all testcases — drop a ZIP of N.in / N.out pairs')).toBeInTheDocument();
    drop();
    const dialog = await screen.findByRole('dialog', { name: 'Replace 10 testcases with 12?' });
    expect(dialog).toHaveTextContent('214 earlier submissions');
    expect(within(dialog).getByRole('switch', { name: 'Rejudge after replacing' })).toBeChecked();
    jest.mocked(adminService.getProblemTestcases).mockResolvedValue({ testcases: cases(12), total: 12 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace and rejudge' }));
    await waitFor(() => expect(adminService.rejudgeProblem).toHaveBeenCalledWith('P1'));
    const sent = jest.mocked(adminService.uploadFiles).mock.calls[0];
    expect(sent[0]).toBe('P1');
    expect((sent[1] as FormData).get('testcasesZip')).toBeInstanceOf(File);
    expect(adminService.getUploadProgress).toHaveBeenCalledWith('j1');
    expect(await screen.findByText('12 testcases · 2.9 MB')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Replaced with 12 testcases. Rejudging 214 submissions.');
  });

  it('turning rejudge off replaces only', async () => {
    render(<ProblemTestcasesTab problemId="P1" submissionCount={214} canRejudge />);
    await screen.findByText('10 testcases · 2.4 MB');
    drop();
    const dialog = await screen.findByRole('dialog', { name: 'Replace 10 testcases with 12?' });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Rejudge after replacing' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace testcases' }));
    await waitFor(() => expect(adminService.uploadFiles).toHaveBeenCalled());
    await screen.findByRole('status');
    expect(adminService.rejudgeProblem).not.toHaveBeenCalled();
  });

  it('with no submissions there is no rejudge row', async () => {
    render(<ProblemTestcasesTab problemId="P1" submissionCount={0} canRejudge />);
    await screen.findByText('10 testcases · 2.4 MB');
    drop();
    const dialog = await screen.findByRole('dialog', { name: 'Replace 10 testcases with 12?' });
    expect(within(dialog).queryByRole('switch')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Replace testcases' })).toBeInTheDocument();
  });

  it('staff cannot rejudge, so the confirm says who can', async () => {
    render(<ProblemTestcasesTab problemId="P1" submissionCount={214} canRejudge={false} />);
    await screen.findByText('10 testcases · 2.4 MB');
    drop();
    const dialog = await screen.findByRole('dialog', { name: 'Replace 10 testcases with 12?' });
    expect(within(dialog).queryByRole('switch')).toBeNull();
    expect(dialog).toHaveTextContent('An admin can rejudge them afterwards.');
  });

  it('a ZIP with no pairs is refused before anything uploads', async () => {
    jest.mocked(countZipTestcases).mockResolvedValue(0);
    render(<ProblemTestcasesTab problemId="P1" submissionCount={214} canRejudge />);
    await screen.findByText('10 testcases · 2.4 MB');
    drop();
    expect(await screen.findByRole('alert')).toHaveTextContent('No N.in / N.out pairs found in new.zip.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(adminService.uploadFiles).not.toHaveBeenCalled();
  });

  it('a rejudge that fails after a good replace keeps the success and says only the rejudge failed', async () => {
    jest.mocked(adminService.rejudgeProblem).mockRejectedValue({ response: { status: 500, data: { message: 'Judge queue unavailable' } } });
    render(<ProblemTestcasesTab problemId="P1" submissionCount={214} canRejudge />);
    await screen.findByText('10 testcases · 2.4 MB');
    jest.mocked(adminService.getProblemTestcases).mockResolvedValue({ testcases: cases(12), total: 12 });
    drop();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace and rejudge' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Replaced with 12 testcases.');
    expect(screen.getByRole('alert')).toHaveTextContent("The rejudge didn't start: Judge queue unavailable");
    expect(screen.getByRole('alert')).not.toHaveTextContent(/Replacing the testcases failed/);
  });

  it('a failed processing job shows its message and skips the rejudge', async () => {
    jest.mocked(adminService.getUploadProgress).mockResolvedValue({ status: 'failed', message: 'Case 3 has no output file.' });
    render(<ProblemTestcasesTab problemId="P1" submissionCount={214} canRejudge />);
    await screen.findByText('10 testcases · 2.4 MB');
    drop();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace and rejudge' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Case 3 has no output file.');
    expect(adminService.rejudgeProblem).not.toHaveBeenCalled();
  });
});

describe('ProblemGraderTab', () => {
  const filesInfo = (over = {}) => ({
    problem_type: 'header' as const,
    submission_filename: 'student.h',
    files: [{ role: 'grader' as const, filename: 'grader.cpp', bytes: 2048 }, { role: 'starter' as const, filename: 'student.h', bytes: 100 }],
    ...over,
  });

  it('lists current files and replaces a role with the uploaded ZIP, then re-lists', async () => {
    jest.mocked(adminService.getProblemFiles)
      .mockResolvedValueOnce(filesInfo())
      .mockResolvedValueOnce(filesInfo({ files: [{ role: 'grader', filename: 'new.cpp', bytes: 5 }] }));
    jest.mocked(adminService.replaceProblemFiles).mockResolvedValue({ message: 'ok' } as never);
    render(<ProblemGraderTab problemId="P1" submissionCount={0} canRejudge />);
    expect(await screen.findByText('grader.cpp')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    const file = new File(['zip'], 'grader.zip', { type: 'application/zip' });
    await userEvent.upload(screen.getByLabelText('Replace all grader files'), file);
    await waitFor(() => expect(adminService.replaceProblemFiles).toHaveBeenCalledWith('P1', 'grader', file));
    expect(await screen.findByText('new.cpp')).toBeInTheDocument();
    expect(screen.queryByText('grader.cpp')).not.toBeInTheDocument();
  });

  it('shows the API message inline when an upload is rejected', async () => {
    jest.mocked(adminService.getProblemFiles).mockResolvedValue(filesInfo());
    jest.mocked(adminService.replaceProblemFiles).mockRejectedValue({
      response: { status: 400, data: { message: 'Grader files need at least one .cpp file.' } },
    });
    render(<ProblemGraderTab problemId="P1" submissionCount={0} canRejudge />);
    await screen.findByText('grader.cpp');
    await userEvent.upload(screen.getByLabelText('Replace all starter files'), new File(['z'], 's.zip'));
    expect(await screen.findByText('Grader files need at least one .cpp file.')).toBeInTheDocument();
  });

  describe('replacing the grader of a problem with earlier submissions', () => {
    const graderZip = () => new File(['zip'], 'fixed-grader.zip', { type: 'application/zip' });
    beforeEach(() => {
      jest.mocked(adminService.getProblemFiles).mockResolvedValue(filesInfo());
      jest.mocked(adminService.replaceProblemFiles).mockResolvedValue({ message: 'ok' } as never);
      jest.mocked(adminService.rejudgeProblem).mockResolvedValue({ message: 'ok' } as never);
    });

    it('asks first, names the submissions, rejudge is on, and the primary replaces then rejudges', async () => {
      render(<ProblemGraderTab problemId="P1" submissionCount={214} canRejudge />);
      await screen.findByText('grader.cpp');
      const zip = graderZip();
      await userEvent.upload(screen.getByLabelText('Replace all grader files'), zip);
      const dialog = await screen.findByRole('dialog', { name: 'Replace all grader files?' });
      expect(adminService.replaceProblemFiles).not.toHaveBeenCalled();
      expect(dialog).toHaveTextContent('Every current grader file is deleted and replaced by the ones in fixed-grader.zip.');
      expect(dialog).toHaveTextContent('214 earlier submissions were judged with the current grader files.');
      expect(within(dialog).getByRole('switch', { name: 'Rejudge after replacing' })).toBeChecked();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Replace and rejudge' }));
      await waitFor(() => expect(adminService.rejudgeProblem).toHaveBeenCalledWith('P1'));
      expect(adminService.replaceProblemFiles).toHaveBeenCalledWith('P1', 'grader', zip);
      expect(jest.mocked(adminService.replaceProblemFiles).mock.invocationCallOrder[0])
        .toBeLessThan(jest.mocked(adminService.rejudgeProblem).mock.invocationCallOrder[0]);
      expect(await screen.findByRole('status')).toHaveTextContent('Grader files replaced. Rejudging 214 submissions.');
    });

    it('turning rejudge off replaces only', async () => {
      render(<ProblemGraderTab problemId="P1" submissionCount={214} canRejudge />);
      await screen.findByText('grader.cpp');
      await userEvent.upload(screen.getByLabelText('Replace all grader files'), graderZip());
      const dialog = await screen.findByRole('dialog', { name: 'Replace all grader files?' });
      fireEvent.click(within(dialog).getByRole('switch', { name: 'Rejudge after replacing' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Replace grader files' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Grader files replaced.');
      expect(adminService.replaceProblemFiles).toHaveBeenCalledTimes(1);
      expect(adminService.rejudgeProblem).not.toHaveBeenCalled();
    });

    it('cancel leaves the grader alone', async () => {
      render(<ProblemGraderTab problemId="P1" submissionCount={214} canRejudge />);
      await screen.findByText('grader.cpp');
      await userEvent.upload(screen.getByLabelText('Replace all grader files'), graderZip());
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(adminService.replaceProblemFiles).not.toHaveBeenCalled();
      expect(adminService.rejudgeProblem).not.toHaveBeenCalled();
    });

    it('staff cannot rejudge, so the confirm says who can', async () => {
      render(<ProblemGraderTab problemId="P1" submissionCount={214} canRejudge={false} />);
      await screen.findByText('grader.cpp');
      await userEvent.upload(screen.getByLabelText('Replace all grader files'), graderZip());
      const dialog = await screen.findByRole('dialog', { name: 'Replace all grader files?' });
      expect(within(dialog).queryByRole('switch')).toBeNull();
      expect(dialog).toHaveTextContent('An admin can rejudge them afterwards.');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Replace grader files' }));
      await waitFor(() => expect(adminService.replaceProblemFiles).toHaveBeenCalled());
      expect(adminService.rejudgeProblem).not.toHaveBeenCalled();
    });

    it('starter files decide no verdict, so they replace at once and never rejudge', async () => {
      render(<ProblemGraderTab problemId="P1" submissionCount={214} canRejudge />);
      await screen.findByText('grader.cpp');
      await userEvent.upload(screen.getByLabelText('Replace all starter files'), new File(['z'], 's.zip'));
      await waitFor(() => expect(adminService.replaceProblemFiles).toHaveBeenCalledWith('P1', 'starter', expect.any(File)));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(adminService.rejudgeProblem).not.toHaveBeenCalled();
    });

    it('a rejudge that fails after a good replace keeps the success and says only the rejudge failed', async () => {
      jest.mocked(adminService.rejudgeProblem).mockRejectedValue({ response: { status: 500, data: { message: 'Judge queue unavailable' } } });
      render(<ProblemGraderTab problemId="P1" submissionCount={214} canRejudge />);
      await screen.findByText('grader.cpp');
      await userEvent.upload(screen.getByLabelText('Replace all grader files'), graderZip());
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace and rejudge' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Grader files replaced.');
      expect(screen.getByRole('alert')).toHaveTextContent("The rejudge didn't start: Judge queue unavailable");
    });

    it('a rejected replace shows its message and skips the rejudge', async () => {
      jest.mocked(adminService.replaceProblemFiles).mockRejectedValue({
        response: { status: 400, data: { message: 'Grader files need at least one .cpp file.' } },
      });
      render(<ProblemGraderTab problemId="P1" submissionCount={214} canRejudge />);
      await screen.findByText('grader.cpp');
      await userEvent.upload(screen.getByLabelText('Replace all grader files'), graderZip());
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace and rejudge' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Grader files need at least one .cpp file.');
      expect(adminService.rejudgeProblem).not.toHaveBeenCalled();
    });
  });

  it('says so when the files cannot be loaded', async () => {
    jest.mocked(adminService.getProblemFiles).mockRejectedValue(new Error('down'));
    render(<ProblemGraderTab problemId="P1" submissionCount={0} canRejudge />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the grader files.');
  });
});
