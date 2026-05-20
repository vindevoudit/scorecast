import { useEffect, useState } from 'react';
import { useStandalone } from '../hooks/useStandalone';
import { Button } from './ui';

const DISMISS_KEY = 'sc_install_dismissed';

function readDismissed() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // Safari Private Mode throws on localStorage access — treat as not
    // dismissed (the banner is harmless to show again).
    return false;
  }
}

function writeDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // ignore — see readDismissed
  }
}

// Generic "install / add" indicator — a download-tray arrow. Used by the
// Chromium branch where the native prompt does the heavy lifting.
function InstallIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 4v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 19h14" />
    </svg>
  );
}

// iOS Safari share icon — square with arrow coming out the top. Visual cue
// that points users at the system share sheet they need to tap.
function IosShareIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 3v12" />
      <path d="M7 8l5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

function CloseIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 6l12 12M18 6l-12 12" />
    </svg>
  );
}

function InstallPrompt() {
  const { isStandalone, isIos, canPrompt, promptInstall } = useStandalone();
  const [dismissed, setDismissed] = useState(readDismissed);

  // If a returning user re-opens the app (e.g. after clearing storage) the
  // dismiss flag may have changed under us — re-read on mount/visibility.
  useEffect(() => {
    const onVisibility = () => setDismissed(readDismissed());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (isStandalone || dismissed) return null;

  // Show the iOS instructions path on iOS Safari (where beforeinstallprompt
  // never fires). On Android/Chromium we only render once the OS has handed
  // us an installable prompt — otherwise the banner is misleading.
  const showIos = isIos;
  const showChromium = !isIos && canPrompt;
  if (!showIos && !showChromium) return null;

  const onDismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  const onInstall = async () => {
    const choice = await promptInstall();
    // The user dismissed the native prompt — don't re-show the banner this
    // session. Accepted installs are caught by the `appinstalled` listener
    // in the hook (flips isStandalone -> true).
    if (choice?.outcome === 'dismissed') {
      onDismiss();
    }
  };

  return (
    <div
      role="region"
      aria-label="Install Bantryx"
      className="relative flex items-start gap-3 rounded-3xl border border-accent/30 bg-elevated/85 p-4 shadow-glow sm:items-center sm:gap-4 sm:p-5"
    >
      <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent sm:flex">
        {showIos ? <IosShareIcon className="h-6 w-6" /> : <InstallIcon className="h-6 w-6" />}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg sm:text-base">
          {showIos ? 'Add Bantryx to your Home Screen' : 'Install Bantryx'}
        </p>
        {showIos ? (
          <p className="mt-1 text-xs text-fg-muted sm:text-sm">
            Tap the <IosShareIcon className="inline h-4 w-4 align-text-bottom text-accent" /> Share
            icon in Safari, then choose{' '}
            <span className="font-medium text-fg">Add to Home Screen</span>. You'll get a
            full-screen app with push notifications.
          </p>
        ) : (
          <p className="mt-1 text-xs text-fg-muted sm:text-sm">
            Full screen, push notifications, and one tap to open from your home screen.
          </p>
        )}
        {showChromium ? (
          <div className="mt-3">
            <Button size="sm" onClick={onInstall}>
              Install app
            </Button>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss install prompt"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-fg-muted transition duration-200 hover:bg-overlay hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    </div>
  );
}

export default InstallPrompt;
