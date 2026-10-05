import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import type { Session } from '../lib/types';
import Spinner from '../components/Spinner';

interface SessionsViewProps {
  onSessionExpired: (err: unknown) => boolean;
  excluded: string[];
  onExcludedChange: (ids: string[]) => void;
  dateFrom?: string; // YYYY-MM-DD, local
  dateTo?: string;
}

function sessionDay(s: Session): string | null {
  const iso = s.beginTimestamp ?? s.timestamp;
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Mirrors the server's date scope so the table can show which sessions the range drops. */
function inDateRange(s: Session, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  const day = sessionDay(s);
  if (!day) return false;
  return (!from || day >= from.slice(0, 10)) && (!to || day <= to.slice(0, 10));
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function SessionsView({
  onSessionExpired,
  excluded,
  onExcludedChange,
  dateFrom,
  dateTo,
}: SessionsViewProps) {
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
  const excludedSet = new Set(excluded);
  const included = rows.filter((s) => !excludedSet.has(s.id) && inDateRange(s, dateFrom, dateTo));
  const allTicked = rows.every((s) => !excludedSet.has(s.id));

  function toggle(id: string) {
    onExcludedChange(excludedSet.has(id) ? excluded.filter((x) => x !== id) : [...excluded, id]);
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>Sessions</h2>
        <span className="card-sub">
          {included.length} of {rows.length} used in the stats · your ticks are remembered in this browser
        </span>
      </div>
      <div className="card-pad session-actions">
        <button className="link-btn" onClick={() => onExcludedChange([])} disabled={allTicked}>
          Tick all
        </button>
        <button className="link-btn" onClick={() => onExcludedChange(rows.map((s) => s.id))}>
          Untick all
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="check-col">
                <input
                  type="checkbox"
                  aria-label="Include all sessions"
                  checked={allTicked && rows.length > 0}
                  onChange={() => onExcludedChange(allTicked ? rows.map((s) => s.id) : [])}
                />
              </th>
              <th>Date</th>
              <th>Range</th>
              <th>Mode</th>
              <th className="num">Traced shots</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted center">
                  No sessions — click Sync to load your data.
                </td>
              </tr>
            ) : (
              rows.map((s) => {
                const ticked = !excludedSet.has(s.id);
                const inRange = inDateRange(s, dateFrom, dateTo);
                return (
                  <tr key={s.id} className={ticked && inRange ? undefined : 'row-off'}>
                    <td className="check-col">
                      <input
                        type="checkbox"
                        aria-label="Include session"
                        checked={ticked}
                        onChange={() => toggle(s.id)}
                      />
                    </td>
                    <td>
                      {fmtDate(s.beginTimestamp ?? s.timestamp)}
                      {ticked && !inRange ? (
                        <span className="tag" title="Outside the date range in Filters">
                          outside dates
                        </span>
                      ) : null}
                    </td>
                    <td>{s.rangeName ?? '—'}</td>
                    <td>{s.gameMode}</td>
                    <td className="num">{s.tracedShots ?? '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
