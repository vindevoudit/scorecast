'use strict';

// Tier 13 Chunk 3 / Tier 11 Chunk 2 — NotificationContext.
//
// Public API stays the same as Tier 13 (`status`, `setStatus`, `showStatus`)
// so existing callers keep working. Under the hood it now drives a Radix
// Toast queue instead of a single sticky inline banner.
//
// - `showStatus(message)` / `setStatus(message)` push a neutral toast (3.5s).
//   `setStatus('')` is a no-op — toasts auto-dismiss; legacy callers can stop
//   calling it but don't have to.
// - `notify({ title, description, tone, duration })` is the richer API for
//   new call sites — pass tone='success' | 'danger' | 'info' for color.
// - The `scorecast:client-error` DOM event still triggers a generic toast.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Toast,
  ToastDescription,
  ToastTitle,
  ToastProvider,
  ToastViewport,
  ToastClose,
} from '../components/ui';

const DEFAULT_DURATION = 3500;

const NotificationContext = createContext(null);

let toastIdCounter = 0;
const nextToastId = () => {
  toastIdCounter += 1;
  return `t${toastIdCounter}`;
};

export function NotificationProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [legacyStatus, setLegacyStatus] = useState('');
  const legacyTimer = useRef(null);

  // Push a toast. Returns the id so callers can dismiss programmatically
  // if they ever need to.
  const notify = useCallback(({ title, description, tone = 'neutral', duration } = {}) => {
    const id = nextToastId();
    const t = {
      id,
      title: title ?? null,
      description: description ?? null,
      tone,
      duration: duration ?? DEFAULT_DURATION,
    };
    setToasts((prev) => [...prev, t]);
    return id;
  }, []);

  // Legacy: keep `status` string state in sync with the latest emit so any
  // unmigrated consumers still see something. `setStatus(msg)` continues to
  // work; empty string clears the legacy field but does NOT cancel toasts.
  const setStatus = useCallback(
    (message) => {
      setLegacyStatus(message || '');
      if (legacyTimer.current) {
        clearTimeout(legacyTimer.current);
        legacyTimer.current = null;
      }
      if (message) {
        notify({ description: message });
        legacyTimer.current = setTimeout(() => setLegacyStatus(''), DEFAULT_DURATION);
      }
    },
    [notify],
  );

  const showStatus = useCallback(
    async (message) => {
      setStatus(message);
    },
    [setStatus],
  );

  useEffect(() => {
    const handler = (event) => {
      // Tier 18 Chunk 6 — skip the generic toast for errors that the
      // throwing code path already surfaced (4xx responses via
      // useRequest). clientErrorReporter normally suppresses these
      // upstream; this is a second-line guard for the future case
      // where an unhandled rejection still carries the flag.
      if (event?.detail?.wasHandled) return;
      notify({
        description: 'Something went wrong — refresh if things look off.',
        tone: 'danger',
      });
    };
    window.addEventListener('scorecast:client-error', handler);
    return () => {
      window.removeEventListener('scorecast:client-error', handler);
      if (legacyTimer.current) clearTimeout(legacyTimer.current);
    };
  }, [notify]);

  const handleOpenChange = useCallback((id, open) => {
    if (!open) setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(
    () => ({ status: legacyStatus, setStatus, showStatus, notify }),
    [legacyStatus, setStatus, showStatus, notify],
  );

  return (
    <NotificationContext.Provider value={value}>
      <ToastProvider duration={DEFAULT_DURATION} swipeDirection="right">
        {children}
        {toasts.map((t) => (
          <Toast
            key={t.id}
            tone={t.tone}
            duration={t.duration}
            onOpenChange={(open) => handleOpenChange(t.id, open)}
          >
            <div className="flex-1 pr-6">
              {t.title ? <ToastTitle>{t.title}</ToastTitle> : null}
              {t.description ? <ToastDescription>{t.description}</ToastDescription> : null}
            </div>
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
