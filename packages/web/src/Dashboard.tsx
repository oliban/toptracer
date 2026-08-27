import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './lib/api';
import type { FilterOptions, GappingResult, SyncResult, UserProfile } from './lib/types';
import FilterPanel from './filters/FilterPanel';
import OverviewView from './views/OverviewView';
import GappingView from './views/GappingView';
import DispersionView from './views/DispersionView';
import SessionsView from './views/SessionsView';
import Spinner from './components/Spinner';

interface DashboardProps {
  profile: UserProfile | undefined;
  onLogout: () => void;
  onSessionExpired: (err: unknown) => boolean;
}

const DEFAULT_FILTER: FilterOptions = {
  metric: 'flatCarry',
  cleanHit: { enabled: true, mode: 'iqr', k: 1.5, minShots: 8, filterLateral: false, maxOffline: 45, shortfallPct: 40 },
};

type Tab = 'overview' | 'gapping' | 'dispersion' | 'sessions';

export default function Dashboard({ profile, onLogout, onSessionExpired }: DashboardProps) {
  const [filter, setFilter] = useState<FilterOptions>(DEFAULT_FILTER);
  const [result, setResult] = useState<GappingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile filter drawer

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Track whether anything has been synced. Empty gapping (no shots) => prompt to sync.
  const hasData = result !== null && result.shots.length > 0;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGapping = useCallback(
    async (f: FilterOptions) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.gapping(f);
        setResult(res);
      } catch (err) {
        if (onSessionExpired(err)) return;
        setError(err instanceof Error ? err.message : 'Failed to load gapping data');
      } finally {
        setLoading(false);
      }
    },
    [onSessionExpired],
  );

  // Debounced re-fetch whenever the filter changes.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchGapping(filter);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filter, fetchGapping]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const res = await api.sync();
      setSyncResult(res);
      await fetchGapping(filter);
    } catch (err) {
      if (onSessionExpired(err)) return;
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [fetchGapping, filter, onSessionExpired]);

  // On load: cached data renders immediately (via the gapping fetch above); in the
  // background do a cheap incremental sync that only pulls sessions we don't have yet.
  const didAutoCheck = useRef(false);
  useEffect(() => {
    if (didAutoCheck.current) return;
    didAutoCheck.current = true;
    (async () => {
      setSyncing(true);
      try {
        const res = await api.sync(); // incremental; skips cached sessions
        setSyncResult(res);
        if (res.newSessions > 0 || res.shots > 0) await fetchGapping(filter);
      } catch (err) {
        if (onSessionExpired(err)) return;
        // silent — cached data is already on screen
      } finally {
        setSyncing(false);
      }
    })();
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand">Toptracer Range Analyzer</span>
          <span className="brand-short">Range Analyzer</span>
          {profile?.profileName ? (
            <span className="profile-name">{profile.profileName}</span>
          ) : null}
        </div>
        <div className="topbar-right">
          {syncing ? (
            <span className="sync-counts">Checking for new sessions…</span>
          ) : syncResult ? (
            <span className="sync-counts">
              {syncResult.newSessions > 0
                ? `+${syncResult.newSessions} new session${syncResult.newSessions > 1 ? 's' : ''} · `
                : '✓ up to date · '}
              {syncResult.sessions} sessions
            </span>
          ) : null}
          {syncError ? <span className="sync-error">{syncError}</span> : null}
          <button className="btn btn-accent" onClick={handleSync} disabled={syncing}>
            {syncing ? <Spinner small label="Syncing…" /> : 'Sync'}
          </button>
          <button className="btn btn-ghost" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <div className="dashboard-body">
        {filtersOpen ? (
          <div className="sidebar-backdrop" onClick={() => setFiltersOpen(false)} />
        ) : null}
        <aside className={`sidebar${filtersOpen ? ' open' : ''}`}>
          <div className="sidebar-mobile-head">
            <span>Filters</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setFiltersOpen(false)}>
              Done
            </button>
          </div>
          <FilterPanel
            filter={filter}
            onChange={setFilter}
            onSessionExpired={onSessionExpired}
            summary={
              result
                ? { excluded: result.shots.filter((s) => s.excluded).length, total: result.shots.length }
                : null
            }
          />
        </aside>

        <main className="content">
          <button className="filters-toggle" onClick={() => setFiltersOpen(true)}>
            <span className="filters-toggle-icon">☰</span> Filters
          </button>
          <nav className="tabs">
            <button
              className={tab === 'overview' ? 'tab active' : 'tab'}
              onClick={() => setTab('overview')}
            >
              Overview
            </button>
            <button
              className={tab === 'gapping' ? 'tab active' : 'tab'}
              onClick={() => setTab('gapping')}
            >
              Gapping
            </button>
            <button
              className={tab === 'dispersion' ? 'tab active' : 'tab'}
              onClick={() => setTab('dispersion')}
            >
              Dispersion
            </button>
            <button
              className={tab === 'sessions' ? 'tab active' : 'tab'}
              onClick={() => setTab('sessions')}
            >
              Sessions
            </button>
            {loading ? <Spinner small label="Updating…" /> : null}
          </nav>

          {error ? <div className="banner banner-error">{error}</div> : null}

          {!hasData && !loading ? (
            <div className="empty-state">
              <h2>No data yet</h2>
              <p>Click <strong>Sync</strong> to pull your sessions and shots from Toptracer Range.</p>
              <button className="btn btn-accent" onClick={handleSync} disabled={syncing}>
                {syncing ? <Spinner small label="Syncing…" /> : 'Sync now'}
              </button>
            </div>
          ) : (
            <>
              {tab === 'overview' ? (
                <OverviewView filter={filter} onSessionExpired={onSessionExpired} />
              ) : null}
              {tab === 'gapping' && result ? (
                <GappingView result={result} />
              ) : null}
              {tab === 'dispersion' && result ? (
                <DispersionView
                  result={result}
                  metric={filter.metric}
                  onMetricChange={(metric) => setFilter({ ...filter, metric })}
                />
              ) : null}
              {tab === 'sessions' ? (
                <SessionsView onSessionExpired={onSessionExpired} />
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
