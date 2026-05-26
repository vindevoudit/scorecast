'use strict';

// Tier 18 Chunk 6 — Footer. Lives at the bottom of the Landing page and
// the authed Dashboard. Muted style so it doesn't dominate the UI; links
// open the legal pages via standard hrefs (App.jsx pathname routing
// short-circuits to the right page on the next paint).

const YEAR = new Date().getFullYear();
const LINKS = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/copyright', label: 'Copyright' },
  { href: '/cookies', label: 'Cookies' },
];

function Footer() {
  return (
    <footer className="mt-12 border-t border-default pt-6 text-xs text-fg-muted">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 pb-6 sm:flex-row">
        <p>&copy; {YEAR} Bantryx &middot; Trinidad &amp; Tobago</p>
        <nav aria-label="Legal pages" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}

export default Footer;
