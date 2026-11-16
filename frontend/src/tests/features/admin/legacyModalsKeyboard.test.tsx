import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContestModal from '../../../features/admin/contests/ContestModal';

jest.mock('../../../services/adminService');

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
