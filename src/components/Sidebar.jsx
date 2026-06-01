// Tier 11 Chunk 2 — Sidebar tokenized. Preserves the Playwright role="tab"
// + accessible-name contract (kicker + label) so the existing E2E selectors
// keep resolving.
// Fluid UI tier — mobile drawer migrated to Radix Dialog (via low-level
// primitives so the overlay can be md:hidden and the content can anchor
// to the left edge as a slide-in sheet). Desktop sidebar untouched.
// Tier 30 Phase 2 Chunk 2.3 — active-tab indicator promoted to a
// motion `<m.span layoutId>` so it slides between tabs instead of
// snapping; icon size bumped from h-5 to h-6 for a beefier hit-target
// feel; mobile drawer header gets the `.bg-arena-grid-bold` backdrop
// so it reads as a stadium broadcast header. Desktop sidebar untouched
// — the indicator is now smoothly animated but the surrounding chrome
// stays minimal.

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog } from './ui';
import { m, useReducedMotion } from '../lib/motion';
import { sidebarTabIndicator } from '../lib/motionVariants';

const ICONS = {
  games: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
    </svg>
  ),
  mypicks: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <rect x="5" y="4" width="14" height="17" rx="2.5" />
      <path d="M9 3h6v3H9z" />
      <path d="M8.5 12l2.2 2.2L15.5 9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  groups: (props) => (
    // Network / community: 4 outer nodes + 1 hub, hub-and-spoke
    // connectors. Reads as "interconnected community" — distinct from
    // the friends bust-pair below which represents 1:1 social ties.
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="5" cy="5" r="2" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M6.5 6.5l4 4M17.5 6.5l-4 4M6.5 17.5l4-4M17.5 17.5l-4-4" strokeLinecap="round" />
    </svg>
  ),
  friends: (props) => (
    // Two overlapping busts — was the previous `groups` icon. Reads as
    // "close 1:1 ties" vs the groups network graph above.
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="9" cy="9" r="3.2" />
      <circle cx="17" cy="10" r="2.4" />
      <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" strokeLinecap="round" />
      <path d="M14.5 14.5c2.8.2 5 2 5 4.5" strokeLinecap="round" />
    </svg>
  ),
  leaderboard: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M8 4h8v6a4 4 0 11-8 0V4z" />
      <path d="M8 6H5v2a3 3 0 003 3M16 6h3v2a3 3 0 01-3 3" strokeLinecap="round" />
      <path d="M10 17h4v3h-4z" />
      <path d="M8 20h8" strokeLinecap="round" />
    </svg>
  ),
  profile: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="12" cy="9" r="3.4" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" strokeLinecap="round" />
    </svg>
  ),
  admin: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5l1.6 1.2-2 3.4-2-.8a7 7 0 01-1.7 1l-.3 2.1h-4l-.3-2.1a7 7 0 01-1.7-1l-2 .8-2-3.4 1.6-1.2a7 7 0 010-2l-1.6-1.2 2-3.4 2 .8a7 7 0 011.7-1L9.7 4h4l.3 2.1a7 7 0 011.7 1l2-.8 2 3.4-1.6 1.2a7 7 0 010 2z" />
    </svg>
  ),
};

function ChevronIcon({ direction, className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {direction === 'left' ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
    </svg>
  );
}

function CloseIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      {...props}
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function NavItem({ tab, active, collapsed, onSelect }) {
  const Icon = ICONS[tab.id] || ICONS.profile;
  const reduceMotion = useReducedMotion();
  // Tier 30 Phase 1 follow-up — kicker removed. Sidebar entries render
  // a single label per item. Playwright contracts switch from
  // `${kicker} ${label}` accessible name to just `label`.
  //
  // Tier 30 Phase 2 — active indicator is rendered as an `<m.span
  // layoutId="sidebar-active-indicator">`. Because the same layoutId
  // appears in exactly one NavItem at any time, motion auto-animates
  // the indicator's position from the previous tab to the new one
  // (springs via `sidebarTabIndicator`). prefers-reduced-motion users
  // (and mobile, post-Phase-2-follow-up) get a plain static span
  // instead so there's no motion overhead. The span sits absolute,
  // so it never affects the button's accessible name or focus ring.
  const indicatorClass =
    'shadow-led absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r bg-accent';
  return (
    <button
      role="tab"
      aria-selected={active}
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(tab.id)}
      title={collapsed ? tab.label : undefined}
      className={`relative flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active ? 'bg-accent/10 text-fg' : 'text-fg hover:bg-overlay/60 hover:text-fg'
      } ${collapsed ? 'justify-center' : ''}`}
    >
      {active ? (
        reduceMotion ? (
          <span aria-hidden="true" className={indicatorClass} />
        ) : (
          <m.span
            layoutId="sidebar-active-indicator"
            transition={sidebarTabIndicator}
            aria-hidden="true"
            className={indicatorClass}
          />
        )
      ) : null}
      <Icon className="h-6 w-6 shrink-0" aria-hidden="true" />
      <span
        className={`min-w-0 flex-1 truncate text-sm font-semibold ${collapsed ? 'sr-only' : ''}`}
      >
        {tab.label}
      </span>
    </button>
  );
}

function SidebarBody({
  tabs,
  activeView,
  onSelectView,
  collapsed,
  onToggleCollapsed,
  isMobile,
  onMobileClose,
}) {
  return (
    <div className="flex h-full flex-col">
      <div
        className={`flex items-center gap-2 px-3 pb-3 pt-4 ${
          collapsed && !isMobile ? 'justify-center' : 'justify-between'
        }`}
      >
        {!collapsed || isMobile ? (
          <span className="text-xs font-semibold uppercase tracking-[0.32em] text-accent/80">
            Navigate
          </span>
        ) : null}
        {isMobile ? (
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close navigation"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-muted transition-colors duration-200 hover:bg-overlay/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <CloseIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-muted transition-colors duration-200 hover:bg-overlay/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronIcon direction={collapsed ? 'right' : 'left'} className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tier 11 Chunk 4 — `<nav>` landmark for screen readers. The inner
          `role="tablist"` keeps the existing Playwright contracts
          (`getByRole('tab', { name: /Upcoming Matches/ })`). */}
      <nav aria-label="Primary navigation" className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        <div role="tablist" aria-label="Dashboard sections" className="space-y-1">
          {tabs.map((tab) => (
            <NavItem
              key={tab.id}
              tab={tab}
              active={activeView === tab.id}
              collapsed={collapsed && !isMobile}
              onSelect={(id) => {
                onSelectView(id);
                if (isMobile) onMobileClose?.();
              }}
            />
          ))}
        </div>
      </nav>
    </div>
  );
}

function Sidebar({
  tabs,
  activeView,
  onSelectView,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onMobileClose,
}) {
  return (
    <>
      <aside
        className={`hidden shrink-0 self-stretch border-r border-default bg-elevated/85 motion-safe:transition-[width] motion-safe:duration-200 md:flex md:rounded-r-3xl ${
          collapsed ? 'md:w-16' : 'md:w-60'
        }`}
      >
        <SidebarBody
          tabs={tabs}
          activeView={activeView}
          onSelectView={onSelectView}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          isMobile={false}
        />
      </aside>

      <Dialog
        open={mobileOpen}
        onOpenChange={(next) => {
          if (!next) onMobileClose?.();
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-base/70 backdrop-blur-sm duration-150 ease-out-expo data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:hidden" />
          <DialogPrimitive.Content
            aria-label="Dashboard navigation"
            className="pt-safe safe-bottom fixed inset-y-0 left-0 z-50 h-full w-72 max-w-[85vw] border-r border-default bg-elevated shadow-glow duration-220 ease-out-expo focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left md:hidden"
          >
            <DialogPrimitive.Title className="sr-only">Dashboard navigation</DialogPrimitive.Title>
            <SidebarBody
              tabs={tabs}
              activeView={activeView}
              onSelectView={onSelectView}
              collapsed={false}
              isMobile
              onMobileClose={onMobileClose}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </Dialog>
    </>
  );
}

export default Sidebar;
