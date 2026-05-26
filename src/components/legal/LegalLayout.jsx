'use strict';

// Tier 18 Chunk 6 — shared chrome for the four legal pages. Renders a
// minimal header (Bantryx wordmark + "Back to app" link) and a centered
// prose container. The pathname check in App.jsx routes /terms, /privacy,
// /copyright, /cookies into one of these.

const BACK_HREF = '/';

function LegalLayout({ title, lastUpdated, children }) {
  return (
    <div className="min-h-[100dvh] bg-base text-fg">
      <header className="border-b border-default bg-elevated/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <a
            href={BACK_HREF}
            className="text-2xl font-semibold uppercase tracking-[0.32em] text-accent transition-colors duration-200 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            BANTRYX
          </a>
          <a
            href={BACK_HREF}
            className="inline-flex items-center gap-2 rounded-2xl border border-default bg-overlay/40 px-3 py-2 text-sm font-semibold text-fg transition-colors duration-200 hover:border-strong hover:bg-overlay/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back to app
          </a>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-semibold text-fg">{title}</h1>
        {lastUpdated ? (
          <p className="mt-2 text-sm uppercase tracking-[0.24em] text-fg-muted">
            Last updated {lastUpdated}
          </p>
        ) : null}
        <div className="legal-prose mt-8 space-y-6 text-fg">{children}</div>
      </main>
    </div>
  );
}

export default LegalLayout;
