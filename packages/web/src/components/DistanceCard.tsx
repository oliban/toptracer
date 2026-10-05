import type { ClubGap, DistanceMetric } from '../lib/types';

interface DistanceCardProps {
  clubs: ClubGap[];
  metric: DistanceMetric;
  onMetricChange: (metric: DistanceMetric) => void;
}

const FEW_SHOTS = 5; // below this the numbers are a rough guess
const TIGHT_GAP = 6; // neighbouring clubs closer than this mostly overlap
const WIDE_GAP = 20; // a hole in the bag worth noticing

const r = (v: number) => Math.round(v);

/** Yardage-book style glance: how far each club goes, shortest first. */
export default function DistanceCard({ clubs, metric, onMetricChange }: DistanceCardProps) {
  const rows = clubs
    .filter((c) => c.median !== null && c.p25 !== null && c.p75 !== null && c.keptShots > 0)
    .sort((a, b) => a.median! - b.median!);
  // Bar scale spans the bag (shortest P25 → longest P75) with a little padding.
  const lo = Math.min(...rows.map((c) => c.p25!));
  const hi = Math.max(...rows.map((c) => c.p75!));
  const pad = Math.max(5, (hi - lo) * 0.05);
  const min = Math.max(0, lo - pad);
  const span = Math.max(1, hi + pad - min);
  const pos = (v: number) => ((v - min) / span) * 100;
  const axisMetric = metric === 'consistency' ? 'flatCarry' : metric;

  return (
    <div className="card">
      <div className="card-header">
        <h2>My distances</h2>
        <div className="toggle-row">
          <button
            className={axisMetric === 'flatCarry' ? 'toggle active' : 'toggle'}
            onClick={() => onMetricChange('flatCarry')}
          >
            Flat carry
          </button>
          <button
            className={axisMetric === 'total' ? 'toggle active' : 'toggle'}
            onClick={() => onMetricChange('total')}
          >
            Total
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="muted center card-pad">No clubs match the current filter.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table distance-card">
            <thead>
              <tr>
                <th>Club</th>
                <th className="num">Typical</th>
                <th className="num">Range</th>
                <th className="dist-bar-col" aria-hidden="true" />
                <th className="num">Gap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => {
                const gap = i > 0 ? r(c.median!) - r(rows[i - 1].median!) : null;
                const few = c.keptShots < FEW_SHOTS;
                const gapClass =
                  gap === null ? '' : gap < TIGHT_GAP ? 'gap-tight' : gap > WIDE_GAP ? 'gap-wide' : '';
                return (
                  <tr
                    key={c.clubDisplayName}
                    className={few ? 'row-off' : undefined}
                    title={few ? `Only ${c.keptShots} shot${c.keptShots > 1 ? 's' : ''} — rough guess` : undefined}
                  >
                    <td className="strong">{c.clubDisplayName}</td>
                    <td className="num dist-typical">{r(c.median!)} m</td>
                    <td className="num dist-range">
                      {r(c.p25!)}–{r(c.p75!)}
                    </td>
                    <td className="dist-bar-col">
                      <div className="dist-track">
                        <div
                          className="dist-fill"
                          style={{
                            left: `${pos(c.p25!)}%`,
                            width: `${Math.max(0.5, pos(c.p75!) - pos(c.p25!))}%`,
                          }}
                        />
                        <div className="dist-tick" style={{ left: `${pos(c.median!)}%` }} />
                      </div>
                    </td>
                    <td className={`num ${gapClass}`}>{gap === null ? '' : `+${gap}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="card-foot muted">
        Typical = median of your clean shots · Range = middle half of shots (25th–75th percentile) ·
        follows the filters on the left. Faded rows have fewer than {FEW_SHOTS} shots.
      </p>
    </div>
  );
}
