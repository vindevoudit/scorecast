import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';

// Tier 30 Phase 3 A2 — Invite friends panel.
// Renders the user's own referral code with a one-click copy + a share
// link. Slots into SettingsView → Account so the surface lives next to
// the rest of the user's account-level controls. Education line points
// at the Recruiter I/II/III badge tier so users understand the loop.

function ReferralCodePanel() {
  const { user } = useAuth();
  const { showStatus } = useNotifications();
  const [copied, setCopied] = useState(null);
  const code = user?.referralCode;
  if (!code) return null;

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?ref=${encodeURIComponent(code)}`
      : `https://bantryx.com/?ref=${encodeURIComponent(code)}`;

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      showStatus(`${label === 'code' ? 'Code' : 'Link'} copied`);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      showStatus("Couldn't copy — long-press to copy manually");
    }
  };

  return (
    <div className="rounded-3xl border border-default bg-elevated/70 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">
        Invite friends
      </h3>
      <p className="mt-2 text-sm text-fg">
        Share your code. When a friend signs up with it and makes a scored pick, you unlock the{' '}
        <span className="font-semibold">Recruiter</span> badge tier.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div className="flex flex-1 items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3">
          <span
            className="font-led text-2xl font-bold tabular-nums tracking-[0.18em] text-accent"
            aria-label="Your referral code"
          >
            {code}
          </span>
          <button
            type="button"
            onClick={() => copy(code, 'code')}
            className="rounded-full border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-accent transition hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {copied === 'code' ? 'Copied' : 'Copy code'}
          </button>
        </div>
        <button
          type="button"
          onClick={() => copy(shareUrl, 'link')}
          className="rounded-2xl border border-default bg-overlay/60 px-4 py-3 text-sm font-semibold text-fg transition hover:bg-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {copied === 'link' ? 'Link copied' : 'Copy invite link'}
        </button>
      </div>
    </div>
  );
}

export default ReferralCodePanel;
