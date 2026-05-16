// Tier 11 Chunk 2 — InlineGatePanel rebuilt on Card + Button.

import { useAuth } from '../hooks/useAuth';
import { Button, Card } from './ui';

function InlineGatePanel({ label, description }) {
  const { setShowAuth } = useAuth();
  const goToAuth = () => setShowAuth(true);

  return (
    <Card variant="subtle" className="p-6 text-center">
      <h3 className="text-base font-semibold text-fg">Sign in to {label}</h3>
      <p className="mt-2 text-sm text-fg-muted">
        {description || 'Create a free account or sign in to take part.'}
      </p>
      <div className="mt-5 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
        <Button variant="primary" size="lg" onClick={goToAuth}>
          Create account
        </Button>
        <Button variant="secondary" size="lg" onClick={goToAuth}>
          Sign in
        </Button>
      </div>
    </Card>
  );
}

export default InlineGatePanel;
