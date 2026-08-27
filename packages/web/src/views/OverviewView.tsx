import { useEffect, useRef, useState } from 'react';
import * as api from '../lib/api';
import type { FilterOptions, OverviewResult } from '../lib/types';
import InsightTiles from '../components/InsightTiles';
import PracticePriorityList from '../components/PracticePriorityList';
import GapsCallout from '../components/GapsCallout';
import BagSummaryTable from '../components/BagSummaryTable';
import Spinner from '../components/Spinner';

interface Props { filter: FilterOptions; onSessionExpired: (err: unknown) => boolean; }

export default function OverviewView({ filter, onSessionExpired }: Props) {
  const [data, setData] = useState<OverviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onExpiredRef = useRef(onSessionExpired);
  onExpiredRef.current = onSessionExpired;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.overview(filter)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((err) => {
        if (!onExpiredRef.current(err)) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load analysis');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filter]);

  if (!data) {
    if (loading) return <Spinner small label="Analysing…" />;
    if (error) return <div className="banner banner-error">{error}</div>;
    return <p className="muted">No data yet — click Sync.</p>;
  }

  return (
    <div className="overview-view">
      <InsightTiles h={data.headline} />
      <div className="card">
        <div className="card-header"><h2>Bring to the range next</h2>
          <span className="card-sub">Ranked by staleness, sample size, consistency, and bag gaps</span></div>
        <div className="card-pad"><PracticePriorityList items={data.priorities} /></div>
      </div>
      <div className="card">
        <div className="card-header"><h2>Distance gaps</h2></div>
        <div className="card-pad"><GapsCallout gaps={data.gaps} /></div>
      </div>
      <div className="card">
        <div className="card-header"><h2>Your bag</h2>
          <span className="card-sub">Consistency trend = per-session carry spread over time (▲ tighter)</span></div>
        <BagSummaryTable clubs={data.clubs} />
      </div>
    </div>
  );
}
