// Tier 11 Chunk 4 — first-run onboarding tour.
//
// 4-step modal sequence walking new users through the core loop: place picks,
// score via probability-weighted points, climb the leaderboard, join groups.
// Renders only when the user is signed in, hasn't completed onboarding,
// isn't browsing as a guest, and is on the Games view with games loaded
// (gated in App.jsx). Skip + Done both POST to /api/me/onboarding-completed
// so we don't re-prompt.

import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRequest } from '../hooks/useRequest';
import { useNotifications } from '../hooks/useNotifications';
import { useReducedMotion } from '../lib/a11y';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui';

const STEPS = [
  {
    kicker: 'Step 1 of 4',
    title: 'Welcome to Bantryx',
    body: 'Place picks on football matches and earn points when you call them right. No betting — just bragging rights.',
  },
  {
    kicker: 'Step 2 of 4',
    title: 'Pick smart, not safe',
    body: 'Underdog upsets pay more. A 38% underdog win pays +62 points; a 52% home win pays +48. Look for value.',
  },
  {
    kicker: 'Step 3 of 4',
    title: 'Climb the leaderboard',
    body: 'Standings update the moment a match settles. Track yourself against everyone, or against just your group.',
  },
  {
    kicker: 'Step 4 of 4',
    title: 'Beat your friends',
    body: 'Create a private group or join a public one. Invite friends, race them, and own the group chat.',
  },
];

function OnboardingTour() {
  const { setUser } = useAuth();
  const request = useRequest();
  const { showStatus } = useNotifications();
  const reducedMotion = useReducedMotion();

  const [stepIdx, setStepIdx] = useState(0);
  const [closing, setClosing] = useState(false);

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;

  // POST the completion timestamp + flip user state locally so the tour
  // doesn't re-mount before /api/me re-fetches. Errors are non-fatal (user
  // sees toast; tour still closes). The closing flag prevents double-firing
  // if the user mashes the buttons.
  const complete = async () => {
    if (closing) return;
    setClosing(true);
    const nowIso = new Date().toISOString();
    setUser((u) => (u ? { ...u, onboardingCompletedAt: nowIso } : u));
    try {
      await request('/api/me/onboarding-completed', { method: 'POST' });
    } catch (error) {
      // Don't re-open the tour on error — local state is already optimistic
      // and the next /api/me will reconcile. Surface a quiet toast so the
      // user knows something might not have stuck.
      if (error?.message && error.message !== 'Session expired') {
        showStatus('Could not save onboarding state.');
      }
    }
  };

  const next = () => {
    if (isLast) {
      complete();
    } else {
      setStepIdx((i) => i + 1);
    }
  };
  const back = () => setStepIdx((i) => Math.max(0, i - 1));
  const skip = () => complete();

  return (
    <Dialog open onOpenChange={(open) => (open ? null : skip())}>
      <DialogContent
        className={
          reducedMotion ? 'data-[state=closed]:animate-none data-[state=open]:animate-none' : ''
        }
      >
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">
          {step.kicker}
        </p>
        <DialogTitle className="mt-2">{step.title}</DialogTitle>
        <DialogDescription>{step.body}</DialogDescription>

        {/* Progress dots — visual stepper that doubles as a skip-friendly
            indicator of how far the user has to go. */}
        <div className="mt-5 flex items-center gap-1.5" role="presentation" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span
              key={s.kicker}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${
                i <= stepIdx ? 'bg-accent' : 'bg-overlay'
              }`}
            />
          ))}
        </div>

        <DialogFooter>
          <Button variant="link" onClick={skip} disabled={closing}>
            Skip tour
          </Button>
          <div className="flex gap-2 sm:ml-auto">
            {stepIdx > 0 ? (
              <Button variant="secondary" onClick={back} disabled={closing}>
                Back
              </Button>
            ) : null}
            <Button variant="primary" onClick={next} disabled={closing} autoFocus>
              {isLast ? 'Get started' : 'Next'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OnboardingTour;
