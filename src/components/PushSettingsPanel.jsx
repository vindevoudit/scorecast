import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';
import { useRequest } from '../hooks/useRequest';
import { useStandalone } from '../hooks/useStandalone';
import { usePushSubscription } from '../hooks/usePushSubscription';
import { Switch, Checkbox } from './ui';

// PWA Chunk 5 — Push notifications settings panel mounted in ProfileView.
//
// State machine:
//   - !supported              -> "Browser doesn't support push"
//   - isIos && !isStandalone  -> "Install to Home Screen first" gate
//   - permission === 'denied' -> "Permission blocked" + OS instructions
//   - !subscribed             -> Master toggle off; flipping it triggers
//                                the permission prompt + subscribe ceremony
//   - subscribed              -> Master toggle on + per-type checkboxes

// Keep the type list + labels here in lock step with PUSH_NOTIFICATION_TYPES
// in validation/schemas.js. Order is the user-facing display order.
const NOTIFICATION_TYPES = [
  {
    key: 'pick-scored',
    label: 'Pick scored',
    description: 'When a game you picked finishes and your points are awarded.',
  },
  {
    key: 'kickoff-reminder',
    label: 'Kickoff reminder',
    description: 'A few minutes before a game you picked starts.',
  },
  {
    key: 'odds-shifted',
    label: 'Odds shifted',
    description: 'When the market moves enough to change your locked-in payout.',
  },
  {
    key: 'badge',
    label: 'Badge unlocked',
    description: 'When you earn a new badge.',
  },
  {
    key: 'invite',
    label: 'Group invites',
    description: 'When someone invites you to a private group.',
  },
  {
    key: 'group-join',
    label: 'Group activity',
    description: 'When someone joins or leaves a group you own.',
  },
  {
    key: 'friend-request',
    label: 'Friend requests',
    description: 'When someone sends you a friend request, or accepts one you sent.',
  },
];

// TEMP DIAGNOSTIC — Push subscription state dump. Renders a collapsible
// <details> block at the bottom of each panel branch so we can surface
// internal state on devices without devtools (notably iOS installed PWAs).
// Remove once the install/subscribe flow is fully verified in prod.
function DiagnosticBlock({ data }) {
  if (!data) return null;
  return (
    <details className="mt-4 rounded-2xl bg-overlay/70 p-3 text-xs text-fg-muted">
      <summary className="cursor-pointer font-medium text-fg">
        Push diagnostics (tap to expand)
      </summary>
      <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-fg">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

function PushSettingsPanel() {
  const { user } = useAuth();
  const { showStatus } = useNotifications();
  const request = useRequest();
  const { isIos, isStandalone } = useStandalone();
  const { supported, permission, subscribed, checking, subscribe, unsubscribe } =
    usePushSubscription();

  // Local mirror of users.pushPreferences. Seeded from /api/me (already on
  // user object). Updates flush via debounced PUT.
  const [prefs, setPrefs] = useState(() => user?.pushPreferences || {});
  const [busy, setBusy] = useState(false);

  // TEMP DIAGNOSTIC — collects internal state + SW registration status so
  // we can debug the "greyed toggle" issue on iOS PWAs without web inspector.
  const [diag, setDiag] = useState(null);

  useEffect(() => {
    setPrefs(user?.pushPreferences || {});
  }, [user?.pushPreferences]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = {
        // Capability detection
        hasServiceWorkerAPI: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
        hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
        hasNotification: typeof window !== 'undefined' && 'Notification' in window,
        // Platform detection
        isIos,
        isStandalone,
        navigatorStandalone:
          typeof navigator !== 'undefined' && 'standalone' in navigator
            ? navigator.standalone
            : 'n/a',
        displayModeStandalone:
          typeof window !== 'undefined' && window.matchMedia
            ? window.matchMedia('(display-mode: standalone)').matches
            : null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        // Hook state
        supported,
        permission,
        checking,
        subscribed,
        busy,
        // SW runtime
        controllerPresent:
          typeof navigator !== 'undefined' && navigator.serviceWorker?.controller != null,
      };

      try {
        const reg = navigator.serviceWorker
          ? await navigator.serviceWorker.getRegistration()
          : null;
        if (reg) {
          out.swScope = reg.scope;
          out.swInstallingState = reg.installing?.state || null;
          out.swWaitingState = reg.waiting?.state || null;
          out.swActiveState = reg.active?.state || null;
          out.swActiveScriptURL = reg.active?.scriptURL || null;
        } else {
          out.swRegistration = 'NONE';
        }
      } catch (e) {
        out.swRegistrationError = e.message;
      }

      // Probe serviceWorker.ready with a 3-s timeout so we know whether it
      // resolves (SW active) or hangs (SW never reached active).
      try {
        const readyPromise = navigator.serviceWorker?.ready;
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 3000),
        );
        if (readyPromise) {
          await Promise.race([readyPromise, timeoutPromise]);
          out.serviceWorkerReady = 'resolved';
        } else {
          out.serviceWorkerReady = 'no-api';
        }
      } catch (e) {
        out.serviceWorkerReady =
          e.message === 'timeout' ? 'TIMEOUT (hanging)' : `error: ${e.message}`;
      }

      // Try the push permission via the registration too — iOS sometimes
      // reports a different state via pushManager.permissionState() than via
      // Notification.permission.
      try {
        const reg = navigator.serviceWorker
          ? await navigator.serviceWorker.getRegistration()
          : null;
        if (reg && reg.pushManager) {
          out.pushManagerPermissionState = await reg.pushManager.permissionState({
            userVisibleOnly: true,
          });
          const existingSub = await reg.pushManager.getSubscription();
          out.existingSubscription = existingSub ? 'present' : 'none';
        }
      } catch (e) {
        out.pushManagerProbeError = e.message;
      }

      out.timestamp = new Date().toISOString();
      if (!cancelled) setDiag(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, isIos, isStandalone, permission, checking, subscribed, busy]);

  // iOS Safari can only register a service worker (and therefore can only
  // subscribe to push) inside an installed PWA. Show the install gate first.
  if (isIos && !isStandalone) {
    return (
      <div className="rounded-3xl border border-default bg-elevated/70 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">
          Push notifications
        </h3>
        <p className="mt-2 text-sm text-fg">Install Bantryx to your Home Screen first.</p>
        <p className="mt-2 text-xs text-fg-muted">
          iOS only delivers push notifications to installed Progressive Web Apps. Tap the Share icon
          in Safari, then <span className="font-medium text-fg">Add to Home Screen</span>. Open
          Bantryx from your home screen and come back here to enable push.
        </p>
        <DiagnosticBlock data={diag} />
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="rounded-3xl border border-default bg-elevated/70 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">
          Push notifications
        </h3>
        <p className="mt-2 text-sm text-fg">Your browser doesn't support push notifications.</p>
        <p className="mt-2 text-xs text-fg-muted">
          Try the latest Chrome, Edge, Firefox, or Safari ≥ 16.4. The in-app notification bell
          continues to work regardless.
        </p>
        <DiagnosticBlock data={diag} />
      </div>
    );
  }

  const handleToggleMaster = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (subscribed) {
        const result = await unsubscribe();
        if (!result.ok) showStatus('Could not unsubscribe — try again');
        else showStatus('Push notifications turned off');
        return;
      }
      const result = await subscribe();
      if (result.ok) {
        showStatus("Push notifications on — you'll get alerts even when Bantryx is closed");
        return;
      }
      // Map failure reasons to actionable messages.
      switch (result.reason) {
        case 'denied':
          showStatus('Notifications blocked — enable them in your browser/OS settings');
          break;
        case 'server-not-configured':
          showStatus('Push is not configured on the server yet');
          break;
        case 'dismissed':
          // User cancelled the OS permission prompt — no toast needed.
          break;
        default:
          showStatus("Couldn't enable push — try again in a moment");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePref = async (type, nextValue) => {
    // Optimistic update — revert on PUT failure.
    const prev = prefs;
    const next = { ...prefs, [type]: nextValue };
    setPrefs(next);
    try {
      await request('/api/me/push-preferences', {
        method: 'PUT',
        body: JSON.stringify({ prefs: { [type]: nextValue } }),
      });
    } catch (error) {
      setPrefs(prev);
      showStatus(`Could not save: ${error.message || 'unknown error'}`);
    }
  };

  return (
    <div className="rounded-3xl border border-default bg-elevated/70 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">
            Push notifications
          </h3>
          <p className="mt-2 text-sm text-fg">
            Get pick-scored, kickoff, and other alerts on this device — even when Bantryx is closed.
          </p>
        </div>
        <Switch
          checked={subscribed}
          onChange={handleToggleMaster}
          disabled={busy || checking || permission === 'denied'}
          aria-label="Enable push notifications"
        />
      </div>

      {permission === 'denied' ? (
        <div className="mt-3 rounded-2xl bg-danger/10 p-3 text-xs text-danger">
          Notifications are blocked at the browser/OS level. To enable: open this site's permissions
          in your browser (lock icon next to the URL) or your OS settings, allow notifications, then
          come back and toggle it on.
        </div>
      ) : null}

      {subscribed ? (
        <fieldset className="mt-4 space-y-2">
          <legend className="text-xs uppercase tracking-[0.2em] text-fg-muted">What to send</legend>
          {NOTIFICATION_TYPES.map((t) => {
            const enabled = prefs[t.key] !== false;
            return (
              <label
                key={t.key}
                htmlFor={`push-pref-${t.key}`}
                className="flex cursor-pointer items-start gap-3 rounded-2xl bg-overlay/70 p-3 hover:bg-overlay"
              >
                <Checkbox
                  id={`push-pref-${t.key}`}
                  checked={enabled}
                  onChange={(e) => handleTogglePref(t.key, e.target.checked)}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-fg">{t.label}</span>
                  <span className="text-xs text-fg-muted">{t.description}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : null}

      <DiagnosticBlock data={diag} />
    </div>
  );
}

export default PushSettingsPanel;
