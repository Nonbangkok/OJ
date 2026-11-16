import { fireEvent, render, screen } from '@testing-library/react';
import api from '../../../services/api';
import UserLinkPicker from './UserLinkPicker';

jest.mock('../../../services/api');

test('final review: Enter in the search picks the first free match instead of submitting the form', async () => {
  jest.mocked(api.get).mockResolvedValue({ data: [
    { id: 12, username: 'alice', role: 'staff', linkedProfile: { id: 'other', akaName: 'Ada' } },
    { id: 31, username: 'alicia', role: 'user', linkedProfile: null },
  ] });
  const onChange = jest.fn();
  render(<UserLinkPicker value={null} onChange={onChange} currentProfileId="mine" />);
  const input = screen.getByRole('combobox', { name: 'Linked user' });
  fireEvent.change(input, { target: { value: 'ali' } });
  expect(await screen.findByText('alicia')).toBeInTheDocument();
  // Default prevented: the surrounding profile form never submits.
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
  expect(onChange).toHaveBeenCalledWith({ id: 31, username: 'alicia' });
});

test('final review: Enter with no free match does nothing', async () => {
  jest.mocked(api.get).mockResolvedValue({ data: [] });
  const onChange = jest.fn();
  render(<UserLinkPicker value={null} onChange={onChange} />);
  const input = screen.getByRole('combobox', { name: 'Linked user' });
  fireEvent.change(input, { target: { value: 'zz' } });
  const event = fireEvent.keyDown(input, { key: 'Enter' });
  expect(event).toBe(false); // default prevented: the surrounding form never submits
  expect(onChange).not.toHaveBeenCalled();
});
