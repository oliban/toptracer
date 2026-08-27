import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import type { DistanceMetric, GappingResult } from '../lib/types';
import DispersionScatter from '../charts/DispersionScatter';

interface DispersionViewProps {
  result: GappingResult;
  metric: DistanceMetric;
  onMetricChange: (m: DistanceMetric) => void;
}

export default function DispersionView({ result, metric, onMetricChange }: DispersionViewProps) {
  // Session timestamps → per-shot recency (older shots render fainter).
  const [sessionTs, setSessionTs] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    api
      .getSessions()
      .then((sessions) => {
        if (cancelled) return;
        const m = new Map<string, number>();
        for (const s of sessions) {
          const iso = s.timestamp ?? s.beginTimestamp;
          const t = iso ? Date.parse(iso) : NaN;
          if (!Number.isNaN(t)) m.set(s.id, t);
        }
        setSessionTs(m);
      })
      .catch(() => {
        /* recency is best-effort; ignore */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Clubs with kept shots, sorted by length (longest first), with kept-shot counts.
  const clubList = useMemo(
    () =>
      result.clubs
        .filter((c) => c.keptShots > 0)
        .slice()
        .sort((a, b) => (b.median ?? -Infinity) - (a.median ?? -Infinity))
        .map((c) => ({ name: c.clubDisplayName, kept: c.keptShots, total: c.totalShots })),
    [result.clubs],
  );
  const availableClubs = useMemo(() => clubList.map((c) => c.name), [clubList]);

  // Per-club "freshness": days since the most recent shot with that club.
  const clubDaysAgo = useMemo(() => {
    const lastTs = new Map<string, number>();
    for (const s of result.shots) {
      if (!s.clubDisplayName) continue;
      const t = sessionTs.get(s.sessionId);
      if (t == null) continue;
      const prev = lastTs.get(s.clubDisplayName);
      if (prev == null || t > prev) lastTs.set(s.clubDisplayName, t);
    }
    const now = Date.now();
    const days = new Map<string, number>();
    for (const [club, t] of lastTs) days.set(club, Math.max(0, Math.round((now - t) / 86_400_000)));
    return days;
  }, [result.shots, sessionTs]);

  function freshLevel(days: number | undefined): string {
    if (days == null) return '';
    if (days <= 30) return 'fresh-good';
    if (days <= 120) return 'fresh-mid';
    return 'fresh-old';
  }
  function freshLabel(days: number | undefined): string {
    if (days == null) return '';
    if (days === 0) return 'today';
    if (days < 60) return `${days}d`;
    if (days < 365) return `${Math.round(days / 30)}mo`;
    return `${(days / 365).toFixed(days < 730 ? 1 : 0)}y`;
  }

  // null selection => show all.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [hideBadHits, setHideBadHits] = useState(false);
  const [focusClub, setFocusClub] = useState<string | null>(null);

  const activeClubs = selected ?? new Set(availableClubs);

  const badTotal = useMemo(
    () => result.shots.filter((s) => s.excluded && s.clubDisplayName && activeClubs.has(s.clubDisplayName)).length,
    [result.shots, activeClubs],
  );

  function toggle(name: string) {
    const base = new Set(selected ?? availableClubs);
    if (base.has(name)) base.delete(name);
    else base.add(name);
    setSelected(base);
  }

  return (
    <div className="dispersion-view">
      <div className="dispersion-controls">
        <div className="toggle-row">
          <button
            className={metric === 'flatCarry' ? 'toggle active' : 'toggle'}
            onClick={() => onMetricChange('flatCarry')}
          >
            Flat Carry
          </button>
          <button
            className={metric === 'total' ? 'toggle active' : 'toggle'}
            onClick={() => onMetricChange('total')}
          >
            Total
          </button>
        </div>

        <div className="club-picker">
          {clubList.map(({ name, kept }) => (
            <label
              key={name}
              className={`chip${focusClub === name ? ' chip-focused' : ''}`}
              onMouseEnter={() => setFocusClub(name)}
              onMouseLeave={() => setFocusClub(null)}
              title={`${kept} clean shots${
                clubDaysAgo.get(name) != null ? ` · last hit ${clubDaysAgo.get(name)} days ago` : ''
              }`}
            >
              <input
                type="checkbox"
                checked={activeClubs.has(name)}
                onChange={() => toggle(name)}
              />
              <span>
                {name} <span className="chip-count">{kept}</span>
                {clubDaysAgo.get(name) != null ? (
                  <span className={`chip-fresh ${freshLevel(clubDaysAgo.get(name))}`}>
                    <span className="fresh-dot" />
                    {freshLabel(clubDaysAgo.get(name))}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
          {selected ? (
            <button className="link-btn" onClick={() => setSelected(null)}>
              All
            </button>
          ) : null}
        </div>

        {clubDaysAgo.size > 0 ? (
          <span className="fresh-legend" title="Days since your most recent shot with each club. Older = time to refresh that club's data.">
            last hit:
            <span className="fresh-good"><span className="fresh-dot" />≤30d</span>
            <span className="fresh-mid"><span className="fresh-dot" />≤120d</span>
            <span className="fresh-old"><span className="fresh-dot" />older</span>
          </span>
        ) : null}

        <label className="badhit-toggle" title="Bad hits are shots a club rarely produces — statistical outliers in distance (and optionally direction). Toggle the clean-hit filter and its strictness in the left Filters panel.">
          <input type="checkbox" checked={hideBadHits} onChange={(e) => setHideBadHits(e.target.checked)} />
          <span>Hide bad hits{badTotal > 0 ? ` (${badTotal})` : ''}</span>
        </label>
      </div>

      <p className="dispersion-help">
        Grey dots are <strong>bad hits</strong> — shots the clean-hit filter flagged as outliers for that club.
        Adjust which shots count as bad in the <strong>Filters</strong> panel (Clean-hit filter → Strictness),
        or tick <strong>Hide bad hits</strong> to drop them from the chart.
      </p>

      <DispersionScatter
        shots={result.shots}
        activeClubs={activeClubs}
        metric={metric}
        hideBadHits={hideBadHits}
        focusClub={focusClub}
        onFocusClub={setFocusClub}
        sessionTs={sessionTs}
      />
    </div>
  );
}
