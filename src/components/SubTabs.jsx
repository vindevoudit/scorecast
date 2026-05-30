// Tier 30 Phase 1 — shared sub-tab primitive. Wraps Radix Tabs (so we
// inherit the existing role="tab" + arrow-key semantics already locked by
// Playwright selectors elsewhere) and adds URL sync via `?tab=<value>` so
// sub-tab state survives refresh + deep-link.
//
// URL key is shared across all SubTabs surfaces because only one view is
// mounted at a time. If a hosted view sees a `?tab=` value not in its
// own option set it normalizes to its `defaultValue`, so cross-view
// navigation never strands the URL on a foreign tab id.
//
// Reacts to `scorecast:url-changed` (Tier 20 follow-up) so DataContext's
// in-app `navigateToDeepLink` can write a `?tab=` and have a mounted
// SubTabs snap to the new value without a remount.

import { useEffect, useState, useMemo } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from './ui/cn';

function readTabFromUrl() {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab');
  } catch {
    return null;
  }
}

function writeTabToUrl(value) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set('tab', value);
    else url.searchParams.delete('tab');
    window.history.replaceState({}, '', url.toString());
  } catch {
    // URL constructor or replaceState may throw in degenerate cases; the
    // tab still controls itself via React state, only the URL won't reflect.
  }
}

// `tabs` shape: [{ value: string, label: string, content: ReactNode }]
// `defaultValue` is the value used when `?tab=` is missing OR carries an
// unknown value (cross-view nav).
function SubTabs({ tabs, defaultValue, ariaLabel, className }) {
  const validValues = useMemo(() => new Set(tabs.map((t) => t.value)), [tabs]);

  const resolveInitial = () => {
    const urlTab = readTabFromUrl();
    if (urlTab && validValues.has(urlTab)) return urlTab;
    return defaultValue || tabs[0]?.value;
  };

  const [value, setValue] = useState(resolveInitial);

  // Subscribe to in-app URL writes (DataContext.navigateToDeepLink fires
  // this CustomEvent after every history.pushState that could change
  // `?tab=`). Without this hook a SubTabs surface that's already mounted
  // when an in-app navigation lands keeps showing its old tab.
  useEffect(() => {
    const onUrlChanged = () => {
      const next = readTabFromUrl();
      if (next && validValues.has(next)) setValue(next);
      else setValue(defaultValue || tabs[0]?.value);
    };
    window.addEventListener('scorecast:url-changed', onUrlChanged);
    return () => window.removeEventListener('scorecast:url-changed', onUrlChanged);
  }, [validValues, defaultValue, tabs]);

  // Persist user-driven changes to the URL. Writes happen on the next
  // event loop turn so React's render commit is the source of truth.
  const handleChange = (next) => {
    setValue(next);
    writeTabToUrl(next);
  };

  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={handleChange}
      className={cn('flex flex-col gap-4', className)}
    >
      <TabsPrimitive.List
        aria-label={ariaLabel}
        className={cn(
          // Horizontal scroll on narrow viewports so 4+ tabs don't push
          // the layout off-screen on iPhone SE-class devices. `mask-fade-x`
          // would be nice here but introduces a Phase 2 token dependency.
          'inline-flex w-full items-center gap-1 overflow-x-auto rounded-2xl border border-default bg-elevated/60 p-1 sm:w-auto',
        )}
      >
        {tabs.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-xl px-3 py-1.5 text-sm font-semibold text-fg-muted transition duration-200',
              'data-[state=active]:bg-accent data-[state=active]:text-accent-fg',
              'hover:text-fg',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            )}
          >
            {t.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((t) => (
        <TabsPrimitive.Content key={t.value} value={t.value} className="focus-visible:outline-none">
          {t.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

export default SubTabs;
