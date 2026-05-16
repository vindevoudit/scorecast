// Tier 11 Chunk 2 — ErrorBoundary tokenized. Can't import the Button
// primitive here because ErrorBoundary is a class component rendered above
// the provider stack — keep the inline buttons but tokenize the classes.

import { Component } from 'react';
import { reportClientError } from '../lib/clientErrorReporter';
import { captureException } from '../lib/sentry';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Something went wrong' };
  }

  componentDidCatch(error, info) {
    reportClientError({
      message: error?.message,
      stack: error?.stack,
      componentStack: info?.componentStack,
    });
    captureException(error, { extra: { componentStack: info?.componentStack } });
  }

  handleReload = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="bg-radial-glow px-safe py-safe min-h-[100dvh] bg-base text-fg">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-3xl border border-danger/40 bg-elevated/85 p-8 shadow-glow">
            <p className="text-sm uppercase tracking-[0.35em] text-danger">Something broke</p>
            <h1 className="mt-3 text-3xl font-semibold text-fg">Bantryx hit an unexpected error</h1>
            <p className="mt-3 text-fg">
              The error has been logged. Try reloading the page; if it keeps happening, sign out and
              back in.
            </p>
            {import.meta.env.DEV && this.state.message ? (
              <p className="mt-4 rounded-2xl bg-overlay/70 px-4 py-3 font-mono text-xs text-danger">
                {this.state.message}
              </p>
            ) : null}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={this.handleReload}
                className="rounded-3xl bg-accent px-6 py-3 text-sm font-semibold text-accent-fg transition duration-200 hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Reload page
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                className="rounded-3xl border border-strong bg-elevated px-6 py-3 text-sm font-semibold text-fg transition duration-200 hover:border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
