import { scaleLinear } from 'd3-scale';
import type { ClubTrendPoint, TrendDirection } from '../lib/types';

interface Props { points: ClubTrendPoint[]; direction: TrendDirection; }
const W = 90, H = 24, PAD = 3;

export default function TrendSparkline({ points, direction }: Props) {
  if (points.length < 2) return <span className="trend-none">—</span>;
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.value); // consistency std; lower = better
  const x = scaleLinear().domain([0, xs.length - 1]).range([PAD, W - PAD]);
  const y = scaleLinear().domain([Math.min(...ys), Math.max(...ys) || 1]).range([H - PAD, PAD]);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const cls = direction === 'improving' ? 'spark-good' : direction === 'declining' ? 'spark-bad' : 'spark-flat';
  return (
    <svg width={W} height={H} className={`trend-spark ${cls}`} aria-label={`consistency trend ${direction}`}>
      <path d={d} fill="none" strokeWidth={2} />
    </svg>
  );
}
