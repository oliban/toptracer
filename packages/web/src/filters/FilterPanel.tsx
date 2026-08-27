import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import type { Club, DistanceMetric, FilterOptions } from '../lib/types';

interface FilterPanelProps {
  filter: FilterOptions;
  onChange: (next: FilterOptions) => void;
  onSessionExpired: (err: unknown) => boolean;
  summary?: { excluded: number; total: number } | null;
}

export default function FilterPanel({ filter, onChange, onSessionExpired, summary }: FilterPanelProps) {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubsError, setClubsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getClubs()
      .then((c) => {
        if (!cancelled) setClubs(c);
      })
      .catch((err) => {
        if (onSessionExpired(err)) return;
        if (!cancelled) setClubsError(err instanceof Error ? err.message : 'Failed to load clubs');
      });
    return () => {
      cancelled = true;
    };
  }, [onSessionExpired]);

  function setMetric(metric: DistanceMetric) {
    onChange({ ...filter, metric });
  }

  function toggleClub(clubDisplayName: string) {
    const current = filter.clubs ?? [];
    const has = current.includes(clubDisplayName);
    const next = has
      ? current.filter((c) => c !== clubDisplayName)
      : [...current, clubDisplayName];
    // Empty selection => undefined (means "all").
    onChange({ ...filter, clubs: next.length ? next : undefined });
  }

  const selectedClubs = filter.clubs;

  return (
    <div className="filter-panel">
      <h2 className="panel-title">Filters</h2>

      <section className="filter-group">
        <label className="filter-label">Metric</label>
        <div className="toggle-row">
          <button
            className={filter.metric === 'flatCarry' ? 'toggle active' : 'toggle'}
            onClick={() => setMetric('flatCarry')}
          >
            Flat Carry
          </button>
          <button
            className={filter.metric === 'total' ? 'toggle active' : 'toggle'}
            onClick={() => setMetric('total')}
          >
            Total
          </button>
        </div>
      </section>

      <section className="filter-group">
        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={filter.cleanHit.enabled}
            onChange={(e) =>
              onChange({
                ...filter,
                cleanHit: { ...filter.cleanHit, enabled: e.target.checked },
              })
            }
          />
          <span>Clean-hit filter (remove bad hits)</span>
        </label>
        <p className="filter-help">
          Marks weak shots as <strong>bad hits</strong> and leaves them out of the averages. Bad
          hits show as grey dots on the Dispersion chart.
        </p>

        {filter.cleanHit.enabled && summary && summary.total > 0 ? (
          <div className="filter-effect">
            Excluding <strong>{summary.excluded}</strong> of {summary.total} shots{' '}
            ({Math.round((summary.excluded / summary.total) * 100)}%) as bad hits
          </div>
        ) : null}

        <div className={filter.cleanHit.enabled ? 'subgroup' : 'subgroup disabled'}>
          <div className="toggle-row mode-toggle">
            <button
              className={filter.cleanHit.mode === 'iqr' ? 'toggle active' : 'toggle'}
              disabled={!filter.cleanHit.enabled}
              onClick={() => onChange({ ...filter, cleanHit: { ...filter.cleanHit, mode: 'iqr' } })}
            >
              Auto
            </button>
            <button
              className={filter.cleanHit.mode === 'manual' ? 'toggle active' : 'toggle'}
              disabled={!filter.cleanHit.enabled}
              onClick={() => onChange({ ...filter, cleanHit: { ...filter.cleanHit, mode: 'manual' } })}
            >
              My rules
            </button>
          </div>

          {filter.cleanHit.mode === 'iqr' ? (
            <>
              <p className="filter-help">Automatic: drops each club's statistical outliers.</p>
              <label className="filter-label">
                Strictness k: <strong>{filter.cleanHit.k.toFixed(1)}</strong>
              </label>
              <input
                type="range"
                min={1.0}
                max={2.0}
                step={0.1}
                value={filter.cleanHit.k}
                disabled={!filter.cleanHit.enabled}
                onChange={(e) =>
                  onChange({ ...filter, cleanHit: { ...filter.cleanHit, k: parseFloat(e.target.value) } })
                }
              />
              <div className="slider-hint">
                <span>lower = stricter<br />(removes more)</span>
                <span style={{ textAlign: 'right' }}>higher = looser<br />(keeps more)</span>
              </div>

              <label className="filter-label">Min shots per club</label>
              <input
                type="number"
                min={1}
                className="num-input"
                value={filter.cleanHit.minShots}
                disabled={!filter.cleanHit.enabled}
                onChange={(e) =>
                  onChange({
                    ...filter,
                    cleanHit: { ...filter.cleanHit, minShots: Math.max(1, parseInt(e.target.value, 10) || 1) },
                  })
                }
              />

              <label className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={filter.cleanHit.filterLateral}
                  disabled={!filter.cleanHit.enabled}
                  onChange={(e) =>
                    onChange({ ...filter, cleanHit: { ...filter.cleanHit, filterLateral: e.target.checked } })
                  }
                />
                <span>Also trim lateral outliers</span>
              </label>
            </>
          ) : (
            <>
              <p className="filter-help">You decide: set the limits and any shot past them is a bad hit.</p>

              <label className="filter-label">
                Max sideways spread: <strong>±{filter.cleanHit.maxOffline} m</strong>
              </label>
              <input
                type="range"
                min={5}
                max={80}
                step={1}
                value={filter.cleanHit.maxOffline}
                disabled={!filter.cleanHit.enabled}
                onChange={(e) =>
                  onChange({ ...filter, cleanHit: { ...filter.cleanHit, maxOffline: parseInt(e.target.value, 10) } })
                }
              />
              <div className="slider-hint">
                <span>lands more than this far left/right → bad hit</span>
              </div>

              <label className="filter-label">
                Max shortfall: <strong>{filter.cleanHit.shortfallPct}% short</strong>
              </label>
              <input
                type="range"
                min={5}
                max={60}
                step={1}
                value={filter.cleanHit.shortfallPct}
                disabled={!filter.cleanHit.enabled}
                onChange={(e) =>
                  onChange({ ...filter, cleanHit: { ...filter.cleanHit, shortfallPct: parseInt(e.target.value, 10) } })
                }
              />
              <div className="slider-hint">
                <span>
                  flies this % (or more) short of the club's usual distance → bad hit. e.g. 20% = under 80% of typical.
                  Long shots are kept.
                </span>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="filter-group">
        <label className="filter-label">Clubs</label>
        {clubsError ? <div className="banner banner-error">{clubsError}</div> : null}
        {clubs.length === 0 && !clubsError ? (
          <p className="muted">No clubs yet — sync first.</p>
        ) : (
          <div className="club-list">
            {clubs.map((club) => {
              const checked = !selectedClubs || selectedClubs.includes(club.clubDisplayName);
              return (
                <label key={club.id} className="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleClub(club.clubDisplayName)}
                  />
                  <span>{club.clubDisplayName}</span>
                </label>
              );
            })}
          </div>
        )}
        {selectedClubs ? (
          <button className="link-btn" onClick={() => onChange({ ...filter, clubs: undefined })}>
            Select all
          </button>
        ) : null}
      </section>

      <section className="filter-group">
        <label className="filter-label">Date range</label>
        <div className="date-row">
          <input
            type="date"
            value={filter.dateFrom ? filter.dateFrom.slice(0, 10) : ''}
            onChange={(e) =>
              onChange({ ...filter, dateFrom: e.target.value ? e.target.value : undefined })
            }
          />
          <span className="date-sep">to</span>
          <input
            type="date"
            value={filter.dateTo ? filter.dateTo.slice(0, 10) : ''}
            onChange={(e) =>
              onChange({ ...filter, dateTo: e.target.value ? e.target.value : undefined })
            }
          />
        </div>
      </section>
    </div>
  );
}
