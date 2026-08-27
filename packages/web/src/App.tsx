import { useCallback, useEffect, useState } from 'react';
import * as api from './lib/api';
import { ApiError } from './lib/api';
import type { UserProfile } from './lib/types';
import LoginScreen from './auth/LoginScreen';
import Dashboard from './Dashboard';
import Spinner from './components/Spinner';

type Status = 'loading' | 'loggedOut' | 'loggedIn';

export default function App() {
  const [status, setStatus] = useState<Status>('loading');
  const [profile, setProfile] = useState<UserProfile | undefined>(undefined);
  const [expired, setExpired] = useState(false);

  const refreshSession = useCallback(async () => {
    const s = await api.getSession();
    if (s.loggedIn) {
      setProfile(s.profile);
      setStatus('loggedIn');
    } else {
      setProfile(undefined);
      setStatus('loggedOut');
    }
  }, []);

  useEffect(() => {
    refreshSession().catch(() => setStatus('loggedOut'));
  }, [refreshSession]);

  // Any 401 from a child call routes back to login with a "session expired" notice.
  const onSessionExpired = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      setExpired(true);
      setProfile(undefined);
      setStatus('loggedOut');
      return true;
    }
    return false;
  }, []);

  const handleLoggedIn = useCallback(async () => {
    setExpired(false);
    await refreshSession();
  }, [refreshSession]);

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // ignore — we drop to the login screen regardless
    }
    setProfile(undefined);
    setStatus('loggedOut');
  }, []);

  if (status === 'loading') {
    return (
      <div className="app-center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (status === 'loggedOut') {
    return <LoginScreen onLoggedIn={handleLoggedIn} sessionExpired={expired} />;
  }

  return (
    <Dashboard
      profile={profile}
      onLogout={handleLogout}
      onSessionExpired={onSessionExpired}
    />
  );
}
