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

export default function GappingView({ result }: GappingViewProps) {
  const { clubs } = result;
  const metricLabel = result.appliedFilter.metric === 'flatCarry' ? 'Flat Carry' : 'Total';

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
