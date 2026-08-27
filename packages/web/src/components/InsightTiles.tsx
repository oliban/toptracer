import type { OverviewHeadline } from '../lib/types';
export default function InsightTiles({ h }: { h: OverviewHeadline }) {
  const tiles = [
    { label: 'Clubs tracked', value: String(h.clubsTracked) },
    { label: 'Clean shots', value: String(h.totalCleanShots) },
    { label: 'Most consistent', value: h.mostConsistentClub ?? '—' },
    { label: 'Biggest gap', value: h.biggestGapMeters != null ? `${Math.round(h.biggestGapMeters)} m` : '—' },
    { label: 'Need attention', value: String(h.clubsNeedingAttention) },
  ];
  return (
    <div className="insight-tiles">
      {tiles.map((t) => (
        <div key={t.label} className="insight-tile">
          <div className="tile-value">{t.value}</div>
          <div className="tile-label">{t.label}</div>
        </div>
      ))}
    </div>
  );
}
