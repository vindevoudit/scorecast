'use strict';

// Tier 13 Chunk 3 — NotificationContext. Owns the status banner state.
// Subscribes to the `scorecast:client-error` DOM event raised by
// ErrorBoundary + clientErrorReporter so any uncaught render or window
// error surfaces as a transient toast.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const [status, setStatus] = useState('');
  const timerRef = useRef(null);

  const showStatus = useCallback(async (message) => {
    setStatus(message);
    await delay(3500);
    setStatus('');
  }, []);

  useEffect(() => {
    const handler = () => {
      setStatus('Something went wrong — refresh if things look off.');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStatus(''), 3500);
    };
    window.addEventListener('scorecast:client-error', handler);
    return () => {
      window.removeEventListener('scorecast:client-error', handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <NotificationContext.Provider value={{ status, setStatus, showStatus }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
