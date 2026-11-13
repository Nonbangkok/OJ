import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProblemModal from '../../../features/admin/problems/ProblemModal';
import ContestModal from '../../../features/admin/contests/ContestModal';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService');

const currentUser = { id: 1, username: 'admin', role: 'admin' };

describe('ProblemModal keyboard and screen-reader behaviour', () => {
  beforeEach(() => {
    (jest.mocked(adminService.getAuthors) as jest.Mock).mockResolvedValue([]);
  });

  const renderProblemModal = (props = {}) => {
    const onClose = jest.fn();
    render(
      <>
        <button type="button">Opener</button>
        <ProblemModal problem={null} onClose={onClose} onSave={jest.fn()} uploadProgress={null}
          currentUser={currentUser} collections={[]} {...props} />
      </>,
    );
    return { onClose };
  };

  it('is announced as a modal dialog named by its heading', async () => {
    renderProblemModal();
    const dialog = await screen.findByRole('dialog', { name: 'Create New Problem' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on Escape', async () => {
    const { onClose } = renderProblemModal();
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape while an upload is in progress', async () => {
    const { onClose } = renderProblemModal({
      uploadProgress: { status: 'uploading', message: 'Uploading…', progress: 1, total: 3 },
    });
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves focus into the dialog and keeps Tab inside it', async () => {
    renderProblemModal();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    for (let i = 0; i < 40; i += 1) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });
});

describe('ContestModal keyboard and screen-reader behaviour', () => {
  it('is a named modal dialog that closes on Escape', async () => {
    const onClose = jest.fn();
    render(<ContestModal contest={null} onClose={onClose} onSuccess={jest.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Create New Contest' })).toHaveAttribute('aria-modal', 'true');
    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape in an open date picker closes only the calendar, not the dialog', async () => {
    const onClose = jest.fn();
    render(<ContestModal contest={null} onClose={onClose} onSuccess={jest.fn()} />);
    const [startInput] = screen.getAllByRole('textbox').filter(el => el.closest('.react-datepicker-wrapper'));

    await userEvent.click(startInput);
    expect(document.querySelector('.react-datepicker')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    expect(document.querySelector('.react-datepicker')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
