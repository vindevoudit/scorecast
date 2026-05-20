import { useCallback, useEffect, useState } from 'react';

// Detects whether the app is already running as an installed PWA, whether the
// device is iOS (where the install path is "Share > Add to Home Screen" rather
// than a fireable prompt), and surfaces the captured `beforeinstallprompt`
// event so a component can fire the native install prompt on user gesture.
//
// Browser support matrix:
//   - Android Chrome / Edge / Brave / Samsung Internet: fires
//     `beforeinstallprompt`, exposes `canPrompt: true`.
//   - Desktop Chromium (Chrome / Edge): same as above.
//   - iOS Safari / Chrome / Firefox: never fires the event; user must use
//     Share > Add to Home Screen. `isIos: true` lets the UI render that path.
//   - Firefox desktop: no install prompt event, no PWA install (yet); both
//     `isIos` and `canPrompt` are false — the calling component should render
//     nothing in this case.
function detectIos() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports itself as Mac. Touch points > 1 + Mac platform is the
  // standard probe — desktop Macs report `maxTouchPoints === 0`.
  if (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1) return true;
  return false;
}

function detectStandalone() {
  if (typeof window === 'undefined') return false;
  // Android / Chromium signal.
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // Legacy iOS signal — Apple kept honoring it after switching to the manifest
  // spec, so reading both keeps us covered across iOS versions.
  if (window.navigator.standalone === true) return true;
  return false;
}

export function useStandalone() {
  const [isStandalone, setIsStandalone] = useState(detectStandalone);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const isIos = detectIos();

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      // Chromium fires this when install is available. Stash the event so a
      // user-initiated click can call `.prompt()` later — calling it without
      // a user gesture throws.
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const onAppInstalled = () => {
      // The native install completed (Android / Chromium). Drop the stash and
      // flip standalone optimistically — the matchMedia listener below also
      // catches this but only after the next paint.
      setDeferredPrompt(null);
      setIsStandalone(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    // Reflect display-mode changes (rare, but happens when the user opens the
    // PWA shortcut for the first time without a full reload).
    const mql = window.matchMedia?.('(display-mode: standalone)');
    const onChange = (e) => setIsStandalone(e.matches || window.navigator.standalone === true);
    mql?.addEventListener?.('change', onChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      mql?.removeEventListener?.('change', onChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return { outcome: 'unavailable' };
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    // The event is single-use — null it out so a second click no-ops cleanly.
    setDeferredPrompt(null);
    return choice;
  }, [deferredPrompt]);

  return {
    isStandalone,
    isIos,
    canPrompt: Boolean(deferredPrompt),
    promptInstall,
  };
}
