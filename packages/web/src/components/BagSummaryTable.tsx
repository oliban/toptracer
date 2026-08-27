import type { ClubInsight } from '../lib/types';
import TrendSparkline from '../charts/TrendSparkline';
const m = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} m`);
const arrow = (d: string) => (d === 'improving' ? '▲' : d === 'declining' ? '▼' : d === 'steady' ? '~' : '');
export default function BagSummaryTable({ clubs }: { clubs: ClubInsight[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Club</th><th className="num">Carry</th><th className="num">Total</th>
            <th className="num">Roll</th><th className="num">Spread</th>
            <th className="num">Shots</th><th className="num">Last hit</th><th>Consistency trend</th>
          </tr>
        </thead>
        <tbody>
          {clubs.map((c) => (
            <tr key={c.clubDisplayName}>
              <td className="strong">{c.clubDisplayName}</td>
              <td className="num">{m(c.medianCarry)}</td>
              <td className="num">{m(c.medianTotal)}</td>
              <td className="num">{c.roll == null ? '—' : `${Math.round(c.roll)} m`}</td>
              <td className="num">{c.carrySpread == null ? '—' : `±${Math.round(c.carrySpread / 2)} m`}</td>
              <td className="num">{c.keptShots}</td>
              <td className="num">{c.lastHitDaysAgo == null ? '—' : `${c.lastHitDaysAgo}d`}</td>
              <td>
                <span className={`trend-arrow trend-${c.trend.direction}`}>{arrow(c.trend.direction)}</span>{' '}
                <TrendSparkline points={c.trend.points} direction={c.trend.direction} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
