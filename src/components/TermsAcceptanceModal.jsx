'use strict';

// Tier 18 Chunk 6 — Blocking Terms acceptance gate.
//
// Mounts in App.jsx whenever an authed user's recorded `termsAcceptedVersion`
// is missing or older than the bundle's CURRENT_TERMS_VERSION. The dialog
// cannot be dismissed by Escape, overlay click, or refresh — the user has
// to either accept (records consent + closes) or sign out (returns to the
// landing page). Anon visitors and guest-mode browsers never see it.

import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from './ui';
import { DialogContent, DialogTitle } from './ui/Dialog';
import { useAuth } from '../hooks/useAuth';
import { useRequest } from '../hooks/useRequest';
import { useNotifications } from '../hooks/useNotifications';
import { CURRENT_TERMS_VERSION } from '../lib/terms';

function TermsAcceptanceModal() {
  const { user, setUser, performLogout } = useAuth();
  const request = useRequest();
  const { showStatus } = useNotifications();
  const [submitting, setSubmitting] = useState(false);

  const handleAccept = async () => {
    setSubmitting(true);
    try {
      const data = await request('/api/me/accept-terms', {
        method: 'POST',
        body: JSON.stringify({ version: CURRENT_TERMS_VERSION }),
      });
      setUser((u) =>
        u
          ? {
              ...u,
              termsAcceptedAt: data.termsAcceptedAt,
              termsAcceptedVersion: data.termsAcceptedVersion,
            }
          : u,
      );
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Open is always true while this component is mounted — App.jsx controls
  // mount via needsTermsAcceptance(user). `onOpenChange` is a no-op so
  // Escape / overlay-click can't dismiss without accepting.
  return (
    <DialogPrimitive.Root open={Boolean(user)} onOpenChange={() => {}}>
      <DialogContent
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="max-w-lg"
      >
        <DialogTitle>One quick thing</DialogTitle>
        <div className="mt-3 space-y-3 text-sm text-fg">
          <p>
            We&apos;ve updated how we describe the service and what data we collect. Please review
            and accept to keep using Bantryx.
          </p>
          <p className="text-fg-muted">
            Read the full{' '}
            <a
              href="/terms"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline hover:text-accent-soft"
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline hover:text-accent-soft"
            >
              Privacy Policy
            </a>{' '}
            (opens in a new tab).
          </p>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={performLogout} disabled={submitting}>
            Sign out
          </Button>
          <Button variant="primary" onClick={handleAccept} disabled={submitting}>
            {submitting ? 'Saving…' : 'I accept'}
          </Button>
        </div>
      </DialogContent>
    </DialogPrimitive.Root>
  );
}

export default TermsAcceptanceModal;
