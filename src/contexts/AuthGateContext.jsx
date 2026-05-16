'use strict';

// AuthGateContext — central place to ask "is this visitor signed in, and if
// not, prompt them to". Used by every component that has an action button
// (pick / react / friend request / public group join / etc.) so anonymous
// browse mode can intercept the click and pop a "Sign in to {label}" modal
// instead of hitting the API with no session.
import { createContext, useCallback, useContext, useState } from 'react';
import { useAuth } from './AuthContext';

const AuthGateContext = createContext(null);

export function AuthGateProvider({ children }) {
  const { user } = useAuth();
  const [gateState, setGateState] = useState({ open: false, label: '' });

  // gate(label) — call at the top of any action handler.
  //   if signed in: returns true; caller proceeds.
  //   if anon:      returns false; modal opens with "Sign in to {label}".
  const gate = useCallback(
    (label) => {
      if (user) return true;
      setGateState({ open: true, label: label || 'do this' });
      return false;
    },
    [user],
  );

  const closeGate = useCallback(() => {
    setGateState({ open: false, label: '' });
  }, []);

  return (
    <AuthGateContext.Provider value={{ gate, gateState, closeGate }}>
      {children}
    </AuthGateContext.Provider>
  );
}

export function useAuthGate() {
  const ctx = useContext(AuthGateContext);
  if (!ctx) throw new Error('useAuthGate must be used within AuthGateProvider');
  return ctx;
}
