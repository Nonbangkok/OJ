import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '../../../components/ui';

const Trigger = () => {
  const { show } = useToast();
  return <button type="button" onClick={() => show('Saved', { tone: 'success' })}>Save</button>;
};

describe('Toast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows a message in a status region and dismisses it after 4 seconds', async () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(4500); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(screen.queryByText('Saved')).toBeNull();
  });
});
