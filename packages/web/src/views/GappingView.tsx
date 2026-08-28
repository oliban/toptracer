import type { GappingResult } from '../lib/types';
import GappingStrip from '../charts/GappingStrip';

interface GappingViewProps {
  result: GappingResult;
}

function fmt(v: number | null, digits = 1): string {
  return v === null || Number.isNaN(v) ? '—' : v.toFixed(digits);
}

function fmtBias(v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—';
  const side = v > 0 ? 'R' : v < 0 ? 'L' : '';
  return `${Math.abs(v).toFixed(1)} ${side}`.trim();
}

function scoreClass(s: number | null): string {
  if (s == null) return 'score-none';
  if (s >= 80) return 'score-good';
  if (s >= 60) return 'score-mid';
  return 'score-bad';
}

/** Consistency ranking: clubs sorted by overall tightness score, with a bar chart. */
function ConsistencyView({ result }: GappingViewProps) {
  const ranked = [...result.clubs]
    .filter((c) => c.keptShots > 0)
    .sort((a, b) => (b.consistencyScore ?? -1) - (a.consistencyScore ?? -1));

  return (
    <div className="gapping-view">
      <div className="card">
        <div className="card-header">
          <h2>Club consistency</h2>
          <span className="card-sub">Overall tightness (distance + direction). Higher = more consistent.</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Club</th>
                <th>Category</th>
                <th className="num">Score</th>
                <th className="num">Carry ± (m)</th>
                <th className="num">Offline ± (m)</th>
                <th className="num">Shots</th>
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted center">No clubs match the current filter.</td>
                </tr>
              ) : (
                ranked.map((c) => (
                  <tr key={c.clubDisplayName}>
                    <td className="strong">{c.clubDisplayName}</td>
                    <td>{c.category ?? '—'}</td>
                    <td className="num">
                      <span className={`score-pill ${scoreClass(c.consistencyScore)}`}>
                        {c.consistencyScore ?? '—'}
                      </span>
                    </td>
                    <td className="num">±{fmt(c.carryStd)}</td>
                    <td className="num">±{fmt(c.offlineStd)}</td>
                    <td className="num">{c.keptShots}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Consistency ranking</h2>
          <span className="card-sub">Tightness score 0–100 per club</span>
        </div>
        <div className="card-pad">
          <div className="consistency-bars">
            {ranked.map((c) => (
              <div key={c.clubDisplayName} className="cbar-row">
                <span className="cbar-label">{c.clubDisplayName}</span>
                <div className="cbar-track">
                  <div
                    className={`cbar-fill ${scoreClass(c.consistencyScore)}`}
                    style={{ width: `${c.consistencyScore ?? 0}%` }}
                  />
                </div>
                <span className="cbar-value">{c.consistencyScore ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GappingView({ result }: GappingViewProps) {
  if (result.appliedFilter.metric === 'consistency') {
    return <ConsistencyView result={result} />;
  }

  const { clubs } = result;
  const metricLabel = result.appliedFilter.metric === 'total' ? 'Total' : 'Flat Carry';

  return (
    <div className="gapping-view">
      <div className="card">
        <div className="card-header">
          <h2>Club gapping — {metricLabel}</h2>
          <span className="card-sub">Distances in meters</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Club</th>
                <th>Category</th>
                <th className="num">Kept</th>
                <th className="num">Excluded</th>
                <th className="num">Mean (m)</th>
                <th className="num">Median (m)</th>
                <th className="num">P25–P75 (m)</th>
                <th className="num">Lateral bias (m)</th>
              </tr>
            </thead>
            <tbody>
              {clubs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted center">
                    No clubs match the current filter.
                  </td>
                </tr>
              ) : (
                clubs.map((c) => (
                  <tr key={c.clubDisplayName}>
                    <td className="strong">
                      {c.clubDisplayName}
                      {!c.trimmed ? (
                        <span className="tag" title="Below min shots — not trimmed">
                          untrimmed
                        </span>
                      ) : null}
                    </td>
                    <td>{c.category ?? '—'}</td>
                    <td className="num">{c.keptShots}</td>
                    <td className="num">{c.excludedShots}</td>
                    <td className="num">{fmt(c.mean)}</td>
                    <td className="num">{fmt(c.median)}</td>
                    <td className="num">
                      {fmt(c.p25)}–{fmt(c.p75)}
                    </td>
                    <td className="num">{fmtBias(c.lateralBias)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Gapping strip</h2>
          <span className="card-sub">
            Blue bar = P25–P75 carry, blue tick = median carry ·{' '}
            <span className="roll-key">orange</span> line = roll out to median total (m)
          </span>
        </div>
        <GappingStrip clubs={clubs} />
      </div>
    </div>
  );
}
