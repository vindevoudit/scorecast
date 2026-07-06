// Trophy Cabinet — the sidebar entry (self view). Wraps <TrophyCabinet /> with
// the current user's username. The same component also mounts as a Cabinet
// sub-tab on any profile (see ProfileView); it's lazy-loaded so its chunk only
// ships when opened.

import { lazy, Suspense } from 'react';
import { useAuth } from '../hooks/useAuth';

const TrophyCabinet = lazy(() => import('../components/TrophyCabinet'));

function TrophyCabinetView() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="motion-safe:duration-180 motion-safe:ease-out-expo motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
      <Suspense fallback={<p className="text-sm text-fg-muted">Loading trophy cabinet…</p>}>
        <TrophyCabinet username={user.username} />
      </Suspense>
    </div>
  );
}

export default TrophyCabinetView;
