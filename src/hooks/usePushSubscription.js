import { useCallback, useEffect, useState } from 'react';
import { useRequest } from './useRequest';

// PWA Chunk 5 — encapsulates the W3C Push API ceremony so PushSettingsPanel
// stays presentational. Three pieces of state surface up: `supported` (does
// this browser even have PushManager + Notifications?), `permission`
// (Notification.permission), and `subscribed` (is the current SW registration
// actually subscribed?).
//
// subscribe(): permission prompt -> fetch VAPID public key -> pushManager
// .subscribe() -> POST /api/push/subscribe. Returns the outcome so the caller
// can surface "permission denied" / "server not configured" toasts.

// VAPID public keys arrive over the wire as URL-safe base64 (RFC 7515). The
// W3C PushSubscription API wants the raw bytes as a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function detectSupport() {
  if (typeof window === 'undefined') return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function readPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export function usePushSubscription() {
  const request = useRequest();
  const [supported] = useState(detectSupport);
  const [permission, setPermission] = useState(readPermission);
  const [subscribed, setSubscribed] = useState(false);
  const [checking, setChecking] = useState(true);

  // On mount (and whenever the SW registration changes), probe pushManager
  // for an existing subscription so the UI reflects reality after a reload.
  useEffect(() => {
    if (!supported) {
      setChecking(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setSubscribed(Boolean(existing));
      } catch {
        if (!cancelled) setSubscribed(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const subscribe = useCallback(async () => {
    if (!supported) return { ok: false, reason: 'unsupported' };

    // Ask the user. Per spec, requestPermission() must be triggered by a
    // user gesture; this hook is only ever called from a click handler so
    // we're fine. If the user previously denied, this resolves immediately
    // with 'denied' without showing UI.
    let next = permission;
    if (permission === 'default') {
      next = await Notification.requestPermission();
      setPermission(next);
    }
    if (next !== 'granted') {
      return { ok: false, reason: next === 'denied' ? 'denied' : 'dismissed' };
    }

    // Fetch the server's VAPID public key. 503 means push isn't configured
    // (no VAPID env on the server). Surface that distinctly so the UI can
    // explain rather than silently failing.
    let vapidKey;
    try {
      const data = await request('/api/push/vapid-public-key');
      vapidKey = data?.publicKey;
    } catch (err) {
      if (String(err.message).match(/503|not configured/i)) {
        return { ok: false, reason: 'server-not-configured' };
      }
      return { ok: false, reason: 'vapid-fetch-failed', error: err.message };
    }
    if (!vapidKey) return { ok: false, reason: 'server-not-configured' };

    let subscription;
    try {
      const reg = await navigator.serviceWorker.ready;
      // Reuse an existing subscription if the browser still has one for this
      // origin — re-subscribing with a different applicationServerKey would
      // require unsubscribing first, which is a worse UX.
      subscription =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));
    } catch (err) {
      return { ok: false, reason: 'pushmanager-subscribe-failed', error: err.message };
    }

    // Mirror the subscription on the server so notify() can fan out to it.
    const json = subscription.toJSON();
    try {
      await request('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
    } catch (err) {
      // Best-effort rollback — drop the local subscription so we don't end
      // up with a browser subscription the server doesn't know about.
      try {
        await subscription.unsubscribe();
      } catch {
        // ignore
      }
      return { ok: false, reason: 'server-subscribe-failed', error: err.message };
    }

    setSubscribed(true);
    return { ok: true };
  }, [supported, permission, request]);

  const unsubscribe = useCallback(async () => {
    if (!supported) return { ok: false, reason: 'unsupported' };
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setSubscribed(false);
        return { ok: true };
      }
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      // Server-side delete is best-effort — if it fails the row stays as an
      // orphan but the next push to it will 410 -> auto-purge.
      try {
        await request('/api/push/subscribe', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint }),
        });
      } catch {
        // ignore
      }
      setSubscribed(false);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'unsubscribe-failed', error: err.message };
    }
  }, [supported, request]);

  return {
    supported,
    permission,
    subscribed,
    checking,
    subscribe,
    unsubscribe,
  };
}
