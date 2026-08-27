import { useMemo, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import type { DistanceMetric, FilteredShot } from '../lib/types';
import { useMeasure } from '../lib/useMeasure';

interface DispersionScatterProps {
  shots: FilteredShot[];
  activeClubs: Set<string>;
  metric: DistanceMetric;
  /** When true, bad hits (excluded shots) are removed from the plot entirely. */
  hideBadHits: boolean;
  /** Club whose dispersion area is highlighted (from legend or club-chip hover). */
  focusClub: string | null;
  onFocusClub: (club: string | null) => void;
  /** sessionId -> epoch ms, used to fade older shots (more recent = sharper). */
  sessionTs: Map<string, number>;
}

const MARGIN = { top: 24, right: 24, bottom: 40, left: 48 };
const HEIGHT = 560;
const RANGE_RINGS = [50, 100, 150, 200, 250];

// Palette for per-club colors (dots + ellipses share the club's color).
const CLUB_COLORS = [
  '#4FC3F7',
  '#7E57C2',
  '#26A69A',
  '#EF6C00',
  '#EC407A',
  '#66BB6A',
  '#5C6BC0',
  '#FF7043',
  '#29B6F6',
  '#AB47BC',
];

interface Pt {
  lateral: number;
  distance: number;
}

interface HoverState {
  id: string;
  x: number;
  y: number;
  club: string;
  flatCarry: number | null;
  total: number | null;
  offline: number;
  metric: DistanceMetric;
  excluded: boolean;
  daysAgo: number | null;
}

function daysAgoLabel(days: number | null): string | null {
  if (days == null) return null;
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** 1-sigma covariance ellipse points in data space (lateral, distance). */
function ellipsePoints(pts: Pt[]): Pt[] | null {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.lateral;
    my += p.distance;
  }
  mx /= n;
  my /= n;

  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const p of pts) {
    const dx = p.lateral - mx;
    const dy = p.distance - my;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  cxx /= n;
  cyy /= n;
  cxy /= n;

  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max((trace / 2) * (trace / 2) - det, 0));
  const l1 = trace / 2 + disc;
  const l2 = trace / 2 - disc;

  // Eigenvectors.
  let v1x: number;
  let v1y: number;
  if (Math.abs(cxy) > 1e-9) {
    v1x = l1 - cyy;
    v1y = cxy;
  } else {
    v1x = 1;
    v1y = 0;
  }
  const v1n = Math.hypot(v1x, v1y) || 1;
  v1x /= v1n;
  v1y /= v1n;
  const v2x = -v1y;
  const v2y = v1x;

  const a = Math.sqrt(Math.max(l1, 0));
  const b = Math.sqrt(Math.max(l2, 0));

  const out: Pt[] = [];
  const STEPS = 48;
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * Math.PI * 2;
    const ca = Math.cos(t) * a;
    const sb = Math.sin(t) * b;
    out.push({
      lateral: mx + ca * v1x + sb * v2x,
      distance: my + ca * v1y + sb * v2y,
    });
  }
  return out;
}

function latLabel(v: number): string {
  if (v === 0) return '0';
  return v < 0 ? `L${Math.abs(v)}` : `R${v}`;
}

export default function DispersionScatter({
  shots,
  activeClubs,
  metric,
  hideBadHits,
  focusClub,
  onFocusClub,
  sessionTs,
}: DispersionScatterProps) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<HoverState | null>(null);
  const w = Math.max(width, 360);
  const innerW = w - MARGIN.left - MARGIN.right;
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const visible = useMemo(
    () =>
      shots.filter(
        (s) =>
          s.clubDisplayName != null &&
          activeClubs.has(s.clubDisplayName) &&
          s.distance != null &&
          s.offTargetLine != null &&
          (!hideBadHits || !s.excluded),
      ),
    [shots, activeClubs, hideBadHits],
  );

  const cleanCount = useMemo(() => visible.filter((s) => !s.excluded).length, [visible]);
  const badCount = useMemo(() => visible.filter((s) => s.excluded).length, [visible]);

  // Recency 0..1 per shot from its session timestamp (1 = most recent). Older shots fade.
  const { minTs, spanTs, hasTs } = useMemo(() => {
    let mn = Infinity;
    let mx = -Infinity;
    for (const s of visible) {
      const t = sessionTs.get(s.sessionId);
      if (t != null) {
        if (t < mn) mn = t;
        if (t > mx) mx = t;
      }
    }
    return { minTs: mn, spanTs: mx - mn, hasTs: mx >= mn };
  }, [visible, sessionTs]);

  function recency(s: FilteredShot): number {
    const t = sessionTs.get(s.sessionId);
    if (!hasTs || t == null) return 1; // unknown date → treat as fully sharp
    if (spanTs <= 0) return 1;
    return (t - minTs) / spanTs;
  }

  const { maxDist, maxLat } = useMemo(() => {
    let md = 100;
    let ml = 40;
    for (const s of visible) {
      md = Math.max(md, s.distance ?? 0);
      ml = Math.max(ml, Math.abs(s.offTargetLine ?? 0));
    }
    return { maxDist: Math.ceil((md * 1.08) / 25) * 25, maxLat: Math.ceil((ml * 1.15) / 25) * 25 };
  }, [visible]);

  const yScale = scaleLinear().domain([0, maxDist]).range([innerH, 0]);
  const xScale = scaleLinear().domain([-maxLat, maxLat]).range([0, innerW]);

  const teeX = xScale(0);
  const teeY = yScale(0);

  // Single SVG-level hover: find the nearest dot to the pointer, and only update state
  // when the nearest dot actually changes (prevents per-pixel re-renders / flicker).
  function handlePointer(e: React.MouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect(); // this rect sits at plot origin
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    let best: (typeof visible)[number] | null = null;
    let bestD2 = 14 * 14; // only within ~14px
    for (const s of visible) {
      const dx = xScale(s.offTargetLine!) - px;
      const dy = yScale(s.distance!) - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = s;
      }
    }
    if (!best) {
      if (hover !== null) {
        setHover(null);
        onFocusClub(null);
      }
      return;
    }
    if (hover?.id === best.id) return; // same dot → no state churn
    const club = best.clubDisplayName!;
    const t = sessionTs.get(best.sessionId);
    const daysAgo = t != null ? Math.max(0, Math.round((Date.now() - t) / 86_400_000)) : null;
    setHover({
      id: best.id,
      x: MARGIN.left + xScale(best.offTargetLine!),
      y: MARGIN.top + yScale(best.distance!),
      club,
      flatCarry: best.flatCarry,
      total: best.total,
      offline: best.offTargetLine!,
      metric,
      excluded: best.excluded,
      daysAgo,
    });
    onFocusClub(club);
  }
  function clearHover() {
    if (hover !== null) {
      setHover(null);
      onFocusClub(null);
    }
  }

  // Stable club color assignment across ALL active clubs (not just kept), so colors
  // stay consistent whether or not bad hits are shown.
  const clubColor = useMemo(() => {
    const map = new Map<string, string>();
    let i = 0;
    const seen = [...activeClubs].sort();
    for (const name of seen) {
      map.set(name, CLUB_COLORS[i % CLUB_COLORS.length]);
      i++;
    }
    return map;
  }, [activeClubs]);

  // Ellipse per club from kept (clean) shots only.
  const ellipses = useMemo(() => {
    const byClub = new Map<string, Pt[]>();
    for (const s of visible) {
      if (s.excluded) continue;
      const name = s.clubDisplayName!;
      const arr = byClub.get(name) ?? [];
      arr.push({ lateral: s.offTargetLine!, distance: s.distance! });
      byClub.set(name, arr);
    }
    const result: { name: string; color: string; d: string }[] = [];
    for (const [name, pts] of byClub) {
      const ep = ellipsePoints(pts);
      if (!ep) continue;
      const d =
        ep
          .map((p, idx) => `${idx === 0 ? 'M' : 'L'}${xScale(p.lateral).toFixed(1)},${yScale(p.distance).toFixed(1)}`)
          .join(' ') + ' Z';
      result.push({ name, color: clubColor.get(name) ?? CLUB_COLORS[0], d });
    }
    return result;
  }, [visible, xScale, yScale, clubColor]);

  const latTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let v = -maxLat; v <= maxLat; v += 50) ticks.push(v);
    if (!ticks.includes(0)) ticks.push(0);
    return ticks.sort((a, b) => a - b);
  }, [maxLat]);

  // Legend clubs = clubs that have any visible shot, in stable color order.
  const legendClubs = useMemo(() => {
    const present = new Set(visible.map((s) => s.clubDisplayName!));
    return [...clubColor.keys()].filter((c) => present.has(c));
  }, [visible, clubColor]);

  return (
    <div className="dispersion-card">
      <div className="dispersion-card-header">
        <span>Dispersion</span>
        <span className="dispersion-metric">
          {metric === 'flatCarry' ? 'Flat Carry' : 'Total'} · meters ·{' '}
          <span className="clean-count">{cleanCount} clean</span>
          {!hideBadHits && badCount > 0 ? (
            <>
              {' · '}
              <span className="bad-count">{badCount} bad hits</span>
            </>
          ) : null}
          {hasTs && spanTs > 0 ? (
            <span className="recency-key" title="Dot opacity shows recency: brighter = more recent shot">
              <span>older</span>
              <span className="recency-bar" />
              <span>recent</span>
            </span>
          ) : null}
        </span>
      </div>
      <div ref={ref} className="chart-host" style={{ position: 'relative' }}>
        <svg
          width={w}
          height={HEIGHT}
          role="img"
          aria-label="Shot dispersion scatter"
          onMouseLeave={clearHover}
        >
          <defs>
            <clipPath id="plot-clip">
              <rect x={0} y={0} width={innerW} height={innerH} />
            </clipPath>
          </defs>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            <line x1={teeX} x2={teeX} y1={0} y2={innerH} className="dispersion-centerline" />

            <g clipPath="url(#plot-clip)">
              {RANGE_RINGS.filter((r) => r <= maxDist).map((r) => {
                const R = teeY - yScale(r);
                if (R <= 0) return null;
                return (
                  <g key={r}>
                    <path
                      d={`M ${teeX - R} ${teeY} A ${R} ${R} 0 0 1 ${teeX + R} ${teeY}`}
                      className="range-arc"
                    />
                    <text x={teeX} y={teeY - R + 14} textAnchor="middle" className="range-arc-label">
                      {r}
                    </text>
                  </g>
                );
              })}
            </g>

            {latTicks.map((v) => (
              <g key={v} transform={`translate(${xScale(v)},0)`}>
                <text y={innerH + 22} textAnchor="middle" className="axis-text">
                  {latLabel(v)}
                </text>
              </g>
            ))}

            {RANGE_RINGS.filter((r) => r <= maxDist).map((r) => (
              <text key={`y${r}`} x={-10} y={yScale(r) + 4} textAnchor="end" className="axis-text">
                {r}
              </text>
            ))}

            <g clipPath="url(#plot-clip)">
              {/* transparent surface captures all pointer moves for nearest-dot hover */}
              <rect
                x={0}
                y={0}
                width={innerW}
                height={innerH}
                fill="transparent"
                onMouseMove={handlePointer}
                onMouseLeave={clearHover}
              />
              {visible.map((s) => {
                const club = s.clubDisplayName!;
                const dimmed = focusClub != null && club !== focusClub;
                const hovered = hover?.id === s.id;
                const color = s.excluded ? '#b8c2cf' : clubColor.get(club) ?? CLUB_COLORS[0];
                // Recent shots sharp, older shots faint (floor keeps them visible).
                const rec = recency(s);
                const base = s.excluded ? 0.1 + 0.28 * rec : 0.18 + 0.62 * rec;
                // Dimming is MULTIPLICATIVE so the recency gradient survives hover-focus.
                const fillOp = hovered ? 0.9 : dimmed ? base * 0.28 : base;
                const strokeBase = 0.35 + 0.5 * rec;
                return (
                  <circle
                    key={s.id}
                    cx={xScale(s.offTargetLine!)}
                    cy={yScale(s.distance!)}
                    r={hovered ? 7 : s.excluded ? 4 : 5}
                    fill={color}
                    fillOpacity={fillOp}
                    stroke={hovered ? '#0f2233' : s.excluded ? 'none' : color}
                    strokeOpacity={hovered ? 1 : dimmed ? strokeBase * 0.25 : strokeBase}
                    strokeWidth={hovered ? 2 : 1}
                    pointerEvents="none"
                  />
                );
              })}

              {ellipses.map((e) => {
                const focused = focusClub === e.name;
                const dimmed = focusClub != null && !focused;
                return (
                  <path
                    key={e.name}
                    d={e.d}
                    fill={focused ? e.color : 'none'}
                    fillOpacity={focused ? 0.22 : 0}
                    stroke={e.color}
                    strokeWidth={focused ? 3 : 2}
                    strokeOpacity={dimmed ? 0.15 : 0.9}
                    pointerEvents="none"
                    style={{ transition: 'fill-opacity 0.12s ease' }}
                  />
                );
              })}
            </g>
          </g>
        </svg>

        {hover ? (
          <div
            className="dispersion-tooltip"
            style={{
              left: Math.min(hover.x + 12, w - 150),
              top: Math.max(hover.y - 10, 4),
            }}
          >
            <div className="tt-club">
              <span
                className="legend-swatch"
                style={{ background: hover.excluded ? '#b8c2cf' : clubColor.get(hover.club) ?? CLUB_COLORS[0] }}
              />
              {hover.club}
              {hover.excluded ? <span className="tt-bad"> · bad hit</span> : null}
            </div>
            <div className={`tt-row${hover.metric === 'flatCarry' ? ' tt-active' : ''}`}>
              Flat carry: <strong>{hover.flatCarry != null ? `${hover.flatCarry.toFixed(1)} m` : '—'}</strong>
            </div>
            <div className={`tt-row${hover.metric === 'total' ? ' tt-active' : ''}`}>
              Total: <strong>{hover.total != null ? `${hover.total.toFixed(1)} m` : '—'}</strong>
            </div>
            <div className="tt-row">
              Offline: <strong>{latLabel(Math.round(hover.offline))}</strong>
            </div>
            {daysAgoLabel(hover.daysAgo) ? (
              <div className="tt-row tt-when">{daysAgoLabel(hover.daysAgo)}</div>
            ) : null}
          </div>
        ) : null}
      </div>

      {legendClubs.length > 0 ? (
        <div className="dispersion-legend">
          {legendClubs.map((name) => (
            <span
              key={name}
              className={`legend-item legend-hoverable${focusClub === name ? ' focused' : ''}`}
              onMouseEnter={() => onFocusClub(name)}
              onMouseLeave={() => onFocusClub(null)}
            >
              <span className="legend-swatch" style={{ background: clubColor.get(name) }} />
              {name}
            </span>
          ))}
          {badCount > 0 && !hideBadHits ? (
            <span className="legend-item">
              <span className="legend-swatch" style={{ background: '#b8c2cf' }} />
              bad hits (excluded)
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
