// Tier 11 Chunk 2 — SignInModal rebuilt on Radix Dialog. AuthGateContext
// keeps owning the open state (via `gateState.open` / `closeGate`); Radix's
// `onOpenChange` mirrors back into closeGate so Escape + overlay-click +
// any other dismissal route through one path.

import { useAuth } from '../hooks/useAuth';
import { useAuthGate } from '../hooks/useAuthGate';
import { Button } from './ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/Dialog';

function SignInModal() {
  const { gateState, closeGate } = useAuthGate();
  const { setShowAuth } = useAuth();

  // Both CTAs do the same thing: show the auth grid. browseAsGuest is left
  // alone so a Back from the auth grid returns the visitor to the anon
  // dashboard they were just browsing.
  const goToAuth = () => {
    closeGate();
    setShowAuth(true);
  };

  return (
    <Dialog open={gateState.open} onOpenChange={(next) => (next ? null : closeGate())}>
      <DialogContent>
        <DialogTitle>Sign in to {gateState.label}</DialogTitle>
        <DialogDescription>
          Track your picks, earn points for risky calls, and climb the live leaderboards.
        </DialogDescription>
        <DialogFooter>
          <Button variant="secondary" onClick={closeGate}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={goToAuth}>
            Sign in
          </Button>
          <Button variant="primary" onClick={goToAuth} autoFocus>
            Create account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SignInModal;
