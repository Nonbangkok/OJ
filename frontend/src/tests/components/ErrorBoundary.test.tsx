import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';

import { ErrorBoundary } from '../../components/ErrorBoundary';

const Explodes: React.FC = () => {
  throw new Error('kaboom');
};

const renderBoundary = (children: React.ReactNode): ReturnType<typeof render> =>
  render(
    <ErrorBoundary>
      <BrowserRouter>{children}</BrowserRouter>
    </ErrorBoundary>
  );

describe('ErrorBoundary', () => {
  // setupTests installs its own console.error spy in beforeEach; install
  // ours afterwards so this suite observes its own calls.
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('renders children when nothing throws', () => {
    renderBoundary(<div>All good</div>);

    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('shows the fallback UI when a child throws during render', () => {
    renderBoundary(<Explodes />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByText('All good')).not.toBeInTheDocument();
  });

  it('logs the caught error to the console for diagnostics', () => {
    renderBoundary(<Explodes />);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled render error caught by boundary'),
      expect.any(Error),
      expect.any(String)
    );
  });

  it('recovers when the user clicks Try again and the child no longer throws', async () => {
    let shouldThrow = true;
    const MaybeExplodes: React.FC = () => {
      if (shouldThrow) {
        throw new Error('kaboom');
      }
      return <div>Recovered</div>;
    };

    renderBoundary(<MaybeExplodes />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });

  it('still shows the fallback when retry throws again', async () => {
    renderBoundary(<Explodes />);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('offers a link back to the homepage', () => {
    renderBoundary(<Explodes />);

    expect(screen.getByRole('link', { name: 'Back to homepage' })).toHaveAttribute('href', '/');
  });
});
