import { FormEvent, useState } from 'react';
import * as api from '../lib/api';
import Spinner from '../components/Spinner';

interface LoginScreenProps {
  onLoggedIn: () => void | Promise<void>;
  sessionExpired?: boolean;
}

export default function LoginScreen({ onLoggedIn, sessionExpired }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.login(email, password);
      if (res.ok) {
        await onLoggedIn();
      } else {
        setError(res.error ?? 'Login failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-center">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">Toptracer Range Analyzer</h1>
        {sessionExpired ? (
          <div className="banner banner-warn">Your session expired. Please log in again.</div>
        ) : null}
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? <div className="banner banner-error">{error}</div> : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? <Spinner small label="Signing in…" /> : 'Sign in'}
        </button>
        <p className="login-help">
          Use your Toptracer Range account credentials. They are sent once to log you in and
          are <strong>not stored</strong> — only a refresh token is kept so the app can talk to
          Toptracer on your behalf.
        </p>
      </form>
    </div>
  );
}
