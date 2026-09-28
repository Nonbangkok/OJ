import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProblemMigrationModal from '../../../features/admin/problems/ProblemMigrationModal';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService');

describe('ProblemMigrationModal search lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (jest.mocked(adminService.getAvailableProblems) as jest.Mock).mockResolvedValue([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' },
    ]);
    (jest.mocked(adminService.getContestProblemsAdmin) as jest.Mock).mockResolvedValue([]);
  });

  it('keeps the modal search mounted and preserves selection while filtering', async () => {
    render(<ProblemMigrationModal
      contest={{ id: 1, title: 'Contest', status: 'scheduled' }}
      onClose={jest.fn()}
      onSuccess={jest.fn()}
    />);

    const input = screen.getAllByLabelText('Search by ID or title…')[0];
    input.focus();
    fireEvent.change(input, { target: { value: 'beta' } });
    expect(screen.getAllByLabelText('Search by ID or title…')[0]).toBe(input);
    await waitFor(() => expect(screen.getByText('Beta')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Select problem beta'));

    fireEvent.change(input, { target: { value: 'alpha' } });
    expect(screen.getAllByLabelText('Search by ID or title…')[0]).toBe(input);
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });
});
