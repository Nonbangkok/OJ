import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from './ui/Button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Global render-crash guard. Without it, a throwing component white-screens
 * the whole CRA app with no recovery. Shows a retry (remount) and a link
 * back home instead.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced to browser console / error reporting integrations.
    console.error('Unhandled render error caught by boundary:', error, info.componentStack);
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }

    return (
      <div role="alert" className="error-boundary">
        <h1>Something went wrong</h1>
        <p>
          An unexpected error occurred while rendering this page. Your data is
          safe — try again, or head back to the homepage.
        </p>
        <div className="error-boundary-actions">
          <Button variant="primary" onClick={this.handleRetry}>
            Try again
          </Button>
          <a href="/">Back to homepage</a>
        </div>
      </div>
    );
  }
}
