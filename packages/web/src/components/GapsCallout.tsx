import type { BagGap } from '../lib/types';
export default function GapsCallout({ gaps }: { gaps: BagGap[] }) {
  if (gaps.length === 0) return <p className="muted">No large distance gaps in your bag.</p>;
  return (
    <ul className="gaps-list">
      {gaps.map((g) => (
        <li key={`${g.upperClub}-${g.lowerClub}`}>
          <strong>{Math.round(g.gapMeters)} m</strong> gap between {g.upperClub}{' '}
          ({Math.round(g.upperCarry)} m) and {g.lowerClub} ({Math.round(g.lowerCarry)} m)
        </li>
      ))}
    </ul>
  );
}
