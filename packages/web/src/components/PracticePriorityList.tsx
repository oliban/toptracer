import type { PracticePriority } from '../lib/types';
function level(score: number): string { return score >= 0.6 ? 'sev-high' : score >= 0.4 ? 'sev-mid' : 'sev-low'; }
export default function PracticePriorityList({ items }: { items: PracticePriority[] }) {
  const ranked = items.filter((p) => p.reasons.length > 0);
  if (ranked.length === 0) return <p className="muted">Everything looks up to date. Nice.</p>;
  return (
    <ol className="priority-list">
      {ranked.map((p, idx) => (
        <li key={p.clubDisplayName} className={`priority-card ${level(p.score)}`}>
          <span className="priority-rank">{idx + 1}</span>
          <div className="priority-body">
            <div className="priority-club">{p.clubDisplayName}</div>
            <div className="reason-chips">
              {p.reasons.map((r) => <span key={r} className="reason-chip">{r}</span>)}
            </div>
          </div>
          <span className="priority-score">{Math.round(p.score * 100)}</span>
        </li>
      ))}
    </ol>
  );
}
