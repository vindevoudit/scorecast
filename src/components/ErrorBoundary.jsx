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
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_48%),linear-gradient(180deg,_#020617_0%,_#050b18_100%)] px-4 py-10 text-slate-100 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-3xl border border-rose-700/40 bg-slate-900/85 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.4)]">
            <p className="text-sm uppercase tracking-[0.35em] text-rose-300/80">Something broke</p>
            <h1 className="mt-3 text-3xl font-semibold text-white">
              Bantryx hit an unexpected error
            </h1>
            <p className="mt-3 text-slate-300">
              The error has been logged. Try reloading the page; if it keeps happening, sign out and
              back in.
            </p>
            {import.meta.env.DEV && this.state.message ? (
              <p className="mt-4 rounded-2xl bg-slate-950/70 px-4 py-3 font-mono text-xs text-rose-200">
                {this.state.message}
              </p>
            ) : null}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={this.handleReload}
                className="rounded-3xl bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 transition duration-200 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                Reload page
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                className="rounded-3xl border border-slate-700 bg-slate-900 px-6 py-3 text-sm font-semibold text-slate-300 transition duration-200 hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
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
