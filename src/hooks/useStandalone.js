import { useCallback, useEffect, useState } from 'react';
import {
  consumeCapturedInstallPrompt,
  getCapturedInstallPrompt,
  subscribe as subscribeToInstallCapture,
} from '../lib/installCapture';

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
//
// `beforeinstallprompt` race: Chromium fires the event ~500 ms after first
// paint, BEFORE this hook mounts (the hook lives under InstallPrompt /
// PushSettingsPanel which only render after auth + DashboardView). To avoid
// dropping the event, src/lib/installCapture.js attaches a window-level
// listener at module-import time (imported by main.jsx before React renders).
// The hook reads the cached event on mount + also subscribes to late events.
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
  // Initialize from the early-capture cache so we don't miss a
  // `beforeinstallprompt` that already fired before React mounted.
  const [deferredPrompt, setDeferredPrompt] = useState(() => getCapturedInstallPrompt());
  const isIos = detectIos();

  useEffect(() => {
    // Subscribe to late-firing events via the early-capture module so we
    // remain consistent whether the event fires before OR after this hook
    // mounts. Direct window listener also kept as a belt-and-suspenders.
    const unsubscribe = subscribeToInstallCapture((event) => {
      setDeferredPrompt(event);
    });
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const onAppInstalled = () => {
      // The native install completed (Android / Chromium). Drop the stash and
      // flip standalone optimistically — the matchMedia listener below also
      // catches this but only after the next paint.
      setDeferredPrompt(null);
      consumeCapturedInstallPrompt();
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
      unsubscribe();
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      mql?.removeEventListener?.('change', onChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    // Prefer state, but fall back to the module cache in case the event
    // arrived after this hook's state was last set — keeps the click handler
    // robust against the race.
    const prompt = deferredPrompt || consumeCapturedInstallPrompt();
    if (!prompt) return { outcome: 'unavailable' };
    prompt.prompt();
    const choice = await prompt.userChoice;
    // The event is single-use — null it out so a second click no-ops cleanly.
    setDeferredPrompt(null);
    consumeCapturedInstallPrompt();
    return choice;
  }, [deferredPrompt]);

  return {
    isStandalone,
    isIos,
    canPrompt: Boolean(deferredPrompt),
    promptInstall,
  };
}
