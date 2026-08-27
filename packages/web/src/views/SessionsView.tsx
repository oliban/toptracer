import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import type { Session } from '../lib/types';
import Spinner from '../components/Spinner';

interface SessionsViewProps {
  onSessionExpired: (err: unknown) => boolean;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function SessionsView({ onSessionExpired }: SessionsViewProps) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getSessions()
      .then((s) => {
        if (!cancelled) setSessions(s);
      })
      .catch((err) => {
        if (onSessionExpired(err)) return;
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load sessions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onSessionExpired]);

  if (loading) return <Spinner label="Loading sessions…" />;
  if (error) return <div className="banner banner-error">{error}</div>;

  const rows = sessions ?? [];

  return (
    <div className="card">
      <div className="card-header">
        <h2>Sessions</h2>
        <span className="card-sub">{rows.length} total</span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Range</th>
              <th>Mode</th>
              <th className="num">Traced shots</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted center">
                  No sessions — click Sync to load your data.
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={s.id}>
                  <td>{fmtDate(s.beginTimestamp ?? s.timestamp)}</td>
                  <td>{s.rangeName ?? '—'}</td>
                  <td>{s.gameMode}</td>
                  <td className="num">{s.tracedShots ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
